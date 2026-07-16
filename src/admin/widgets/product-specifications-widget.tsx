import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge } from "@medusajs/ui"
import type { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"

// ─────────────────────────────────────────────
// Product Specifications Widget
// Shows the Odoo product specifications in the
// admin dashboard under the product description
// ─────────────────────────────────────────────

type Specification = {
  key: string
  value: string
  primary: boolean
}

const ProductSpecificationsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const metadata = (data as any)?.metadata || {}

  // Parse specifications from metadata
  let specs: Specification[] = []
  if (metadata.specifications) {
    try {
      const parsed =
        typeof metadata.specifications === "string"
          ? JSON.parse(metadata.specifications)
          : metadata.specifications

      if (Array.isArray(parsed)) {
        specs = parsed
      } else if (typeof parsed === "object" && parsed !== null) {
        specs = Object.entries(parsed).map(([k, v]) => ({
          key: k,
          value: String(v),
          primary: false,
        }))
      }
    } catch (e) {
      console.warn("Failed to parse product specifications:", e)
    }
  }

  if (specs.length === 0) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Product Specifications</Heading>
          <Text className="text-ui-fg-subtle text-sm">Synced from Odoo</Text>
        </div>
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-muted text-sm">
            No specifications found. Trigger a product webhook from Odoo to sync specifications.
          </Text>
        </div>
      </Container>
    )
  }

  const primarySpecs = specs.filter((s) => s.primary)
  const otherSpecs = specs.filter((s) => !s.primary)

  return (
    <Container className="divide-y p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Product Specifications</Heading>
        <div className="flex items-center gap-2">
          <Badge color="blue" size="2xsmall">
            {specs.length} spec{specs.length !== 1 ? "s" : ""}
          </Badge>
          <Text className="text-ui-fg-subtle text-sm">Synced from Odoo</Text>
        </div>
      </div>

      {/* Primary Specifications */}
      {primarySpecs.length > 0 && (
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Text className="text-ui-fg-base text-sm font-semibold">Primary Specifications</Text>
            <Badge color="green" size="2xsmall">Shown on storefront</Badge>
          </div>
          <div className="rounded-lg border border-ui-border-base overflow-hidden">
            {primarySpecs.map((spec, idx) => (
              <div
                key={`primary-${idx}`}
                className={`grid grid-cols-2 px-4 py-3 border-b border-ui-border-base last:border-b-0 ${
                  idx % 2 === 0 ? "bg-ui-bg-subtle" : "bg-ui-bg-base"
                }`}
              >
                <Text className="text-ui-fg-subtle text-sm font-medium">{spec.key}</Text>
                <Text className="text-ui-fg-base text-sm">{spec.value}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other Specifications */}
      {otherSpecs.length > 0 && (
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Text className="text-ui-fg-base text-sm font-semibold">Additional Specifications</Text>
            <Badge color="grey" size="2xsmall">In "View More Details" modal</Badge>
          </div>
          <div className="rounded-lg border border-ui-border-base overflow-hidden">
            {otherSpecs.map((spec, idx) => (
              <div
                key={`other-${idx}`}
                className={`grid grid-cols-2 px-4 py-3 border-b border-ui-border-base last:border-b-0 ${
                  idx % 2 === 0 ? "bg-ui-bg-subtle" : "bg-ui-bg-base"
                }`}
              >
                <Text className="text-ui-fg-subtle text-sm font-medium">{spec.key}</Text>
                <Text className="text-ui-fg-base text-sm">{spec.value}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Odoo Metadata Info */}
      <div className="px-6 py-3 bg-ui-bg-subtle">
        <div className="flex flex-wrap gap-4">
          {metadata.brand && (
            <div className="flex items-center gap-1">
              <Text className="text-ui-fg-muted text-xs">Brand:</Text>
              <Text className="text-ui-fg-subtle text-xs font-medium">{metadata.brand}</Text>
            </div>
          )}
          {metadata.odoo_id && (
            <div className="flex items-center gap-1">
              <Text className="text-ui-fg-muted text-xs">Odoo ID:</Text>
              <Text className="text-ui-fg-subtle text-xs font-medium">{metadata.odoo_id}</Text>
            </div>
          )}
          {metadata.odoo_category_name && (
            <div className="flex items-center gap-1">
              <Text className="text-ui-fg-muted text-xs">Category:</Text>
              <Text className="text-ui-fg-subtle text-xs font-medium">{metadata.odoo_category_name}</Text>
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSpecificationsWidget
