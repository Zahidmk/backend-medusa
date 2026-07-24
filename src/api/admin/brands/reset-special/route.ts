import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const AUTHENTICATE = true

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const pgConnection = req.scope.resolve("__pg_connection__") as any
    await pgConnection.raw(`UPDATE brand SET is_special = false, updated_at = NOW()`)
    res.json({ success: true, message: "All brands updated to non-special" })
  } catch (e: any) {
    console.error("Reset special brands error:", e)
    res.status(500).json({ message: e?.message || "Failed to reset special brands" })
  }
}
