import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows";
import { sendOrderStatusEmail, OrderEmailType } from "../../../../lib/email";

/**
 * POST /odoo/webhooks/order-status
 * Webhook for Odoo to update order status in Medusa
 * 
 * Call this when:
 * - Order is confirmed in Odoo
 * - Order is shipped/delivered
 * - Order is cancelled
 * - Invoice is created
 * - Payment is received
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const {
    event_type,
    order,
  } = req.body as {
    event_type: 
      | "order.confirmed" 
      | "order.shipped" 
      | "order.delivered" 
      | "order.cancelled"
      | "order.invoiced"
      | "order.paid";
    order: {
      medusa_order_id?: string;     // Medusa order ID (preferred)
      odoo_order_id?: number;       // Odoo sale order ID
      odoo_order_name?: string;     // Odoo order reference (e.g., "S00123")
      status?: string;              // Odoo order state
      tracking_number?: string;
      tracking_url?: string;
      carrier_name?: string;
      shipped_date?: string;
      delivered_date?: string;
      cancelled_reason?: string;
      invoice_number?: string;
      invoice_date?: string;
      payment_date?: string;
      payment_method?: string;
    };
  };

  // Validate required fields
  if (!event_type || !order) {
    return res.status(400).json({
      type: "invalid_data",
      message: "event_type and order are required",
    });
  }

  if (!order.medusa_order_id && !order.odoo_order_id && !order.odoo_order_name) {
    return res.status(400).json({
      type: "invalid_data",
      message: "Either medusa_order_id, odoo_order_id, or odoo_order_name is required",
    });
  }

  console.log(`[Odoo Webhook] Received ${event_type} for order: ${order.medusa_order_id || order.odoo_order_name || order.odoo_order_id}`);

  try {
    // Find the Medusa order
    let medusaOrderId = order.medusa_order_id;

    if (!medusaOrderId && (order.odoo_order_id || order.odoo_order_name)) {
      // Try to find by Odoo reference stored in metadata
      // First check if there's a display_id that matches
      const orderSearch = await pgConnection.raw(
        `SELECT id, display_id FROM "order" 
         WHERE metadata->>'odoo_order_id' = ?
            OR metadata->>'odoo_order_name' = ?
         LIMIT 1`,
        [order.odoo_order_id?.toString(), order.odoo_order_name]
      );

      if (orderSearch.rows && orderSearch.rows.length > 0) {
        medusaOrderId = orderSearch.rows[0].id;
      }
    }

    if (!medusaOrderId) {
      return res.status(404).json({
        type: "not_found",
        message: "Order not found in Medusa",
        odoo_order_id: order.odoo_order_id,
        odoo_order_name: order.odoo_order_name,
      });
    }

    // Verify order exists
    const orderResult = await pgConnection.raw(
      `SELECT id, display_id, status, metadata FROM "order" WHERE id = ?`,
      [medusaOrderId]
    );

    if (!orderResult.rows || orderResult.rows.length === 0) {
      return res.status(404).json({
        type: "not_found",
        message: "Order not found",
        medusa_order_id: medusaOrderId,
      });
    }

    const existingOrder = orderResult.rows[0];
    const currentMetadata = existingOrder.metadata || {};

    // Prepare metadata update
    const metadataUpdate: Record<string, any> = {
      ...currentMetadata,
      odoo_last_update: new Date().toISOString(),
      odoo_last_event: event_type,
    };

    if (order.odoo_order_id) {
      metadataUpdate.odoo_order_id = order.odoo_order_id;
    }
    if (order.odoo_order_name) {
      metadataUpdate.odoo_order_name = order.odoo_order_name;
    }

    // Handle different event types
    switch (event_type) {
      case "order.confirmed":
        metadataUpdate.odoo_confirmed = true;
        metadataUpdate.odoo_confirmed_at = new Date().toISOString();
        break;

      case "order.shipped":
        metadataUpdate.odoo_shipped = true;
        metadataUpdate.odoo_shipped_at = order.shipped_date || new Date().toISOString();
        if (order.tracking_number) {
          metadataUpdate.tracking_number = order.tracking_number;
        }
        if (order.tracking_url) {
          metadataUpdate.tracking_url = order.tracking_url;
        }
        if (order.carrier_name) {
          metadataUpdate.carrier_name = order.carrier_name;
        }
        break;

      case "order.delivered":
        metadataUpdate.odoo_delivered = true;
        metadataUpdate.odoo_delivered_at = order.delivered_date || new Date().toISOString();
        break;

      case "order.cancelled":
        metadataUpdate.odoo_cancelled = true;
        metadataUpdate.odoo_cancelled_at = new Date().toISOString();
        if (order.cancelled_reason) {
          metadataUpdate.cancelled_reason = order.cancelled_reason;
        }
        break;

      case "order.invoiced":
        metadataUpdate.odoo_invoiced = true;
        metadataUpdate.odoo_invoiced_at = order.invoice_date || new Date().toISOString();
        if (order.invoice_number) {
          metadataUpdate.invoice_number = order.invoice_number;
        }
        break;

      case "order.paid":
        metadataUpdate.odoo_paid = true;
        metadataUpdate.odoo_paid_at = order.payment_date || new Date().toISOString();
        if (order.payment_method) {
          metadataUpdate.payment_method_odoo = order.payment_method;
        }
        break;
    }

    // Update order metadata
    await pgConnection.raw(
      `UPDATE "order" SET metadata = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(metadataUpdate), medusaOrderId]
    );

    // An Odoo cancellation must also cancel the order in Medusa. The order.canceled
    // subscriber then sends the customer email and records any refund owed, so the
    // webhook's own email is skipped when this succeeds.
    let cancelledInMedusa = false;
    if (event_type === "order.cancelled" && existingOrder.status !== "canceled") {
      try {
        await cancelOrderWorkflow(req.scope).run({ input: { order_id: medusaOrderId } });
        cancelledInMedusa = true;
      } catch (cancelErr: any) {
        console.error(`[Odoo Webhook] ⚠️ Could not cancel Medusa order ${medusaOrderId}: ${cancelErr.message}`);
      }
    }

    // ── Send customer email notification ────────────────────────────────────
    // Fetch order email + items from DB for the email
    const emailEventMap: Record<string, OrderEmailType | null> = {
      "order.confirmed": "order.confirmed",
      "order.shipped": "order.shipped",
      "order.delivered": "order.delivered",
      "order.cancelled": "order.cancelled",
      "order.invoiced": null,
      "order.paid": null,
    };

    const emailType = cancelledInMedusa ? null : emailEventMap[event_type];
    if (emailType) {
      try {
        // Get order details for email
        const orderEmailData = await pgConnection.raw(
          `SELECT o.id, o.display_id, o.email, o.currency_code, o.total, o.subtotal,
                  sa.first_name, sa.address_1, sa.city, sa.country_code
           FROM "order" o
           LEFT JOIN "address" sa ON sa.id = o.shipping_address_id
           WHERE o.id = ?`,
          [medusaOrderId]
        );

        const orderItemsData = await pgConnection.raw(
          `SELECT title, quantity, unit_price FROM "order_line_item"
           WHERE order_id = ?`,
          [medusaOrderId]
        );

        const oRow = orderEmailData.rows?.[0];
        if (oRow?.email) {
          const shippingAddress = [oRow.address_1, oRow.city, oRow.country_code?.toUpperCase()]
            .filter(Boolean)
            .join(", ");

          await sendOrderStatusEmail(emailType, oRow.email, {
            customerName: oRow.first_name || "Valued Customer",
            orderId: medusaOrderId,
            displayId: oRow.display_id,
            items: (orderItemsData.rows || []).map((item: any) => ({
              title: item.title || "Product",
              quantity: item.quantity,
              unit_price: item.unit_price || 0,
            })),
            total: Number(oRow.total || 0),
            subtotal: Number(oRow.subtotal || 0),
            currencyCode: oRow.currency_code || "kwd",
            shippingAddress: shippingAddress || undefined,
            trackingNumber: order.tracking_number,
            trackingUrl: order.tracking_url,
            carrierName: order.carrier_name,
            cancelledReason: order.cancelled_reason,
          });
          console.log(`[Odoo Webhook] ✅ Email sent: ${emailType} → ${oRow.email}`);
        }
      } catch (emailErr: any) {
        // Don't fail the webhook if email fails
        console.error(`[Odoo Webhook] ⚠️ Email send failed: ${emailErr.message}`);
      }
    }

    // ── Emit event for push notification subscriber ──────────────────────────
    const pushEvents = ["order.confirmed", "order.shipped", "order.delivered", "order.cancelled"];
    if (pushEvents.includes(event_type)) {
      try {
        // Get customer_id for the order
        const customerRow = await pgConnection.raw(
          `SELECT customer_id, display_id FROM "order" WHERE id = ?`,
          [medusaOrderId]
        );
        const customerId = customerRow.rows?.[0]?.customer_id;
        const displayId = customerRow.rows?.[0]?.display_id;

        if (customerId) {
          const eventBus = req.scope.resolve(Modules.EVENT_BUS);
          await eventBus.emit({
            name: "order.status.updated",
            data: {
              order_id: medusaOrderId,
              customer_id: customerId,
              display_id: displayId,
              event_type,
              tracking_number: order.tracking_number,
              tracking_url: order.tracking_url,
              carrier_name: order.carrier_name,
            },
          });
          console.log(`[Odoo Webhook] ✅ Push event emitted: order.status.updated (${event_type})`);
        }
      } catch (pushErr: any) {
        console.warn(`[Odoo Webhook] ⚠️ Push event emit failed: ${pushErr.message}`);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    res.json({
      success: true,
      event_type,
      order: {
        medusa_order_id: medusaOrderId,
        display_id: existingOrder.display_id,
        odoo_order_id: order.odoo_order_id,
        odoo_order_name: order.odoo_order_name,
      },
      metadata_updated: Object.keys(metadataUpdate).filter(k => !Object.keys(currentMetadata).includes(k)),
    });
  } catch (error: any) {
    console.error("[Odoo Webhook] Order status webhook error:", error);
    res.status(500).json({
      type: "server_error",
      message: error.message,
    });
  }
};

/**
 * GET /odoo/webhooks/order-status
 * Health check for webhook endpoint
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  res.json({
    status: "ok",
    endpoint: "order-status",
    description: "Odoo order status webhook endpoint",
    supported_events: [
      "order.confirmed",
      "order.shipped",
      "order.delivered",
      "order.cancelled",
      "order.invoiced",
      "order.paid",
    ],
    example_payload: {
      event_type: "order.shipped",
      order: {
        medusa_order_id: "order_01HXY123ABC456",
        odoo_order_id: 123,
        odoo_order_name: "S00123",
        tracking_number: "TRK123456789",
        tracking_url: "https://tracking.carrier.com/TRK123456789",
        carrier_name: "FedEx",
        shipped_date: "2024-01-15T10:30:00Z",
      },
    },
  });
};
