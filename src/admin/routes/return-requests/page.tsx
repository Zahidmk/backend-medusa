import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUturnLeft } from "@medusajs/icons"
import { Container, Heading, Text, Button, Badge, Textarea, Select, toast } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { sdk } from "../../lib/sdk"

type RequestItem = { id: string; title: string; quantity: number; unit_price: number }
type ReturnRequest = {
  id: string
  order_id: string
  display_id: string | null
  customer_email: string
  customer_name: string | null
  type: "cancel_item" | "cancel_order" | "return"
  items: RequestItem[] | null
  reason: string | null
  payment_method: "cod" | "knet"
  currency_code: string
  refund_amount: number
  refund_method: "none" | "bank_transfer" | "original_payment"
  bank_details: { account_holder: string; bank_name: string; iban: string } | null
  status: "requested" | "approved" | "rejected" | "refunded"
  admin_notes: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  cancel_item: "Item cancellation",
  cancel_order: "Order cancelled (paid)",
  return: "Return",
}
const STATUS_COLOR: Record<string, "orange" | "blue" | "red" | "green"> = {
  requested: "orange",
  approved: "blue",
  rejected: "red",
  refunded: "green",
}

// Prices are stored in fils (1000 = KWD 1.000)
const money = (fils: number, currency: string) =>
  currency.toLowerCase() === "kwd" ? `KWD ${(fils / 1000).toFixed(3)}` : `${currency.toUpperCase()} ${(fils / 100).toFixed(2)}`

const RequestCard = ({ r }: { r: ReturnRequest }) => {
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState(r.admin_notes || "")

  const update = useMutation({
    mutationFn: (status: ReturnRequest["status"]) =>
      sdk.client.fetch(`/admin/return-requests/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { status, admin_notes: notes },
      }),
    onSuccess: () => {
      toast.success("Request updated — customer notified")
      queryClient.invalidateQueries({ queryKey: ["return-requests"] })
    },
    onError: (e: any) => toast.error(e?.message || "Update failed"),
  })

  const closed = r.status === "rejected" || r.status === "refunded"

  return (
    <Container className="mb-4 p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level="h2">Order #{r.display_id}</Heading>
          <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
          <Badge color="grey">{TYPE_LABEL[r.type]}</Badge>
          <Badge color={r.payment_method === "knet" ? "purple" : "grey"}>
            {r.payment_method === "knet" ? "KNET (paid)" : "COD"}
          </Badge>
        </div>
        <Text size="small" className="text-ui-fg-subtle">{new Date(r.created_at).toLocaleString()}</Text>
      </div>

      <div className="grid gap-6 px-6 py-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Text size="small" weight="plus">Customer</Text>
            <Text size="small">{r.customer_name || "—"} · {r.customer_email}</Text>
          </div>
          <div>
            <Text size="small" weight="plus">Items</Text>
            {(r.items || []).map((i) => (
              <Text size="small" key={i.id}>
                {i.title} × {i.quantity} — {money(i.unit_price * i.quantity, r.currency_code)}
              </Text>
            ))}
          </div>
          {r.reason && (
            <div>
              <Text size="small" weight="plus">Reason</Text>
              <Text size="small">{r.reason}</Text>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Text size="small" weight="plus">Refund due</Text>
            <Text size="large" weight="plus">
              {r.refund_amount > 0 ? money(r.refund_amount, r.currency_code) : "No refund (nothing paid)"}
            </Text>
          </div>
          {r.refund_method === "bank_transfer" && r.bank_details && (
            <div className="rounded-md border bg-ui-bg-subtle p-3">
              <Text size="small" weight="plus">Send refund by bank transfer</Text>
              <Text size="small">Account holder: {r.bank_details.account_holder}</Text>
              <Text size="small">Bank: {r.bank_details.bank_name}</Text>
              <Text size="small" className="font-mono">IBAN: {r.bank_details.iban}</Text>
            </div>
          )}
          {r.refund_method === "original_payment" && (
            <div className="rounded-md border bg-ui-bg-subtle p-3">
              <Text size="small">
                Paid online with KNET — refund this amount from the KNET merchant portal, then mark it refunded here.
              </Text>
            </div>
          )}
        </div>
      </div>

      <div className="border-t px-6 py-4">
        <Textarea
          placeholder="Note to customer (shown in the email) — optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={closed}
          rows={2}
        />
        {!closed && (
          <div className="mt-3 flex flex-wrap gap-2">
            {r.status === "requested" && (
              <>
                <Button size="small" onClick={() => update.mutate("approved")} isLoading={update.isPending}>
                  Approve
                </Button>
                <Button size="small" variant="danger" onClick={() => update.mutate("rejected")} isLoading={update.isPending}>
                  Reject
                </Button>
              </>
            )}
            {r.refund_amount > 0 && (
              <Button size="small" variant="secondary" onClick={() => update.mutate("refunded")} isLoading={update.isPending}>
                Mark refunded
              </Button>
            )}
          </div>
        )}
        {closed && r.admin_notes && (
          <Text size="small" className="mt-2 text-ui-fg-subtle">Note sent: {r.admin_notes}</Text>
        )}
      </div>
    </Container>
  )
}

const ReturnRequestsPage = () => {
  const [filter, setFilter] = useState("requested")
  const { data, isLoading } = useQuery({
    queryKey: ["return-requests", filter],
    queryFn: () =>
      sdk.client.fetch(`/admin/return-requests${filter === "all" ? "" : `?status=${filter}`}`, {
        method: "GET",
      }) as Promise<{ requests: ReturnRequest[]; count: number }>,
  })

  return (
    <div className="flex flex-col gap-4">
      <Container className="flex items-center justify-between">
        <div>
          <Heading level="h1">Returns & Refunds</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Customer cancellation and return requests, and refunds owed on cancelled paid orders.
          </Text>
        </div>
        <div className="w-48">
          <Select value={filter} onValueChange={setFilter}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {["requested", "approved", "refunded", "rejected", "all"].map((s) => (
                <Select.Item key={s} value={s}>
                  {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </Container>

      {isLoading && <Text className="px-2">Loading…</Text>}
      {!isLoading && !data?.requests?.length && (
        <Container>
          <Text className="text-ui-fg-subtle">No {filter === "all" ? "" : filter} requests.</Text>
        </Container>
      )}
      {data?.requests?.map((r) => (
        <RequestCard key={r.id} r={r} />
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Returns & Refunds",
  icon: ArrowUturnLeft,
})

export default ReturnRequestsPage
