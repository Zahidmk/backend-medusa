import { RETURN_REQUEST_MODULE } from "../modules/return-request"
import { sendReturnEmail, computeOrderTotals } from "./email"

export const RETURN_WINDOW_DAYS = 45

export type OrderFacts = {
  shipped: boolean
  delivered: boolean
  deliveredAt: Date | null
}

/** Reads shipped/delivered state from Odoo-driven metadata and Medusa fulfillments. */
export function getOrderFacts(order: any): OrderFacts {
  const meta = order.metadata || {}
  const fulfillments: any[] = order.fulfillments || []
  const deliveredAtRaw =
    meta.odoo_delivered_at || fulfillments.find((f) => f.delivered_at)?.delivered_at || null
  const delivered = !!(meta.odoo_delivered || fulfillments.some((f) => f.delivered_at))
  const shipped = delivered || !!(meta.odoo_shipped || fulfillments.some((f) => f.shipped_at))
  return { shipped, delivered, deliveredAt: deliveredAtRaw ? new Date(deliveredAtRaw) : null }
}

/** True when the order was paid online through KNET (as opposed to cash on delivery). */
export async function isKnetPaid(pgConnection: any, orderId: string): Promise<boolean> {
  const result = await pgConnection.raw(
    `SELECT p.provider_id AS payment_provider, ps.provider_id AS session_provider
       FROM order_payment_collection opc
       JOIN payment_collection pc ON pc.id = opc.payment_collection_id
       LEFT JOIN payment p ON p.payment_collection_id = pc.id
       LEFT JOIN payment_session ps ON ps.payment_collection_id = pc.id
      WHERE opc.order_id = ?`,
    [orderId]
  )
  return (result.rows || []).some((row: any) =>
    /knet/i.test(`${row.payment_provider || ""} ${row.session_provider || ""}`)
  )
}

export function validateBankDetails(raw: any): { ok: true; value: { account_holder: string; bank_name: string; iban: string } } | { ok: false; message: string } {
  const account_holder = String(raw?.account_holder || "").trim()
  const bank_name = String(raw?.bank_name || "").trim()
  const iban = String(raw?.iban || "").replace(/\s+/g, "").toUpperCase()
  if (account_holder.length < 3) return { ok: false, message: "Account holder name is required" }
  if (bank_name.length < 2) return { ok: false, message: "Bank name is required" }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return { ok: false, message: "Enter a valid IBAN (for Kuwait: KW + 28 characters)" }
  if (iban.startsWith("KW") && iban.length !== 30) return { ok: false, message: "A Kuwait IBAN must be 30 characters (KW + 28)" }
  return { ok: true, value: { account_holder, bank_name, iban } }
}

/** Customer-safe view: only the last 4 IBAN characters leave the server. */
export function maskRequest(r: any) {
  const { bank_details, ...rest } = r
  return {
    ...rest,
    bank_details: bank_details
      ? { account_holder: bank_details.account_holder, bank_name: bank_details.bank_name, iban_last4: String(bank_details.iban || "").slice(-4) }
      : null,
  }
}

export function emailPayload(r: any) {
  return {
    customerName: r.customer_name || "Valued Customer",
    customerEmail: r.customer_email,
    displayId: r.display_id,
    type: r.type,
    items: (r.items || []).map((i: any) => ({ title: i.title, quantity: i.quantity })),
    reason: r.reason,
    refundAmount: Number(r.refund_amount || 0),
    currencyCode: r.currency_code || "kwd",
    refundMethod: r.refund_method,
    paymentMethod: r.payment_method,
    bankLast4: r.bank_details?.iban ? String(r.bank_details.iban).slice(-4) : undefined,
    adminNotes: r.admin_notes,
  }
}

/** Loads an order in the shape the request rules need. */
export async function loadOrder(container: any, orderId: string): Promise<any | null> {
  const query = container.resolve("query")
  const { data } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: [
      "id", "display_id", "email", "status", "customer_id", "currency_code", "created_at", "metadata",
      "items.*", "shipping_methods.*", "shipping_address.*", "fulfillments.*",
    ],
  })
  return data?.[0] ?? null
}

/**
 * Records that a paid (KNET) order was cancelled and money is owed back.
 * Idempotent: one cancel_order request per order.
 */
export async function createRefundDueForCancelledOrder(container: any, order: any): Promise<any | null> {
  const svc = container.resolve(RETURN_REQUEST_MODULE) as any
  const existing = await svc.listReturnRequests({ order_id: order.id, type: "cancel_order" })
  if (existing.length) return null

  const totals = computeOrderTotals(order)
  const first = order.shipping_address?.first_name || ""
  const last = order.shipping_address?.last_name || ""
  const created = await svc.createReturnRequests({
    order_id: order.id,
    display_id: String(order.display_id ?? ""),
    customer_id: order.customer_id ?? null,
    customer_email: order.email || "",
    customer_name: `${first} ${last}`.trim() || null,
    type: "cancel_order",
    items: (order.items || []).map((i: any) => ({ id: i.id, title: i.title, quantity: i.quantity, unit_price: Number(i.unit_price || 0) })),
    reason: "Order cancelled after online payment",
    payment_method: "knet",
    currency_code: order.currency_code || "kwd",
    refund_amount: totals.total,
    refund_method: "original_payment",
    status: "requested",
  })
  await sendReturnEmail("admin_new", emailPayload(created))
  await sendReturnEmail("received", emailPayload(created))
  return created
}
