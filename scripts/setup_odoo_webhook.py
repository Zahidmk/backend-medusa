#!/usr/bin/env python3
"""
Setup Odoo Automated Actions (Webhooks) for MedusaJS Product Sync

This script creates automated actions in Odoo that will push product
changes (create/update/delete) to MedusaJS via webhook.

Usage:
  python3 setup_odoo_webhook.py

Requirements:
  pip install xmlrpc.client (built-in)

Configuration:
  Set these environment variables or edit the constants below.
"""

import xmlrpc.client
import os
import sys

# ── Configuration ────────────────────────────────────
ODOO_URL = os.environ.get("ODOO_URL", "")
ODOO_DB = os.environ.get("ODOO_DB_NAME") or os.environ.get("ODOO_DB", "")
ODOO_USER = os.environ.get("ODOO_USERNAME") or os.environ.get("ODOO_USER", "")
ODOO_PASSWORD = os.environ.get("ODOO_PASSWORD") or os.environ.get("ODOO_API_KEY", "")

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://72.61.240.40:9000/odoo/webhooks/products")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "marqa-odoo-webhook-2026")

def main():
    print(f"\n{'='*55}")
    print("Odoo Webhook Setup for MedusaJS")
    print(f"{'='*55}")
    print(f"Odoo:    {ODOO_URL}")
    print(f"DB:      {ODOO_DB}")
    print(f"Webhook: {WEBHOOK_URL}")
    print()

    # Authenticate
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        print("ERROR: Authentication failed!")
        print("Please verify credentials and try again.")
        print_manual_setup()
        sys.exit(1)

    print(f"Authenticated as UID: {uid}")
    models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

    # Python code for the webhook action
    webhook_code = f'''
import json
import urllib.request

WEBHOOK_URL = "{WEBHOOK_URL}"
WEBHOOK_SECRET = "{WEBHOOK_SECRET}"

for rec in records:
    try:
        brand = ""
        try:
            if hasattr(rec, 'brand_id') and rec.brand_id:
                brand = rec.brand_id.name or ""
        except:
            pass
        try:
            if not brand and hasattr(rec, 'x_studio_brand_1') and rec.x_studio_brand_1:
                brand = str(rec.x_studio_brand_1)
        except:
            pass

        data = {{
            "event_type": "product.__ACTION__",
            "webhook_secret": WEBHOOK_SECRET,
            "product": {{
                "odoo_id": rec.id,
                "name": rec.name or "",
                "default_code": rec.default_code or "",
                "barcode": rec.barcode or "",
                "list_price": rec.list_price or 0,
                "description_sale": (rec.description_sale or "")[:500],
                "weight": rec.weight or 0,
                "qty_available": rec.qty_available or 0,
                "is_published": getattr(rec, 'is_published', True),
                "categ_id": [rec.categ_id.id, rec.categ_id.name] if rec.categ_id else False,
                "brand": brand,
            }}
        }}
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=json.dumps(data).encode('utf-8'),
            headers={{"Content-Type": "application/json"}},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log("Webhook error: %s" % str(e), level='warning')
'''

    actions = [
        ("MarqaSouq: Product Created", "on_create", "created"),
        ("MarqaSouq: Product Updated", "on_write", "updated"),
        ("MarqaSouq: Product Deleted", "on_unlink", "deleted"),
    ]

    for name, trigger, action_type in actions:
        code = webhook_code.replace("__ACTION__", action_type)
        print(f"\nCreating: {name}...")
        try:
            # Create server action
            action_id = models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
                "ir.actions.server", "create", [{
                    "name": name,
                    "model_id": models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
                        "ir.model", "search", [[("model", "=", "product.template")]])[0],
                    "state": "code",
                    "code": code,
                }])
            print(f"  Server action created (ID: {action_id})")

            # Create automation
            auto_id = models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
                "base.automation", "create", [{
                    "name": name,
                    "model_id": models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD,
                        "ir.model", "search", [[("model", "=", "product.template")]])[0],
                    "trigger": trigger,
                    "action_server_ids": [(6, 0, [action_id])],
                    "active": True,
                }])
            print(f"  Automation created (ID: {auto_id})")
        except Exception as e:
            print(f"  ERROR: {e}")
            print("  You may need to create this manually.")

    print(f"\n{'='*55}")
    print("Setup complete!")
    print(f"{'='*55}")
    print(f"\nWebhook URL: {WEBHOOK_URL}")
    print(f"Secret:      {WEBHOOK_SECRET}")
    print("\nTest with:")
    print(f"  curl {WEBHOOK_URL}")
    print()

def print_manual_setup():
    print(f"""
{'='*55}
MANUAL SETUP INSTRUCTIONS
{'='*55}

If automated setup fails, create these in Odoo manually:

1. Go to: Settings > Technical > Automation > Automated Actions
2. Create 3 actions:

   a) Name: "MarqaSouq: Product Created"
      Model: Product Template
      Trigger: On Creation
      Action: Execute Python Code
      (paste webhook code - see below)

   b) Name: "MarqaSouq: Product Updated"
      Model: Product Template
      Trigger: On Update
      Action: Execute Python Code

   c) Name: "MarqaSouq: Product Deleted"
      Model: Product Template
      Trigger: On Deletion
      Action: Execute Python Code

Python code for each action:

import json
import urllib.request

WEBHOOK_URL = "{WEBHOOK_URL}"
WEBHOOK_SECRET = "{WEBHOOK_SECRET}"

for rec in records:
    data = {{
        "event_type": "product.created",  # change to .updated / .deleted
        "webhook_secret": WEBHOOK_SECRET,
        "product": {{
            "odoo_id": rec.id,
            "name": rec.name or "",
            "default_code": rec.default_code or "",
            "list_price": rec.list_price or 0,
            "description_sale": (rec.description_sale or "")[:500],
            "weight": rec.weight or 0,
        }}
    }}
    req = urllib.request.Request(
        WEBHOOK_URL,
        data=json.dumps(data).encode('utf-8'),
        headers={{"Content-Type": "application/json"}},
        method="POST"
    )
    urllib.request.urlopen(req, timeout=10)
""")

if __name__ == "__main__":
    main()
