import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container } from "@medusajs/ui"

/**
 * Delivery Type Widget — appears at the top of the order detail page.
 * Reads the shipping method name and displays the delivery type with
 * colour coding: Standard (blue), Express/Fast (orange), Night (indigo).
 */
const DeliveryTypeWidget = ({ data }: { data: any }) => {
  const shippingMethodName: string =
    data?.shipping_methods?.[0]?.name || ""

  const getDeliveryType = () => {
    const n = shippingMethodName.toLowerCase()
    if (n.includes("night")) {
      return {
        label: "Night Delivery",
        sublabel: "Delivered between 10 PM – 2 AM",
        emoji: "🌙",
        bg: "#eef2ff",
        border: "#818cf8",
        color: "#3730a3",
        dot: "#6366f1",
      }
    }
    if (n.includes("express") || n.includes("fast")) {
      return {
        label: "Express Delivery",
        sublabel: "Delivered within 2–4 hours",
        emoji: "⚡",
        bg: "#fff7ed",
        border: "#fb923c",
        color: "#9a3412",
        dot: "#f97316",
      }
    }
    return {
      label: "Standard Delivery",
      sublabel: "Delivered within 1–3 business days",
      emoji: "🚚",
      bg: "#eff6ff",
      border: "#60a5fa",
      color: "#1e40af",
      dot: "#3b82f6",
    }
  }

  const dt = getDeliveryType()
  const amount = data?.shipping_methods?.[0]?.amount
  const currency = data?.currency_code?.toUpperCase() || "KWD"

  return (
    <Container>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "14px 16px",
          borderRadius: "10px",
          background: dt.bg,
          border: `1.5px solid ${dt.border}`,
        }}
      >
        {/* Emoji icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "white",
            border: `2px solid ${dt.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {dt.emoji}
        </div>

        {/* Labels */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: dt.color }}>
              {dt.label}
            </span>
            {shippingMethodName && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.7)",
                  color: dt.color,
                  border: `1px solid ${dt.border}`,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: dt.dot,
                    display: "inline-block",
                  }}
                />
                {shippingMethodName}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: dt.color, opacity: 0.75, marginTop: 2 }}>
            {dt.sublabel}
          </p>
        </div>

        {/* Shipping fee */}
        {amount != null && amount > 0 && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: dt.color, opacity: 0.65 }}>Shipping fee</p>
            <p style={{ fontWeight: 700, fontSize: 15, color: dt.color }}>
              {(amount / 1000).toFixed(3)} {currency}
            </p>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.before",
})

export default DeliveryTypeWidget
