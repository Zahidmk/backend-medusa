import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const odooIdsParam = req.query.ids as string;
  if (!odooIdsParam) {
    return res.json({ handles: [] });
  }

  const odooIds = odooIdsParam.split(",").map(id => id.trim()).filter(Boolean);
  if (odooIds.length === 0) {
    return res.json({ handles: [] });
  }

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    
    // Postgres parameterization for IN clause
    const placeholders = odooIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await pgConnection.raw(`
      SELECT handle, metadata->>'odoo_id' as odoo_id
      FROM product
      WHERE metadata->>'odoo_id' IN (${placeholders})
        AND deleted_at IS NULL
    `, odooIds);

    const handles = result.rows.map((r: any) => r.handle);
    
    res.json({ handles });
  } catch (e) {
    console.error("[odoo-handles] Error resolving Odoo IDs to handles:", e);
    res.status(500).json({ error: "Internal server error", handles: [] });
  }
}
