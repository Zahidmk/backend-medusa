import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = (req.query || {}) as Record<string, any>;
    const cartId = query.cart_id as string;
    const orderId = query.order_id as string;
    const trackId = query.track_id as string;

    if (!cartId && !orderId && !trackId) {
      return res.status(400).json({ error: "Missing identifier (cart_id, order_id, or track_id required)" });
    }

    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

    let rows: any[] = [];

    if (orderId) {
      const orderQuery = await pgConnection.raw(
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
        [orderId]
      );
      rows = orderQuery.rows || [];
    }

    if (rows.length === 0 && cartId) {
      const cartQuery = await pgConnection.raw(
        `SELECT 
          p.data as payment_data,
          ps.data as session_data,
          pc.amount as pc_amount,
          pc.currency_code as pc_currency
         FROM cart_payment_collection cpc
         JOIN payment_collection pc ON pc.id = cpc.payment_collection_id
         LEFT JOIN payment_session ps ON ps.payment_collection_id = pc.id
         LEFT JOIN payment p ON p.payment_collection_id = pc.id
         WHERE cpc.cart_id = ?
         ORDER BY ps.created_at DESC NULLS LAST
         LIMIT 1`,
        [cartId]
      );
      rows = cartQuery.rows || [];
    }

    if (rows.length === 0 && trackId) {
      const trackQuery = await pgConnection.raw(
        `SELECT 
          p.data as payment_data,
          ps.data as session_data,
          pc.amount as pc_amount,
          pc.currency_code as pc_currency
         FROM payment_session ps
         JOIN payment_collection pc ON pc.id = ps.payment_collection_id
         LEFT JOIN payment p ON p.payment_collection_id = pc.id
         WHERE ps.id = ? OR ps.data->>'track_id' = ? OR ps.data->>'trackId' = ? OR ps.data->>'knet_trackid' = ?
         LIMIT 1`,
        [trackId, trackId, trackId, trackId]
      );
      rows = trackQuery.rows || [];
    }

    if (rows.length === 0) {
      return res.status(404).json({ knet_details: null });
    }

    const row = rows[0];
    const data = row.payment_data || row.session_data || {};

    let rawAmt = data.knet_amt || data.amt || "";
    if (!rawAmt && row.pc_amount) {
      let numericAmt = Number(row.pc_amount);
      if (row.pc_currency?.toLowerCase() === "kwd" && numericAmt > 500) {
        numericAmt = numericAmt / 1000;
      }
      rawAmt = numericAmt.toFixed(3);
    }
    const formattedAmount = rawAmt ? `${parseFloat(rawAmt).toFixed(3)} KWD` : "";

    const knetDetails = {
      payment_id: data.knet_payment_id || data.paymentid || "",
      tran_id: data.knet_tranid || data.tranid || "",
      track_id: data.knet_trackid || data.track_id || trackId || data.knet_ref || "",
      ref_id: data.knet_ref || data.ref || "",
      result: data.knet_result || data.result || "PENDING",
      status: data.knet_result || data.status || "PENDING",
      date: data.knet_date || data.knet_postdate || data.postdate || "",
      amount: formattedAmount,
    };

    return res.json({ knet_details: knetDetails });
  } catch (error: any) {
    console.error("[KNET Details API Error]:", error);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
}
