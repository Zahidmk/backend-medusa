import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RETURN_REQUEST_MODULE } from "../../../../modules/return-request"
import { sendReturnEmail } from "../../../../lib/email"
import { emailPayload } from "../../../../lib/return-requests"

const STATUSES = ["requested", "approved", "rejected", "refunded"]
const EMAIL_FOR: Record<string, "approved" | "rejected" | "refunded"> = {
  approved: "approved",
  rejected: "rejected",
  refunded: "refunded",
}

// POST /admin/return-requests/:id  body: { status, admin_notes?, refund_amount? }
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve(RETURN_REQUEST_MODULE) as any
  const { id } = req.params as { id: string }
  const body = (req.body || {}) as any

  const current = await svc.retrieveReturnRequest(id).catch(() => null)
  if (!current) return res.status(404).json({ message: "Request not found" })

  const update: any = { id }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return res.status(400).json({ message: "Invalid status" })
    if (current.status === "refunded" && body.status !== "refunded") {
      return res.status(400).json({ message: "A refunded request cannot be reopened" })
    }
    update.status = body.status
    if (body.status !== "requested") update.processed_at = new Date()
  }
  if (body.admin_notes !== undefined) update.admin_notes = String(body.admin_notes).slice(0, 1000)
  if (body.refund_amount !== undefined) {
    const amount = Math.round(Number(body.refund_amount))
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: "Invalid refund amount" })
    update.refund_amount = amount
  }

  const updated = await svc.updateReturnRequests(update)

  if (update.status && update.status !== current.status && EMAIL_FOR[update.status]) {
    void sendReturnEmail(EMAIL_FOR[update.status], emailPayload(updated))
  }
  res.json({ request: updated })
}
