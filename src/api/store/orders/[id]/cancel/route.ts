import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { getOrderFacts, loadOrder } from "../../../../../lib/return-requests"

/**
 * POST /store/orders/:id/cancel
 *
 * Allows a logged-in customer to cancel their own pending order.
 * Medusa v2 has no built-in store cancel endpoint, so we implement it here.
 *
 * Auth: requires customer bearer/session token (enforced via middlewares.ts)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params as { id: string }

  // The authenticate middleware attaches the customer actor to req.auth_context
  const customerId = (req as any).auth_context?.actor_id

  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized: not logged in" })
  }

  try {
    const orderService = req.scope.resolve(Modules.ORDER)

    // Fetch the order (no "customer" relation in Medusa v2 — customer_id is a scalar field)
    const [order] = await orderService.listOrders(
      { id },
      { relations: ["items"] }
    )

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    // Security: ensure the order belongs to this customer
    if (order.customer_id !== customerId) {
      return res.status(403).json({ message: "Forbidden: this order does not belong to you" })
    }

    // Can only cancel non-completed orders
    const nonCancellableStatuses = ["canceled", "completed", "archived"]
    if (nonCancellableStatuses.includes(order.status)) {
      return res.status(400).json({
        message: `Order cannot be cancelled (current status: ${order.status})`,
      })
    }

    // Once shipped, cancelling is no longer possible — the customer must use the return flow
    const detailed = await loadOrder(req.scope, id)
    if (detailed && getOrderFacts(detailed).shipped) {
      return res.status(400).json({
        message: "This order has already shipped. Once it is delivered you can request a return instead.",
      })
    }

    // Cancel using Medusa order workflow. A refund-due record for KNET-paid orders and the
    // Odoo cancellation are handled by the order.canceled subscriber.
    await cancelOrderWorkflow(req.scope).run({
      input: { order_id: id },
    })

    // Re-fetch updated order
    const [updatedOrder] = await orderService.listOrders({ id }, {})

    return res.status(200).json({ order: updatedOrder, success: true })
  } catch (err: any) {
    console.error("[store/orders/cancel] error:", err?.message || err)
    return res.status(500).json({
      message: err?.message || "Failed to cancel order",
      success: false,
    })
  }
}
