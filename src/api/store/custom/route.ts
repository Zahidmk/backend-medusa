import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const freeThreshold = Number(process.env.FREE_DELIVERY_THRESHOLD_KWD || 7);
  const shippingBelowThreshold = Number(
    process.env.SHIPPING_CHARGE_BELOW_THRESHOLD_KWD || 1
  );

  // Fetch real shipping option IDs + prices from DB
  let nightId = "so_night_delivery_marqa_01";
  let normalId = "so_01KAARY0HHJP2Z1QQ17J33V2H4"; // Standard Shipping
  let nightPrice  = 2000;
  let normalPrice = 1000;

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const rows = await pgConnection.raw(`
      SELECT so.id, so.name, p.amount
      FROM shipping_option so
      JOIN shipping_option_price_set sops ON sops.shipping_option_id = so.id
      JOIN price p ON p.price_set_id = sops.price_set_id
      WHERE so.deleted_at IS NULL
        AND p.currency_code = 'kwd'
      ORDER BY p.amount ASC
    `);

    for (const row of rows.rows || []) {
      const name = (row.name || "").toLowerCase();
      if (name.includes("night")) {
        nightId    = row.id;
        nightPrice = row.amount;
      } else if (name.includes("standard") || name.includes("normal")) {
        normalId    = row.id;
        normalPrice = row.amount;
      }
    }
  } catch (e) {
    // Fall back to hardcoded values if DB query fails
    console.warn("[custom/route] Could not load shipping options from DB:", e);
  }

  const options = [
    {
      key: "night",
      id: nightId,
      label: "Night Delivery",
      label_ar: "توصيل ليلي",
      price: nightPrice,
      estimated_days: "Same night",
      estimated_days_ar: "نفس الليلة",
    },
    {
      key: "normal",
      id: normalId,
      label: "Normal Delivery",
      label_ar: "توصيل عادي",
      price: normalPrice,
      estimated_days: "3-5 days",
      estimated_days_ar: "٣-٥ أيام",
    },
  ];

  res.status(200).json({
    delivery_options: options,
    shipping_policy: {
      currency: "KWD",
      free_delivery_threshold: freeThreshold,
      charge_below_threshold: shippingBelowThreshold,
      summary: `Free delivery for ${freeThreshold} KD or above, otherwise ${shippingBelowThreshold} KD shipping charge.`,
    },
  });
}
