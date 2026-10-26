import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { sendOrderStatusEmail, computeOrderTotals } from "../lib/email";

/**
 * Order Shipment Created → Sends "Your order has been shipped" email
 * Triggered when admin marks order as shipped in Medusa admin dashboard.
 */
export default async function orderShipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger = container.resolve("logger");

  // data may have order_id directly or the id IS the order id
  const orderId = (data as any).order_id || (data as any).id;
  if (!orderId) return;

  try {
    const orderService = container.resolve(Modules.ORDER);

    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "shipping_methods"],
    });

    if (!order.email) {
      logger.warn(`[ShipmentEmail] Order ${orderId} has no email`);
      return;
    }

    const customerName =
      order.shipping_address?.first_name ||
      "Valued Customer";

    const shippingAddress = order.shipping_address
      ? [
          order.shipping_address.address_1,
          order.shipping_address.city,
          order.shipping_address.country_code?.toUpperCase(),
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;

    // Tracking info from fulfillment data or order metadata
    const metadata: Record<string, any> = (order as any).metadata || {};
    const trackingNumbers = (data as any).tracking_numbers || [];
    const trackingNumber =
      trackingNumbers[0] || metadata.tracking_number || undefined;
    const trackingUrl = (data as any).tracking_url || metadata.tracking_url || undefined;
    const carrierName = (data as any).carrier_name || metadata.carrier_name || undefined;

    await sendOrderStatusEmail("order.shipped", order.email, {
      customerName,
      orderId: order.id,
      displayId: order.display_id,
      items: (order.items || []).map((item: any) => ({
        title: item.title || "Product",
        quantity: item.quantity,
        unit_price: item.unit_price || 0,
      })),
      ...computeOrderTotals(order),
      currencyCode: order.currency_code || "kwd",
      shippingAddress,
      trackingNumber,
      trackingUrl,
      carrierName,
    });

    logger.info(
      `[ShipmentEmail] ✅ Sent shipped email to ${order.email} for order #${order.display_id}`
    );
  } catch (err: any) {
    logger.error(`[ShipmentEmail] ❌ Failed for order ${orderId}: ${err.message}`);
  }
}

export const config: SubscriberConfig = {
  event: "order.shipment_created",
};
