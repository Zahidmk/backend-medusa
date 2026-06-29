import { defineRouteConfig } from "@medusajs/admin-sdk"
import { TagSolid, XMark, MagnifyingGlass, Plus, Trash, Check } from "@medusajs/icons"
import { Container, Heading, Button, Input, Text, clx, Badge } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useRef, useCallback } from "react"
import { sdk } from "../../lib/sdk"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type Brand = {
  id: string
  name: string
  slug?: string
  description?: string
  logo_url?: string
  banner_url?: string
  is_active: boolean
  is_special: boolean
  created_at: string
}

type MedusaProduct = {
  id: string
  title: string
  handle: string
  thumbnail?: string
  status?: string
  variants?: { id: string }[]
}

type BrandsResponse = {
  brands: Brand[]
  count: number
  offset: number
  limit: number
}

// ─────────────────────────────────────────────
// Utility: debounce
// ─────────────────────────────────────────────
function useDebounce<T>(value: T, delay = 350): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debouncedValue
}

// ─────────────────────────────────────────────
// Product Assignment Modal
// ─────────────────────────────────────────────
const ProductAssignModal = ({
  brand,
  onClose,
}: {
  brand: Brand
  onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search)
  const [tab, setTab] = useState<"linked" | "all">("linked")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [tab])

  // Fetch product IDs already linked to this brand
  const { data: linkedData, isLoading: linkedLoading } = useQuery<{ product_ids: string[] }>({
    queryKey: ["brand-product-ids", brand.id],
    queryFn: () =>
      sdk.client.fetch(`/admin/brands/${brand.id}/products`, { method: "GET" }),
  })
  const linkedIds = linkedData?.product_ids ?? []

  // Fetch all Medusa products (search-filtered)
  const { data: allProductsData, isLoading: allLoading } = useQuery<{ products: MedusaProduct[]; count: number }>({
    queryKey: ["admin-products-search", debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50", offset: "0" })
      if (debouncedSearch) params.set("q", debouncedSearch)
      return sdk.client.fetch(`/admin/products?${params.toString()}`, { method: "GET" })
    },
  })
  const allProducts = allProductsData?.products ?? []

  // Fetch full product details for linked IDs
  const { data: linkedProductsData, isLoading: linkedProductsLoading } = useQuery<{ products: MedusaProduct[] }>({
    queryKey: ["admin-products-linked", linkedIds],
    enabled: linkedIds.length > 0,
    queryFn: () => {
      const params = new URLSearchParams()
      linkedIds.forEach((id) => params.append("id[]", id))
      params.set("limit", "200")
      return sdk.client.fetch(`/admin/products?${params.toString()}`, { method: "GET" })
    },
  })
  const linkedProducts = linkedProductsData?.products ?? []

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["brand-product-ids", brand.id] })
    queryClient.invalidateQueries({ queryKey: ["admin-products-linked", linkedIds] })
    queryClient.invalidateQueries({ queryKey: ["brands"] })
  }, [queryClient, brand.id, linkedIds])

  const linkMutation = useMutation({
    mutationFn: (productId: string) =>
      sdk.client.fetch(`/admin/brands/${brand.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { product_id: productId },
      }),
    onSuccess: () => invalidate(),
  })

  const unlinkMutation = useMutation({
    mutationFn: (productId: string) =>
      sdk.client.fetch(`/admin/brands/${brand.id}/products`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: { product_id: productId },
      }),
    onSuccess: () => invalidate(),
  })

  const isLinked = (id: string) => linkedIds.includes(id)
  const isMutating = linkMutation.isPending || unlinkMutation.isPending

  // Filter linked products based on search when on "linked" tab
  const filteredLinked = linkedProducts.filter((p) =>
    debouncedSearch
      ? p.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      p.handle?.toLowerCase().includes(debouncedSearch.toLowerCase())
      : true
  )

  const tabProducts = tab === "linked" ? filteredLinked : allProducts
  const isTabLoading = tab === "linked"
    ? (linkedLoading || linkedProductsLoading)
    : allLoading

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-indigo-50 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Assign Products</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage products linked to <span className="font-semibold text-violet-700">{brand.name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
          >
            <XMark className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs + Search */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
          {/* Tab bar */}
          <div className="flex items-center gap-1 mb-3">
            <button
              onClick={() => setTab("linked")}
              className={clx(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                tab === "linked"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              Linked Products
              {linkedIds.length > 0 && (
                <span className={clx(
                  "ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold",
                  tab === "linked" ? "bg-white/25 text-white" : "bg-violet-100 text-violet-700"
                )}>
                  {linkedIds.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("all")}
              className={clx(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                tab === "all"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              All Products
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder={tab === "linked" ? "Search linked products…" : "Search all products…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent focus:bg-white transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <XMark className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Products List */}
        <div className="flex-1 overflow-y-auto">
          {isTabLoading ? (
            <div className="flex flex-col gap-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 animate-pulse">
                  <div className="w-14 h-14 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-4 bg-gray-100 rounded w-1/2 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                  </div>
                  <div className="w-24 h-8 bg-gray-100 rounded-lg" />
                </div>
              ))}
            </div>
          ) : tabProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <TagSolid className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-600 font-medium">
                {tab === "linked"
                  ? linkedIds.length === 0
                    ? "No products linked yet"
                    : "No products match your search"
                  : "No products found"}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {tab === "linked" && linkedIds.length === 0
                  ? "Switch to \"All Products\" tab to assign products to this brand."
                  : "Try a different search term."}
              </p>
              {tab === "linked" && linkedIds.length === 0 && (
                <button
                  onClick={() => setTab("all")}
                  className="mt-4 px-4 py-2 text-sm font-medium text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 transition-colors"
                >
                  Browse All Products →
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {tabProducts.map((product) => {
                const linked = isLinked(product.id)
                const isPending =
                  (linkMutation.isPending && (linkMutation.variables as string) === product.id) ||
                  (unlinkMutation.isPending && (unlinkMutation.variables as string) === product.id)

                return (
                  <li
                    key={product.id}
                    className={clx(
                      "flex items-center gap-4 px-6 py-3.5 transition-colors",
                      linked ? "bg-violet-50/40" : "hover:bg-gray-50"
                    )}
                  >
                    {/* Thumbnail */}
                    <div className="w-14 h-14 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-200">
                      {product.thumbnail ? (
                        <img
                          src={product.thumbnail}
                          alt={product.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">
                          📦
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate text-sm">{product.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate font-mono">/{product.handle}</p>
                    </div>

                    {/* Status badge */}
                    {linked && (
                      <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-700 bg-violet-100 rounded-full flex-shrink-0">
                        <Check className="w-3 h-3" />
                        Linked
                      </span>
                    )}

                    {/* Action button */}
                    <button
                      disabled={isPending || isMutating}
                      onClick={() => {
                        if (linked) {
                          unlinkMutation.mutate(product.id)
                        } else {
                          linkMutation.mutate(product.id)
                        }
                      }}
                      className={clx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0 border",
                        isPending
                          ? "opacity-50 cursor-not-allowed bg-gray-100 border-gray-200 text-gray-400"
                          : linked
                            ? "bg-white border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                            : "bg-white border-violet-200 text-violet-600 hover:bg-violet-50 hover:border-violet-300"
                      )}
                    >
                      {isPending ? (
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : linked ? (
                        <Trash className="w-3 h-3" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      {isPending ? "Saving…" : linked ? "Remove" : "Add"}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-gray-400">
            {linkedIds.length} product{linkedIds.length !== 1 ? "s" : ""} linked to {brand.name}
          </p>
          <Button variant="secondary" size="small" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Brand Card
// ─────────────────────────────────────────────
const BrandCard = ({
  brand,
  onEdit,
  onDelete,
  onAssign,
}: {
  brand: Brand
  onEdit: (brand: Brand) => void
  onDelete: (id: string) => void
  onAssign: (brand: Brand) => void
}) => {
  const [showActions, setShowActions] = useState(false)

  // Resolve logo URL for the admin UI
  const resolvedLogoUrl = (() => {
    if (!brand.logo_url) return null
    if (brand.logo_url.startsWith("/brands/")) return `https://website.markasouqs.com${brand.logo_url}`
    if (brand.logo_url.includes("oskarllc-new")) return null // Odoo placeholders
    return brand.logo_url
  })()

  // Quick linked count badge
  const { data } = useQuery<{ product_ids: string[] }>({
    queryKey: ["brand-product-ids", brand.id],
    queryFn: () =>
      sdk.client.fetch(`/admin/brands/${brand.id}/products`, { method: "GET" }),
  })
  const linkedCount = data?.product_ids?.length ?? 0

  return (
    <div
      className="relative bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-200 hover:shadow-lg hover:border-gray-200 group"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Logo Container */}
      <div className="p-4 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 min-h-[120px]">
        <div className="w-full h-24 rounded-xl bg-white shadow-sm flex items-center justify-center overflow-hidden border border-gray-100">
          {resolvedLogoUrl ? (
            <img
              src={resolvedLogoUrl}
              alt={brand.name}
              className="w-full h-full object-contain p-2"
              onError={(e) => {
                const target = e.currentTarget
                target.style.display = "none"
                const parent = target.parentElement
                if (parent) {
                  parent.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f3f4f6;font-size:28px;font-weight:700;color:#6b7280;letter-spacing:1px">${brand.name.slice(0,2).toUpperCase()}</div>`
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 text-gray-400">
              <TagSolid className="w-8 h-8" />
              <span className="text-xs font-medium">{brand.name.slice(0,2).toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Brand Info */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-start justify-between mb-1 gap-1">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{brand.name}</h3>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <Badge color={brand.is_active ? "green" : "grey"} size="small">
              {brand.is_active ? "Active" : "Inactive"}
            </Badge>
            {brand.is_special && (
              <Badge color="orange" size="small">
                ⭐ Special
              </Badge>
            )}
          </div>
        </div>
        {/* Product count pill */}
        <button
          onClick={() => onAssign(brand)}
          className="mt-1 flex items-center gap-1 text-xs text-violet-600 font-medium hover:text-violet-800 transition-colors"
        >
          <span className="inline-block w-4 h-4 rounded-full bg-violet-100 text-center leading-4 text-[10px] font-bold">
            {linkedCount}
          </span>
          product{linkedCount !== 1 ? "s" : ""} linked · Manage →
        </button>
      </div>

      {/* Hover Actions Overlay */}
      <div
        className={clx(
          "absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 transition-opacity duration-200 p-4",
          showActions ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <Button
          variant="secondary"
          size="small"
          onClick={() => onAssign(brand)}
          className="w-full bg-violet-600 border-0 text-white hover:bg-violet-700 flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Assign Products
        </Button>
        <div className="flex gap-2 w-full">
          <Button
            variant="secondary"
            size="small"
            onClick={() => onEdit(brand)}
            className="flex-1 bg-white hover:bg-gray-50"
          >
            Edit
          </Button>
          <Button
            variant="danger"
            size="small"
            onClick={() => onDelete(brand.id)}
            className="flex-1"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Brand Form Drawer (Create / Edit)
// ─────────────────────────────────────────────
const BrandFormDrawer = ({
  isOpen,
  onClose,
  brand,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  brand: Brand | null
  onSave: (data: any) => void
}) => {
  // State is initialized directly from brand at mount.
  // The parent uses key={brand?.id ?? "new"} to force remount when brand changes.
  const [name, setName] = useState(() => brand?.name || "")
  const [description, setDescription] = useState(() => brand?.description || "")
  const [logoFile, setLogoFile] = useState<File | null>(null)
  // Logo preview: relative paths like /brands/... must be prefixed with the storefront domain
  // because the admin lives on a different subdomain.
  const toPreviewUrl = (url: string | undefined) => {
    if (!url) return ""
    if (url.includes("oskarllc-new")) return ""
    if (url.startsWith("/static/")) return `https://admin.markasouqs.com${url}`
    if (url.startsWith("/brands/")) return `https://website.markasouqs.com${url}`
    if (url.startsWith("/")) return `https://website.markasouqs.com${url}`
    return url
  }
  const [logoPreview, setLogoPreview] = useState(() => toPreviewUrl(brand?.logo_url))
  const [isActive, setIsActive] = useState(() => brand?.is_active ?? true)
  const [isSpecial, setIsSpecial] = useState(() => brand?.is_special ?? false)
  const [isLoading, setIsLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset when brand changes
  useEffect(() => {
    setName(brand?.name || "")
    setDescription(brand?.description || "")
    setLogoFile(null)
    setLogoPreview(toPreviewUrl(brand?.logo_url))
    setIsActive(brand?.is_active ?? true)
    setIsSpecial(brand?.is_special ?? false)
  }, [brand])
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setSaveError("Brand name is required")
      return
    }
    setIsLoading(true)
    setSaveError(null)
    try {
      let logoUrl = brand?.logo_url || ""
      if (logoFile) {
        const formData = new FormData()
        formData.append("files", logoFile)
        const uploadRes = await fetch("/admin/uploads", {
          method: "POST",
          body: formData,
          credentials: "include",
        })
        const uploadData = await uploadRes.json()
        const resolved =
          uploadData?.url ||
          uploadData?.uploads?.[0]?.url ||
          null
        if (!uploadRes.ok || !resolved) {
          console.error("Upload failed:", uploadData)
          throw new Error(uploadData?.message || "Logo upload failed — check backend logs")
        }
        logoUrl = resolved
      }
      onSave({ id: brand?.id, name: name.trim(), description, logo_url: logoUrl, is_active: isActive, is_special: isSpecial })
    } catch (error: any) {
      console.error("Error saving brand:", error)
      setSaveError(error?.message || "Failed to save brand")
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {brand ? "Edit Brand" : "Create Brand"}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
            >
              <XMark className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Logo */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Brand Logo</label>
              <div className="flex justify-center">
                <div className="w-48 h-24 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 relative cursor-pointer group hover:border-violet-400 transition-colors">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="max-w-[85%] max-h-[85%] object-contain" />
                  ) : (
                    <div className="text-center p-2">
                      <TagSolid className="w-8 h-8 text-gray-400 mx-auto mb-1" />
                      <span className="text-xs text-gray-500 block">Click to upload logo</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none">
                    <span className="text-white text-sm font-medium bg-white/20 px-3 py-1 rounded-full">
                      {logoPreview ? "Change" : "Upload"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Brand Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter brand name"
                className="w-full"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter brand description (optional)"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-none text-sm"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
              <div>
                <span className="text-sm font-medium text-gray-700 block">Active Status</span>
                <span className="text-xs text-gray-500">Brand will be visible on the store</span>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={clx(
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2",
                  isActive ? "bg-green-500" : "bg-gray-300"
                )}
              >
                <span
                  className={clx(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    isActive ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {/* Special Brand toggle */}
            <div className="flex items-center justify-between py-2 px-3 bg-amber-50 rounded-lg border border-amber-100">
              <div>
                <span className="text-sm font-medium text-amber-800 block">⭐ Special Brand</span>
                <span className="text-xs text-amber-600">Show this brand in the frontend Special Explore section</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSpecial(!isSpecial)}
                className={clx(
                  "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2",
                  isSpecial ? "bg-amber-500" : "bg-gray-300"
                )}
              >
                <span
                  className={clx(
                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    isSpecial ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            {saveError && (
              <p className="w-full text-sm text-red-600 self-center">⚠️ {saveError}</p>
            )}
            <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto justify-center">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || isLoading}
              className="w-full sm:w-auto justify-center bg-violet-600 border-violet-600 hover:bg-violet-700"
            >
              {isLoading ? "Saving…" : brand ? "Update Brand" : "Create Brand"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main Brands Page
// ─────────────────────────────────────────────
const BrandsPage = () => {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [assigningBrand, setAssigningBrand] = useState<Brand | null>(null)

  const { data, isLoading, error } = useQuery<BrandsResponse>({
    queryKey: ["brands"],
    queryFn: async () => sdk.client.fetch("/admin/brands?limit=100", { method: "GET" }) as Promise<BrandsResponse>,
  })

  const createMutation = useMutation({
    mutationFn: (brandData: any) =>
      sdk.client.fetch("/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: brandData,  // sdk.client.fetch serializes automatically — do NOT JSON.stringify
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] })
      setIsDrawerOpen(false)
      setEditingBrand(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (brandData: any) =>
      sdk.client.fetch(`/admin/brands/${brandData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: brandData,  // sdk.client.fetch serializes automatically — do NOT JSON.stringify
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] })
      setIsDrawerOpen(false)
      setEditingBrand(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/brands/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brands"] }),
  })

  const handleEdit = (brand: Brand) => {
    setEditingBrand(brand)
    setIsDrawerOpen(true)
  }

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this brand? All product links will be lost.")) {
      deleteMutation.mutate(id)
    }
  }

  const handleSave = (data: any) => {
    if (data.id) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const filteredBrands = (data?.brands ?? []).filter((brand) =>
    brand.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const stats = {
    total: data?.brands?.length || 0,
    active: data?.brands?.filter((b) => b.is_active).length || 0,
    inactive: data?.brands?.filter((b) => !b.is_active).length || 0,
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Container className="py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <Heading level="h1" className="text-2xl font-bold text-gray-900">
              Brands Management
            </Heading>
            <Text className="text-gray-500 mt-1">
              Create brands, then click <span className="font-semibold text-violet-600">"Assign Products"</span> to link products
            </Text>
          </div>
          <Button
            onClick={() => { setEditingBrand(null); setIsDrawerOpen(true) }}
            className="sm:w-auto w-full bg-violet-600 border-violet-600 hover:bg-violet-700"
          >
            + Add New Brand
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Brands", value: stats.total, color: "blue", dot: false },
            { label: "Active Brands", value: stats.active, color: "green", dot: true },
            { label: "Inactive Brands", value: stats.inactive, color: "gray", dot: true },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-${s.color}-100`}>
                  {s.dot
                    ? <div className={`w-3 h-3 rounded-full bg-${s.color}-500`} />
                    : <TagSolid className={`w-5 h-5 text-${s.color}-600`} />
                  }
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="text-sm text-gray-500">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search brands…"
              className="pl-10"
            />
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <Text className="text-red-600 font-medium">Failed to load brands</Text>
          </div>
        ) : filteredBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <TagSolid className="w-8 h-8 text-gray-400" />
            </div>
            <Text className="text-gray-600 font-medium">
              {searchQuery ? "No brands found" : "No brands yet"}
            </Text>
            <Text className="text-gray-500 text-sm mt-1">
              {searchQuery ? "Try a different search term" : "Add your first brand to get started"}
            </Text>
            {!searchQuery && (
              <Button
                onClick={() => { setEditingBrand(null); setIsDrawerOpen(true) }}
                className="mt-4"
                variant="secondary"
              >
                + Add Brand
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredBrands.map((brand) => (
              <BrandCard
                key={brand.id}
                brand={brand}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAssign={setAssigningBrand}
              />
            ))}
          </div>
        )}
      </Container>

      {/* Brand create / edit drawer — key forces remount on different brand to reset all form state */}
      <BrandFormDrawer
        key={editingBrand?.id ?? "new"}
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setEditingBrand(null) }}
        brand={editingBrand}
        onSave={handleSave}
      />

      {/* Product assignment modal */}
      {assigningBrand && (
        <ProductAssignModal
          brand={assigningBrand}
          onClose={() => setAssigningBrand(null)}
        />
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Brands",
  icon: TagSolid,
})

export default BrandsPage
