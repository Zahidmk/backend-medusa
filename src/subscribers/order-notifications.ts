import {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { sendOrderStatusEmail } from "../lib/email";
import { sendPushNotification } from "../lib/firebase";

/**
 * Order Placed Notification Subscriber
 * Sends email confirmation when an order is placed.
 * Uses nodemailer/Gmail SMTP directly (not the local notification provider).
 */
export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER);
  const logger = container.resolve("logger");
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  try {
    // Get order details
    const order = await orderService.retrieveOrder(data.id, {
      relations: ["items", "shipping_address"],
    });

    let recipientEmail = order.email;
    if (!recipientEmail && order.customer_id) {
      try {
        const custRes = await pgConnection.raw(`SELECT email FROM customer WHERE id = ?`, [order.customer_id]);
        if (custRes.rows?.[0]?.email) {
          recipientEmail = custRes.rows[0].email;
          logger.info(`[OrderEmail] Resolved email ${recipientEmail} from customer ID ${order.customer_id}`);
        }
      } catch (custErr: any) {
        logger.warn(`[OrderEmail] Could not lookup customer email for ID ${order.customer_id}: ${custErr?.message || custErr}`);
      }
    }

    if (!recipientEmail) {
      logger.warn(`[OrderEmail] Order ${order.id} has no recipient email address — skipping`);
      return;
    }

    // Build customer name from shipping address
    const firstName = order.shipping_address?.first_name || "";
    const lastName = (order.shipping_address as any)?.last_name || "";
    const customerName = `${firstName} ${lastName}`.trim() || "Valued Customer";

    // Calculate totals from items (Medusa v2 order.total/subtotal are undefined on retrieveOrder)
    const orderItems = (order.items || []).map((item: any) => ({
      title: item.title || item.product_title || "Product",
      quantity: item.quantity || 1,
      unit_price: item.unit_price || 0,
    }));
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0
    );

    const shippingAddress = order.shipping_address
      ? [
          order.shipping_address.address_1,
          order.shipping_address.city,
          order.shipping_address.country_code?.toUpperCase(),
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;

    // Query KNET details if available
    let knetDetails: any = undefined;
    try {
      const paymentResult = await pgConnection.raw(
        `SELECT 
          p.data as payment_data,
          ps.data as session_data,
          pc.amount as pc_amount,
          pc.currency_code as pc_currency
         FROM order_payment_collection opc
         JOIN payment_collection pc ON pc.id = opc.payment_collection_id
         LEFT JOIN payment p ON p.payment_collection_id = pc.id
         LEFT JOIN payment_session ps ON ps.payment_collection_id = pc.id
         WHERE opc.order_id = ?
         LIMIT 1`,
        [order.id]
      );
      if (paymentResult.rows?.length > 0) {
        const row = paymentResult.rows[0];
        const data = row.payment_data || row.session_data || {};
        if (data.knet_payment_id || data.knet_tranid || data.knet_result) {
          let rawAmt = data.knet_amt || data.amt || "";
          if (!rawAmt && row.pc_amount) {
            let numericAmt = Number(row.pc_amount);
            if (row.pc_currency?.toLowerCase() === "kwd" && numericAmt > 500) {
              numericAmt = numericAmt / 1000;
            }
            rawAmt = numericAmt.toFixed(3);
          }
          const formattedAmount = rawAmt ? `${parseFloat(rawAmt).toFixed(3)} KWD` : "";
          knetDetails = {
            paymentId: data.knet_payment_id || data.paymentid || "",
            tranId: data.knet_tranid || data.tranid || "",
            trackId: data.knet_trackid || data.track_id || data.knet_ref || "",
            refId: data.knet_ref || data.ref || "",
            date: data.knet_date || data.knet_postdate || data.postdate || "",
            amount: formattedAmount,
            status: "SUCCESS",
          };
        }
      }
    } catch (knetErr: any) {
      logger.warn(`[OrderEmail] Could not query KNET details for order ${order.id}: ${knetErr?.message || knetErr}`);
    }

    // ── Send Email ──────────────────────────────────────────────────────────
    await sendOrderStatusEmail("order.confirmed", recipientEmail, {
      customerName,
      orderId: order.id,
      displayId: order.display_id,
      items: orderItems,
      subtotal,
      total: subtotal,
      currencyCode: order.currency_code || "kwd",
      shippingAddress,
      knetDetails,
    });

    logger.info(
      `[OrderEmail] ✅ Order confirmation sent to ${order.email} for order #${order.display_id}`
    );

    // ── Send Push Notification ───────────────────────────────────────────────
    // Find the customer's FCM token from their metadata
    if (order.customer_id) {
      try {
        const customerResult = await pgConnection.raw(
          `SELECT metadata FROM customer WHERE id = ?`,
          [order.customer_id]
        );
        const fcmToken = customerResult.rows?.[0]?.metadata?.fcm_token;

        if (fcmToken) {
          await sendPushNotification({
            fcmToken,
            title: "Order Confirmed! 🎉",
            body: `Your order #${order.display_id} has been placed successfully.`,
            data: {
              type: "order.placed",
              order_id: order.id,
              display_id: String(order.display_id),
            },
          });
          logger.info(`[FCM] ✅ Push notification sent for order #${order.display_id}`);
        } else {
          logger.info(`[FCM] No FCM token for customer ${order.customer_id} — skipping push`);
        }
      } catch (pushError: any) {
        // Never fail the subscriber because of push — email already sent
        logger.warn(`[FCM] Push notification failed: ${pushError.message}`);
      }
    }
  } catch (error: any) {
    logger.error(`[OrderEmail] ❌ Failed to send order confirmation for ${data.id}: ${error.message}`);
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
