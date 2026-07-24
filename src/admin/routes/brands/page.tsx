import { defineRouteConfig } from "@medusajs/admin-sdk"
import { TagSolid, MagnifyingGlass, Check, StarSolid } from "@medusajs/icons"
import { Container, Heading, Button, Input, Text, clx, Badge } from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
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

type BrandsResponse = {
  brands: Brand[]
  count: number
  offset: number
  limit: number
}

// ─────────────────────────────────────────────
// Brand Card (with 1-click Special toggle)
// ─────────────────────────────────────────────
const BrandCard = ({ brand }: { brand: Brand }) => {
  const queryClient = useQueryClient()

  // Toggle Special Brand Status Mutation
  const toggleSpecialMutation = useMutation({
    mutationFn: (newSpecialState: boolean) =>
      sdk.client.fetch(`/admin/brands/${brand.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: { is_special: newSpecialState },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] })
    },
  })

  // Resolve logo URL for admin display
  const resolvedLogoUrl = (() => {
    if (!brand.logo_url) return null
    if (brand.logo_url.startsWith("http://") || brand.logo_url.startsWith("https://")) {
      return brand.logo_url
    }
    if (brand.logo_url.startsWith("/static/uploads/") || brand.logo_url.startsWith("/brands/")) {
      return `https://website.markasouqs.com${brand.logo_url}`
    }
    return brand.logo_url
  })()

  // Quick linked count badge
  const { data } = useQuery<{ product_ids: string[] }>({
    queryKey: ["brand-product-ids", brand.id],
    queryFn: () =>
      sdk.client.fetch(`/admin/brands/${brand.id}/products`, { method: "GET" }),
  })
  const linkedCount = data?.product_ids?.length ?? 0
  const isPending = toggleSpecialMutation.isPending

  return (
    <div
      className={clx(
        "relative bg-white rounded-2xl shadow-sm border overflow-hidden transition-all duration-200 flex flex-col justify-between",
        brand.is_special
          ? "border-amber-300 ring-2 ring-amber-400/20 bg-amber-50/10"
          : "border-gray-100 hover:border-gray-200"
      )}
    >
      {/* Special Badge Indicator */}
      {brand.is_special && (
        <div className="absolute top-3 right-3 z-10">
          <Badge color="orange" size="small" className="shadow-sm font-semibold flex items-center gap-1">
            <StarSolid className="w-3 h-3 text-amber-500" />
            Special Assigned
          </Badge>
        </div>
      )}

      <div>
        {/* Logo Container */}
        <div className="p-4 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100/60 min-h-[120px]">
          <div className="w-full h-24 rounded-xl bg-white shadow-sm flex items-center justify-center overflow-hidden border border-gray-100 p-2">
            {resolvedLogoUrl ? (
              <img
                src={resolvedLogoUrl}
                alt={brand.name}
                className="w-full h-full object-contain"
                onError={(e) => {
                  const target = e.currentTarget
                  target.style.display = "none"
                  const parent = target.parentElement
                  if (parent) {
                    parent.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f3f4f6;font-size:24px;font-weight:700;color:#6b7280">${brand.name.slice(0, 2).toUpperCase()}</div>`
                  }
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-gray-400">
                <TagSolid className="w-7 h-7" />
                <span className="text-xs font-bold">{brand.name.slice(0, 2).toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Brand Details */}
        <div className="p-4">
          <h3 className="font-bold text-gray-900 text-base truncate">{brand.name}</h3>
          <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500 font-medium">
            <span>{linkedCount} product{linkedCount !== 1 ? "s" : ""}</span>
            <Badge color={brand.is_active ? "green" : "grey"} size="small">
              {brand.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Special Toggle Action Button */}
      <div className="p-4 pt-0">
        <button
          disabled={isPending}
          onClick={() => toggleSpecialMutation.mutate(!brand.is_special)}
          className={clx(
            "w-full py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all border cursor-pointer",
            isPending && "opacity-50 cursor-not-allowed",
            brand.is_special
              ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500 shadow-sm"
              : "bg-white hover:bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-300"
          )}
        >
          {isPending ? (
            <span className="animate-spin">⌛</span>
          ) : brand.is_special ? (
            <>
              <Check className="w-4 h-4" />
              Special Brand (Assigned)
            </>
          ) : (
            <>
              <StarSolid className="w-4 h-4 text-amber-500" />
              Assign Special Brand
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main Brands Showcase & Special Assignment Page
// ─────────────────────────────────────────────
const BrandsPage = () => {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")

  const { data, isLoading, error } = useQuery<BrandsResponse>({
    queryKey: ["brands"],
    queryFn: async () => sdk.client.fetch("/admin/brands?limit=200", { method: "GET" }) as Promise<BrandsResponse>,
  })

  // Mass Reset Mutation to unmark all special brands
  const resetSpecialMutation = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/brands/reset-special", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] })
    },
  })

  const filteredBrands = (data?.brands ?? []).filter((brand) =>
    brand.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const specialCount = (data?.brands ?? []).filter((b) => b.is_special).length

  return (
    <div className="min-h-screen bg-gray-50/50">
      <Container className="py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <Heading level="h1" className="text-2xl font-bold text-gray-900">
              Brands & Special Homepage Showcase
            </Heading>
            <Text className="text-gray-500 mt-1">
              Brands are automatically synced from Odoo. Click <span className="font-semibold text-amber-600">"Assign Special Brand"</span> to showcase a brand in the homepage Explore section.
            </Text>
          </div>

          {/* Reset All Special Brands Action */}
          {specialCount > 0 && (
            <Button
              variant="secondary"
              disabled={resetSpecialMutation.isPending}
              onClick={() => {
                if (confirm("Are you sure you want to unmark ALL brands as Special?")) {
                  resetSpecialMutation.mutate()
                }
              }}
              className="sm:w-auto w-full text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200"
            >
              {resetSpecialMutation.isPending ? "Resetting…" : "Reset All Special Brands"}
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-100">
                <TagSolid className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data?.brands?.length || 0}</p>
                <p className="text-sm text-gray-500">Total Synced Brands</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-100">
                <StarSolid className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-900">{specialCount}</p>
                <p className="text-sm text-amber-700 font-medium">Assigned Special Brands</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-green-100">
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {(data?.brands ?? []).filter((b) => b.is_active).length}
                </p>
                <p className="text-sm text-gray-500">Active Brands</p>
              </div>
            </div>
          </div>
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
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
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
            <Text className="text-gray-600 font-medium">No brands found</Text>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredBrands.map((brand) => (
              <BrandCard key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Brands",
  icon: TagSolid,
})

export default BrandsPage
