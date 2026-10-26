import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { sendOrderStatusEmail, computeOrderTotals, OrderEmailType } from "../lib/email";

/**
 * Order Status Email Notifications
 *
 * Sends branded emails to customers when admin changes order status:
 *   - order.placed        → "Order Confirmed" email
 *   - order.fulfillment_created → "Order Confirmed / Processing" email
 *   - order.shipment_created   → "Order Shipped" email
 *   - order.completed          → "Order Delivered" email
 *   - order.cancelled          → "Order Cancelled" email
 *
 * Also triggered by Odoo webhook updates stored in order metadata.
 */

// ─── Shared Helper ────────────────────────────────────────────────────────────

async function resolveOrderAndSend(
  orderId: string,
  emailType: OrderEmailType,
  container: any,
  extraData: Record<string, any> = {}
) {
  const logger = container.resolve("logger");

  try {
    const orderService = container.resolve(Modules.ORDER);

    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "shipping_methods"],
    });

    if (!order.email) {
      logger.warn(`[OrderStatusEmail] Order ${orderId} has no email — skipping ${emailType}`);
      return;
    }

    const customerName =
      order.shipping_address?.first_name ||
      "Valued Customer";

    const shippingAddress = order.shipping_address
      ? [
          order.shipping_address.address_1,
          order.shipping_address.city,
          order.shipping_address.province,
          order.shipping_address.country_code?.toUpperCase(),
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;

    // Pull tracking info from order metadata (set by Odoo webhook)
    const metadata: Record<string, any> = (order as any).metadata || {};

    // Calculate totals from items (Medusa v2 order.total/subtotal are not populated on retrieveOrder)
    const orderItems = (order.items || []).map((item: any) => ({
      title: item.title || item.product_title || "Product",
      quantity: item.quantity,
      unit_price: item.unit_price || 0,
    }));
    const { subtotal: calculatedSubtotal, shippingTotal, total } = computeOrderTotals(order);

    await sendOrderStatusEmail(emailType, order.email, {
      customerName,
      orderId: order.id,
      displayId: order.display_id,
      items: orderItems,
      total,
      subtotal: calculatedSubtotal,
      shippingTotal,
      currencyCode: order.currency_code || "kwd",
      shippingAddress,
      trackingNumber: extraData.tracking_number || metadata.tracking_number,
      trackingUrl: extraData.tracking_url || metadata.tracking_url,
      carrierName: extraData.carrier_name || metadata.carrier_name,
      cancelledReason: extraData.cancelled_reason || metadata.cancelled_reason,
    });

    logger.info(
      `[OrderStatusEmail] ✅ Sent "${emailType}" to ${order.email} for order #${order.display_id}`
    );
  } catch (err: any) {
    logger.error(
      `[OrderStatusEmail] ❌ Failed to send "${emailType}" for order ${orderId}: ${err.message}`
    );
  }
}

// ─── 1. Order Placed / Confirmed ─────────────────────────────────────────────
// (Note: order.placed is already handled by order-notifications.ts for the
//  "order confirmation" email. This one handles the admin-side "confirmed" status.)

export default async function orderFulfillmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  // data.id is the fulfillment id; data.order_id is the order id
  const orderId = (data as any).order_id || (data as any).id;
  if (!orderId) return;

  await resolveOrderAndSend(orderId, "order.confirmed", container);
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
};
