import { model } from "@medusajs/framework/utils"

// A customer's request to cancel items of an order, return delivered items, or
// a refund that is owed because a paid order was cancelled.
const ReturnRequest = model.define("return_request", {
  id: model.id().primaryKey(),
  order_id: model.text(),
  display_id: model.text().nullable(),
  customer_id: model.text().nullable(),
  customer_email: model.text(),
  customer_name: model.text().nullable(),
  type: model.text(), // cancel_item | cancel_order | return
  items: model.json().nullable(), // [{ id, title, quantity, unit_price }]
  reason: model.text().nullable(),
  payment_method: model.text().default("cod"), // cod | knet
  currency_code: model.text().default("kwd"),
  refund_amount: model.number().default(0), // stored in fils, like order prices
  refund_method: model.text().default("none"), // none | bank_transfer | original_payment
  bank_details: model.json().nullable(), // { account_holder, bank_name, iban }
  status: model.text().default("requested"), // requested | approved | rejected | refunded
  admin_notes: model.text().nullable(),
  processed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default ReturnRequest
