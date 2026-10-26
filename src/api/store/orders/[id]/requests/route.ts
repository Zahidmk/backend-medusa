import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RETURN_REQUEST_MODULE } from "../../../../../modules/return-request"
import { sendReturnEmail } from "../../../../../lib/email"
import {
  RETURN_WINDOW_DAYS,
  emailPayload,
  getOrderFacts,
  isKnetPaid,
  loadOrder,
  maskRequest,
  validateBankDetails,
} from "../../../../../lib/return-requests"

const OPEN_STATUSES = ["requested", "approved", "refunded"] // everything except rejected

async function loadOwnedOrder(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized: not logged in" })
    return null
  }
  const order = await loadOrder(req.scope, (req.params as any).id)
  if (!order) {
    res.status(404).json({ message: "Order not found" })
    return null
  }
  if (order.customer_id !== customerId) {
    res.status(403).json({ message: "Forbidden: this order does not belong to you" })
    return null
  }
  return order
}

// GET /store/orders/:id/requests — the customer's cancel/return requests for this order
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const order = await loadOwnedOrder(req, res)
  if (!order) return
  const svc = req.scope.resolve(RETURN_REQUEST_MODULE) as any
  const requests = await svc.listReturnRequests({ order_id: order.id }, { order: { created_at: "DESC" } })
  const facts = getOrderFacts(order)
  const windowEnds = facts.deliveredAt ? new Date(facts.deliveredAt.getTime() + RETURN_WINDOW_DAYS * 86400000) : null
  const pg = req.scope.resolve("__pg_connection__") as any
  res.json({
    requests: requests.map(maskRequest),
    eligibility: {
      can_cancel_items: !facts.shipped && !["canceled", "completed", "archived"].includes(order.status),
      can_return: facts.delivered && !!windowEnds && windowEnds.getTime() > Date.now(),
      return_window_ends: windowEnds,
      return_window_days: RETURN_WINDOW_DAYS,
      requires_bank_details: !(await isKnetPaid(pg, order.id)),
    },
  })
}

// POST /store/orders/:id/requests
// body: { type: "cancel_item" | "return", items: [{ id, quantity }], reason?, bank_details? }
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const order = await loadOwnedOrder(req, res)
  if (!order) return

  const body = (req.body || {}) as any
  const type = String(body.type || "")
  if (!["cancel_item", "return"].includes(type)) {
    return res.status(400).json({ message: "type must be cancel_item or return" })
  }
  if (["canceled", "archived"].includes(order.status)) {
    return res.status(400).json({ message: `Order is already ${order.status}` })
  }

  const facts = getOrderFacts(order)
  if (type === "cancel_item" && facts.shipped) {
    return res.status(400).json({ message: "This order has already shipped. You can request a return once it is delivered." })
  }
  if (type === "return") {
    if (!facts.delivered) {
      return res.status(400).json({ message: "Returns can only be requested after the order is delivered." })
    }
    const deadline = facts.deliveredAt ? facts.deliveredAt.getTime() + RETURN_WINDOW_DAYS * 86400000 : Infinity
    if (deadline < Date.now()) {
      return res.status(400).json({ message: `The ${RETURN_WINDOW_DAYS}-day return window has ended.` })
    }
    if (String(body.reason || "").trim().length < 3) {
      return res.status(400).json({ message: "Please tell us the reason for the return." })
    }
  }

  const svc = req.scope.resolve(RETURN_REQUEST_MODULE) as any
  const existing: any[] = (await svc.listReturnRequests({ order_id: order.id })).filter((r: any) => OPEN_STATUSES.includes(r.status))
  if (existing.some((r) => r.type === "cancel_order")) {
    return res.status(400).json({ message: "This order was cancelled and a refund is already being processed." })
  }
  const alreadyRequested = new Map<string, number>()
  for (const r of existing) for (const i of r.items || []) alreadyRequested.set(i.id, (alreadyRequested.get(i.id) || 0) + Number(i.quantity || 0))

  const wanted: Array<{ id: string; quantity: number }> = Array.isArray(body.items) ? body.items : []
  if (!wanted.length) return res.status(400).json({ message: "Select at least one item." })

  const items: any[] = []
  for (const w of wanted) {
    const line = (order.items || []).find((i: any) => i.id === w.id)
    const qty = Math.floor(Number(w.quantity || 0))
    if (!line || qty < 1) return res.status(400).json({ message: "Invalid item selection." })
    const remaining = Number(line.quantity) - (alreadyRequested.get(line.id) || 0)
    if (qty > remaining) {
      return res.status(400).json({ message: `"${line.title}" already has a pending request for the available quantity.` })
    }
    items.push({ id: line.id, title: line.title, quantity: qty, unit_price: Number(line.unit_price || 0) })
  }

  const pg = req.scope.resolve("__pg_connection__") as any
  const knet = await isKnetPaid(pg, order.id)
  const refundable = type === "return" || knet
  const refundAmount = refundable ? items.reduce((s, i) => s + i.unit_price * i.quantity, 0) : 0

  let bank: any = null
  let refundMethod = "none"
  if (refundable && knet) refundMethod = "original_payment"
  if (refundable && !knet) {
    const v = validateBankDetails(body.bank_details)
    if (!v.ok) return res.status(400).json({ message: v.message, field: "bank_details" })
    bank = v.value
    refundMethod = "bank_transfer"
  }

  const first = order.shipping_address?.first_name || ""
  const last = order.shipping_address?.last_name || ""
  const created = await svc.createReturnRequests({
    order_id: order.id,
    display_id: String(order.display_id ?? ""),
    customer_id: order.customer_id,
    customer_email: order.email || "",
    customer_name: `${first} ${last}`.trim() || null,
    type,
    items,
    reason: String(body.reason || "").trim().slice(0, 1000) || null,
    payment_method: knet ? "knet" : "cod",
    currency_code: order.currency_code || "kwd",
    refund_amount: refundAmount,
    refund_method: refundMethod,
    bank_details: bank,
    status: "requested",
  })

  // Fire-and-forget so a mail outage never fails the request
  void sendReturnEmail("admin_new", emailPayload(created))
  void sendReturnEmail("received", emailPayload(created))

  res.status(201).json({ success: true, request: maskRequest(created) })
}
