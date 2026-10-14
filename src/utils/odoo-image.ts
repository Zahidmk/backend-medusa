/**
 * Odoo only serves /web/image/... publicly for website-published products, so
 * images are fetched by the backend (with its Odoo login) and served from
 * GET /odoo/image/:id — see src/api/odoo/image/[id]/route.ts.
 */
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://admin.markasouq.com").replace(/\/$/, "")

/** URL of a product.template main image, a product.image gallery image when galleryId is given, or a product.product variant image when variantId is given. */
export function odooImageUrl(templateId: number | string, galleryId?: number | string, variantId?: number | string): string {
  const base = `${PUBLIC_BACKEND_URL}/odoo/image/${templateId}`
  if (variantId) return `${base}?variant=${variantId}`
  return galleryId ? `${base}?gallery=${galleryId}` : base
}
