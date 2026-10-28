import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import { Container, Heading, Text } from "@medusajs/ui"
import { useState } from "react"
import type { DetailWidgetProps, AdminProductVariant } from "@medusajs/framework/types"

// Read-only preview of the variant's picture. Odoo is the source of truth: the sync stores the URL in
// the variant's metadata.image_url (variant image, or the first "Extra Variant Images" picture).
const VariantImageWidget = ({ data }: DetailWidgetProps<AdminProductVariant>) => {
  const imageUrl = ((data as any)?.metadata?.image_url as string | undefined) || ""
  const [failed, setFailed] = useState(false)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Variant image</Heading>
        <Text size="small" className="text-ui-fg-subtle">Synced from Odoo</Text>
      </div>
      <div className="flex items-center gap-x-6 px-6 py-4">
        <div className="bg-ui-bg-subtle border-ui-border-base flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
          {imageUrl && !failed ? (
            <img
              src={imageUrl}
              alt={data?.title || "Variant"}
              className="h-full w-full object-contain"
              onError={() => setFailed(true)}
            />
          ) : (
            <Photo className="text-ui-fg-muted" />
          )}
        </div>
        <div className="min-w-0">
          {imageUrl ? (
            <>
              <Text size="small" weight="plus">{failed ? "Image could not be loaded" : data?.title}</Text>
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ui-fg-interactive block max-w-full truncate text-sm"
              >
                {imageUrl}
              </a>
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              No image for this variant. Upload one on the variant in Odoo; it appears here after the next sync.
            </Text>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product_variant.details.after",
})

export default VariantImageWidget
