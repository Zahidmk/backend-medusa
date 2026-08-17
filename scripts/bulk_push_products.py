#!/usr/bin/env python3
"""
Bulk Push ALL Odoo Products to MedusaJS via Webhook

This script fetches ALL products from Odoo and sends them to MedusaJS
in bulk batches via the webhook endpoint. No direct DB access needed.

Usage:
  python3 bulk_push_products.py

Requirements:
  pip install requests  (or uses urllib as fallback)
"""

import json
import os
import sys
import time

try:
    import requests
    USE_REQUESTS = True
except ImportError:
    import urllib.request
    USE_REQUESTS = False

import xmlrpc.client

# Configuration
ODOO_URL = os.environ.get("ODOO_URL", "")
ODOO_DB = os.environ.get("ODOO_DB_NAME") or os.environ.get("ODOO_DB", "")
ODOO_USER = os.environ.get("ODOO_USERNAME") or os.environ.get("ODOO_USER", "")
ODOO_PASSWORD = os.environ.get("ODOO_PASSWORD") or os.environ.get("ODOO_API_KEY", "")

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://72.61.240.40:9000/odoo/webhooks/products")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "marqa-odoo-webhook-2026")

PAGE_SIZE = 200
BATCH_SIZE = 50


def send_webhook(payload):
    """Send data to MedusaJS webhook"""
    data = json.dumps(payload).encode("utf-8")
    if USE_REQUESTS:
        r = requests.post(WEBHOOK_URL, json=payload, headers={"Content-Type": "application/json"}, timeout=60)
        return r.status_code, r.text
    else:
        req = urllib.request.Request(WEBHOOK_URL, data=data, headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=60)
        return resp.status, resp.read().decode()


def main():
    print(f"\n{'='*55}")
    print("Odoo -> MedusaJS Bulk Product Push via Webhook")
    print(f"{'='*55}")
    print(f"Odoo:    {ODOO_URL}")
    print(f"DB:      {ODOO_DB}")
    print(f"Webhook: {WEBHOOK_URL}")
    print(f"Batch:   {BATCH_SIZE} products per request")
    print()

    # Authenticate
    print("1. Authenticating with Odoo...")
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        print("ERROR: Authentication failed!")
        print("Please check ODOO_USER and ODOO_PASSWORD")
        sys.exit(1)
    print(f"   Authenticated (UID: {uid})")

    models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

    # Count
    print("\n2. Counting products...")
    total = models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
        "product.template", "search_count",
        [[["active", "=", True], ["sale_ok", "=", True]]])
    print(f"   Total: {total} products")

    # Fetch all
    print(f"\n3. Fetching products (page size: {PAGE_SIZE})...")
    fields = ["id", "name", "default_code", "barcode", "list_price",
              "description_sale", "categ_id", "weight", "qty_available",
              "is_published"]

    all_products = []
    offset = 0
    while offset < total:
        batch = models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
            "product.template", "search_read",
            [[["active", "=", True], ["sale_ok", "=", True]]],
            {"fields": fields, "limit": PAGE_SIZE, "offset": offset, "order": "id asc"})
        all_products.extend(batch)
        offset += PAGE_SIZE
        print(f"   Fetched {len(all_products)}/{total}...", end="\r")

    print(f"   Fetched {len(all_products)} products total")

    # Push in batches
    print(f"\n4. Pushing to MedusaJS in batches of {BATCH_SIZE}...")
    sent = 0
    errors = 0
    start = time.time()

    for i in range(0, len(all_products), BATCH_SIZE):
        batch = all_products[i:i + BATCH_SIZE]
        items = []
        for p in batch:
            items.append({
                "odoo_id": p["id"],
                "name": p.get("name", ""),
                "default_code": p.get("default_code", "") or "", "sku": p.get("default_code", "") or "",
                "barcode": p.get("barcode", "") or "",
                "list_price": p.get("list_price", 0) or 0,
                "description_sale": (p.get("description_sale", "") or "")[:500],
                "weight": p.get("weight", 0) or 0,
                "qty_available": p.get("qty_available", 0) or 0,
                "is_published": p.get("is_published", True),
                "categ_id": p.get("categ_id", False),
            })

        payload = {
            "event_type": "product.bulk",
            "webhook_secret": WEBHOOK_SECRET,
            "products": items,
        }

        try:
            status, body = send_webhook(payload)
            sent += len(batch)
            elapsed = time.time() - start
            rate = sent / elapsed if elapsed > 0 else 0
            print(f"   Sent {sent}/{len(all_products)} ({rate:.0f}/sec) - HTTP {status}", end="\r")
            if status >= 400:
                errors += 1
                print(f"\n   WARNING: HTTP {status} for batch starting at #{i}: {body[:200]}")
        except Exception as e:
            errors += 1
            print(f"\n   ERROR at batch #{i}: {e}")

        # Small delay to not overwhelm the server
        time.sleep(0.5)

    elapsed = time.time() - start
    print(f"\n\n{'='*55}")
    print("BULK PUSH COMPLETE")
    print(f"{'='*55}")
    print(f"Products sent: {sent}")
    print(f"Batch errors:  {errors}")
    print(f"Time:          {elapsed:.1f}s")
    print(f"Rate:          {sent/elapsed:.0f} products/sec")
    print(f"{'='*55}")
    print()


if __name__ == "__main__":
    main()
