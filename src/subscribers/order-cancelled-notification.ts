import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { sendOrderStatusEmail, computeOrderTotals } from "../lib/email";

/**
 * Order Cancelled → Sends "Your order has been cancelled" email
 * Triggered when admin or customer cancels an order.
 */
export default async function orderCancelledHandler({
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
      logger.warn(`[CancelledEmail] Order ${orderId} has no email`);
      return;
    }

    const customerName =
      order.shipping_address?.first_name ||
      "Valued Customer";

    const metadata: Record<string, any> = (order as any).metadata || {};

    await sendOrderStatusEmail("order.cancelled", order.email, {
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
      cancelledReason: metadata.cancelled_reason,
    });

    logger.info(
      `[CancelledEmail] ✅ Sent cancelled email to ${order.email} for order #${order.display_id}`
    );
  } catch (err: any) {
    logger.error(`[CancelledEmail] ❌ Failed for order ${orderId}: ${err.message}`);
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
};
