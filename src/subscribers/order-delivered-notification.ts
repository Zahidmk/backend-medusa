import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { sendOrderStatusEmail, computeOrderTotals } from "../lib/email";

/**
 * Order Completed → Sends "Your order has been delivered" email
 * Triggered when admin marks order as completed in Medusa admin dashboard.
 */
export default async function orderCompletedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger");
  const orderId = data.id;
  if (!orderId) return;

  try {
    const orderService = container.resolve(Modules.ORDER);

    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "shipping_methods"],
    });

    if (!order.email) {
      logger.warn(`[DeliveredEmail] Order ${orderId} has no email`);
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

    await sendOrderStatusEmail("order.delivered", order.email, {
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
    });

    logger.info(
      `[DeliveredEmail] ✅ Sent delivered email to ${order.email} for order #${order.display_id}`
    );
  } catch (err: any) {
    logger.error(`[DeliveredEmail] ❌ Failed for order ${orderId}: ${err.message}`);
  }
}

export const config: SubscriberConfig = {
  event: "order.completed",
};
