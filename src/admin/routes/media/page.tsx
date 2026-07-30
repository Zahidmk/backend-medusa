import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo, PencilSquare } from "@medusajs/icons"
import { Container, Heading, Button, Input, createDataTableColumnHelper, DataTable, DataTablePaginationState, useDataTable, Drawer, Badge } from "@medusajs/ui"
import { useRef, useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"

type Media = {
  id: string
  url?: string | null
  mime_type?: string | null
  title?: string | null
  title_ar?: string | null
  thumbnail_url?: string | null
  brand?: string | null
  views?: number | null
  display_order?: number | null
  is_featured?: boolean | null
  product_ids?: string[]
}

type MediaResponse = { media: Media[]; count: number }

type Brand = {
  id: string
  name: string
  logo_url?: string | null
  is_active: boolean
}

type Product = {
  id: string
  title: string
  thumbnail?: string | null
  handle?: string | null
}

const columnHelper = createDataTableColumnHelper<Media>()

// ─── Product Search Picker ────────────────────────────────────────────────────
const ProductPicker = ({
  selectedIds,
  onChange,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) => {
  const [search, setSearch] = useState("")

  const { data, isLoading } = useQuery<{ products: Product[]; count: number }>({
    queryKey: ["admin-products-picker", search],
    queryFn: () => sdk.client.fetch(`/admin/products?q=${encodeURIComponent(search)}&status=all&limit=100`, { method: "GET" }),
    staleTime: 30_000,
  })
  const products = data?.products ?? []

  // Fetch info for selected product IDs if they aren't included in the current search query
  const missingSelectedIds = useMemo(() => {
    return selectedIds.filter((id) => !products.some((p) => p.id === id))
  }, [selectedIds, products])

  const { data: missingData } = useQuery<{ products: Product[] }>({
    queryKey: ["admin-products-missing", missingSelectedIds.join(",")],
    queryFn: () => sdk.client.fetch(`/admin/products?ids=${encodeURIComponent(missingSelectedIds.join(","))}`, { method: "GET" }),
    enabled: missingSelectedIds.length > 0,
    staleTime: 60_000,
  })

  const allKnownProductsMap = useMemo(() => {
    const map = new Map<string, Product>()
    products.forEach((p) => map.set(p.id, p))
    missingData?.products?.forEach((p) => map.set(p.id, p))
    return map
  }, [products, missingData])

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((i) => i !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  return (
    <div>
      <Input
        placeholder="Search products by title or handle…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2"
        style={{ backgroundColor: "#18181b", color: "#ffffff", borderColor: "#3f3f46" }}
      />
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5 p-2 rounded-lg" style={{ backgroundColor: "#18181b", border: "1px solid #27272a" }}>
          {selectedIds.map((id) => {
            const p = allKnownProductsMap.get(id)
            return (
              <span key={id} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full shadow-sm" style={{ backgroundColor: "#2e1065", color: "#f3e8ff", border: "1px solid #6d28d9" }}>
                {p?.thumbnail && (
                  <img src={p.thumbnail} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span className="font-medium max-w-[200px] truncate" style={{ color: "#f3e8ff" }}>{p?.title || id.substring(0, 12) + "…"}</span>
                <button type="button" onClick={() => toggle(id)} className="ml-1 font-bold hover:text-red-400" style={{ color: "#c4b5fd" }}>×</button>
              </span>
            )
          })}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded-lg divide-y shadow-inner" style={{ border: "1px solid #3f3f46", backgroundColor: "#18181b", borderColor: "#27272a" }}>
        {isLoading && <div className="p-3 text-xs text-center" style={{ color: "#a1a1aa" }}>Loading products…</div>}
        {!isLoading && products.length === 0 && <div className="p-3 text-xs text-center" style={{ color: "#a1a1aa" }}>No products found</div>}
        {products.map((p) => {
          const checked = selectedIds.includes(p.id)
          const isPublished = p.status === "published"
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              style={{
                backgroundColor: checked ? "#2e1065" : "#18181b",
                color: checked ? "#f3e8ff" : "#ffffff",
                borderLeft: checked ? "4px solid #8b5cf6" : "none",
                borderColor: "#27272a",
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800"
            >
              <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden border flex items-center justify-center" style={{ backgroundColor: "#27272a", borderColor: "#3f3f46" }}>
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt={p.title} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px]" style={{ color: "#71717a", backgroundColor: "#27272a" }}>No img</div>
                )}
              </div>
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                <span className="text-xs truncate font-medium" style={{ color: checked ? "#f3e8ff" : "#ffffff" }}>
                  {p.title}
                </span>
                <span className="text-[10px]" style={{ color: isPublished ? "#4ade80" : "#a1a1aa" }}>
                  {isPublished ? "Published" : (p.status || "Draft")}
                </span>
              </div>
              {checked && <span className="text-sm font-bold ml-auto" style={{ color: "#a78bfa" }}>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Brand Cell (table) ───────────────────────────────────────────────────────
const BrandCell = ({ name }: { name: string | null | undefined }) => {
  const { data } = useQuery<{ brands: Brand[] }>({
    queryKey: ["admin-brands-picker"],
    queryFn: () => sdk.client.fetch("/admin/brands?limit=500", { method: "GET" }),
    staleTime: 60_000,
  })
  const brand = (data?.brands ?? []).find((b) => b.name === name)

  return (
    <div className="flex items-center gap-2">
      {brand?.logo_url ? (
        <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
          <img src={brand.logo_url} alt={brand.name} className="max-w-full max-h-full object-contain" />
        </div>
      ) : null}
      <span className="text-sm text-zinc-100" style={{ color: "#f4f4f5" }}>{name || "-"}</span>
    </div>
  )
}

const MediaPage = () => {
  const limit = 50
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageSize: limit, pageIndex: 0 })
  const offset = useMemo(() => pagination.pageIndex * limit, [pagination])

  const { data, isLoading, refetch } = useQuery<MediaResponse>({
    queryFn: () => sdk.client.fetch('/admin/media', { query: { limit, offset } }),
    queryKey: [['admin-media', limit, offset]],
  })

  const [openCreate, setOpenCreate] = useState(false)
  const [newMedia, setNewMedia] = useState<Partial<Media>>({})
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [thumbUploading, setThumbUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const thumbFileRef = useRef<HTMLInputElement | null>(null)
  const editThumbFileRef = useRef<HTMLInputElement | null>(null)

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [openEdit, setOpenEdit] = useState(false)
  const [editMedia, setEditMedia] = useState<Partial<Media>>({})
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editMessage, setEditMessage] = useState<string | null>(null)

  const newMediaRef = useRef<Partial<Media>>({})

  const closeAll = () => {
    setOpenCreate(false)
    setOpenEdit(false)
    setMessage(null)
    setEditMessage(null)
    newMediaRef.current = {}
    setNewMedia({})
  }

  const updateNewMedia = (updater: (prev: Partial<Media>) => Partial<Media>) => {
    setNewMedia((prev) => {
      const next = updater(prev)
      newMediaRef.current = next
      return next
    })
  }

  const handleThumbnailUpload = async (file: File, isEditMode: boolean) => {
    setThumbUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/admin/media/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) throw new Error('Thumbnail upload failed')
      const json = await res.json()
      const url = json.url
      if (isEditMode) {
        setEditMedia((p) => ({ ...p, thumbnail_url: url }))
      } else {
        updateNewMedia((p) => ({ ...p, thumbnail_url: url }))
      }
    } catch (err: any) {
      alert(err?.message || 'Thumbnail upload failed')
    } finally {
      setThumbUploading(false)
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setProgress(0)
    setMessage(null)
    try {
      const form = new FormData()
      form.append('file', file)

      let uploadedUrl = ''
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/admin/media/upload`)
        xhr.withCredentials = true
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const resp = JSON.parse(xhr.responseText)
              uploadedUrl = resp.url || ''
              newMediaRef.current = { ...newMediaRef.current, url: uploadedUrl, mime_type: file.type }
              updateNewMedia((p) => ({ ...p, url: uploadedUrl, mime_type: file.type }))
              resolve()
            } catch { reject(new Error('Invalid upload response')) }
          } else { reject(new Error(`Upload failed ${xhr.status}`)) }
        }
        xhr.onerror = () => reject(new Error('Upload network error'))
        xhr.send(form)
      })

      setSubmitting(true)
      setMessage('Saving…')
      const snap = newMediaRef.current
      const payload: any = {
        url: uploadedUrl,
        title: snap.title || file.name,
        title_ar: snap.title_ar || null,
        thumbnail_url: snap.thumbnail_url || null,
        mime_type: file.type,
        views: snap.views || 0,
        display_order: snap.display_order || 0,
        is_featured: snap.is_featured || false,
        product_ids: snap.product_ids || [],
      }
      const res = await fetch('/admin/media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Save failed (${res.status}): ${errText}`)
      }
      setMessage('✅ Media created successfully!')
      setOpenCreate(false)
      newMediaRef.current = {}
      setNewMedia({})
      await refetch()
    } catch (e: any) {
      setMessage(`❌ ${e?.message || 'Upload failed'}`)
    } finally {
      setUploading(false)
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this media?')) return
    await sdk.client.fetch(`/admin/media/${id}`, { method: 'DELETE' })
    await refetch()
  }

  const handleEditOpen = (item: Media) => {
    closeAll()
    setEditMedia({ ...item })
    setOpenEdit(true)
  }

  const handleEditSave = async () => {
    if (!editMedia.id) return
    setEditSubmitting(true)
    setEditMessage(null)
    try {
      const res = await fetch(`/admin/media/${editMedia.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editMedia.title || '',
          title_ar: editMedia.title_ar || null,
          thumbnail_url: editMedia.thumbnail_url || null,
          views: editMedia.views || 0,
          display_order: editMedia.display_order || 0,
          is_featured: editMedia.is_featured || false,
          product_ids: editMedia.product_ids || [],
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`Save failed (${res.status}): ${t}`)
      }
      setEditMessage('✅ Saved successfully!')
      await refetch()
      setTimeout(() => { setOpenEdit(false); setEditMessage(null) }, 800)
    } catch (e: any) {
      setEditMessage(`❌ ${e?.message || 'Failed to save'}`)
    } finally {
      setEditSubmitting(false)
    }
  }

  const columns = [
    columnHelper.accessor('id', { header: 'ID', cell: ({ getValue }) => getValue().substring(0, 8) + '...' }),
    columnHelper.accessor('title', { header: 'Title', cell: ({ getValue }) => getValue() || '-' }),
    columnHelper.display({ id: 'brand', header: 'Brand', cell: ({ row }) => <BrandCell name={row.original.brand} /> }),
    columnHelper.display({
      id: 'type', header: 'Type', cell: ({ row }) => (
        <Badge color={row.original.mime_type?.startsWith('video') ? 'purple' : 'blue'}>
          {row.original.mime_type?.startsWith('video') ? 'Video' : 'Image'}
        </Badge>
      )
    }),
    columnHelper.display({
      id: 'preview', header: 'Preview', cell: ({ row }) => (
        row.original.mime_type && row.original.mime_type.startsWith('video') ? (
          <video src={row.original.url || ''} poster={row.original.thumbnail_url || undefined} className="w-24 h-16 object-contain" controls />
        ) : (
          row.original.url ? <img src={row.original.url} className="w-24 h-16 object-contain" /> : <div className="w-24 h-16 bg-gray-100" />
        )
      )
    }),
    columnHelper.display({
      id: 'products', header: 'Products', cell: ({ row }) => (
        <span className="text-xs text-gray-500">{(row.original.product_ids?.length || 0)} linked</span>
      )
    }),
    columnHelper.accessor('views', { header: 'Views', cell: ({ getValue }) => getValue() || 0 }),
    columnHelper.accessor('display_order', { header: 'Order', cell: ({ getValue }) => getValue() || 0 }),
    columnHelper.display({
      id: 'featured', header: 'Featured', cell: ({ row }) => (
        row.original.is_featured ? <Badge color="green">Yes</Badge> : <span className="text-gray-400">No</span>
      )
    }),
    columnHelper.display({
      id: 'actions', header: 'Actions', cell: ({ row }) => (
        <div className="flex gap-2">
          <Button size="small" variant="secondary" onClick={() => handleEditOpen(row.original)}>
            <PencilSquare className="mr-1" />Edit
          </Button>
          <Button size="small" variant="danger" onClick={() => handleDelete(row.original.id)}>Delete</Button>
        </div>
      )
    }),
  ]

  const table = useDataTable({ columns, data: data?.media || [], getRowId: (r) => r.id, rowCount: data?.count || 0, isLoading, pagination: { state: pagination, onPaginationChange: setPagination } })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between">
          <Heading>Media</Heading>
          <Button variant="primary" onClick={() => { closeAll(); setOpenCreate(true); }}>Create Media</Button>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>

      {/* ── Single Drawer — Create mode ─────────────────────────────── */}
      <Drawer open={openCreate} onOpenChange={(open) => { if (!open) closeAll() }}>
        <Drawer.Header>
          <Drawer.Title>Create Media</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <div className="flex flex-col gap-4">
            <Input placeholder="Title (English)" value={newMedia.title || ''} onChange={(e) => updateNewMedia((p) => ({ ...p, title: e.target.value }))} />
            <Input placeholder="Title (Arabic)" value={newMedia.title_ar || ''} onChange={(e) => updateNewMedia((p) => ({ ...p, title_ar: e.target.value }))} dir="rtl" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Linked Products <span className="text-xs text-gray-400 font-normal">(shown on left side of video)</span>
              </label>
              <ProductPicker selectedIds={newMedia.product_ids || []} onChange={(ids) => updateNewMedia((p) => ({ ...p, product_ids: ids }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Custom Thumbnail <span className="text-xs text-gray-400 font-normal">(optional poster image for video)</span>
              </label>
              <div className="flex items-center gap-3">
                {newMedia.thumbnail_url ? (
                  <div className="w-16 h-12 rounded bg-zinc-800 border border-zinc-700 overflow-hidden flex-shrink-0 relative group">
                    <img src={newMedia.thumbnail_url} alt="Thumbnail" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => updateNewMedia(p => ({ ...p, thumbnail_url: null }))}
                      className="absolute inset-0 bg-black/70 text-red-400 font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
                <input ref={thumbFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f, false) }} />
                <Button size="small" variant="secondary" onClick={() => thumbFileRef.current?.click()} isLoading={thumbUploading}>
                  {thumbUploading ? "Uploading..." : newMedia.thumbnail_url ? "Change Thumbnail" : "Upload Thumbnail Image"}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input id="isFeatured" type="checkbox" checked={!!newMedia.is_featured} onChange={(e) => updateNewMedia((p) => ({ ...p, is_featured: e.target.checked }))} />
              <label htmlFor="isFeatured" className="text-sm">Featured Video (show prominently)</label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Upload File <span className="text-xs text-gray-400 font-normal">(image or video — saves automatically)</span>
              </label>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) handleUpload(f) }}
                className="p-6 border-dashed border-2 border-gray-300 rounded-lg text-center hover:border-violet-400 transition-colors"
              >
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
                <p className="text-sm text-gray-500 mb-3">Drag &amp; drop an image or video here, or</p>
                <Button onClick={() => fileRef.current?.click()} isLoading={uploading || submitting} variant="secondary">
                  {uploading ? `Uploading ${progress}%…` : submitting ? 'Saving…' : 'Select File'}
                </Button>
              </div>
              {message && (
                <div className={`mt-2 text-sm px-3 py-2 rounded ${message.includes('❌') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                  {message}
                </div>
              )}
            </div>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex gap-2 w-full justify-end">
            <Drawer.Close asChild>
              <Button variant="secondary" onClick={closeAll}>Cancel</Button>
            </Drawer.Close>
          </div>
        </Drawer.Footer>
      </Drawer>

      {/* ── Single Drawer — Edit mode ───────────────────────────────── */}
      <Drawer open={openEdit} onOpenChange={(open) => { if (!open) closeAll() }}>
        <Drawer.Header>
          <Drawer.Title>Edit Media</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <div className="flex flex-col gap-4">
            {editMedia.url && (
              <div className="flex justify-center bg-gray-50 rounded-lg p-3 border border-gray-200">
                {editMedia.mime_type?.startsWith('video') ? (
                  <video src={editMedia.url} poster={editMedia.thumbnail_url || undefined} className="max-h-40 rounded" controls />
                ) : (
                  <img src={editMedia.url} className="max-h-40 object-contain rounded" />
                )}
              </div>
            )}
            <Input placeholder="Title (English)" value={editMedia.title || ''} onChange={(e) => setEditMedia((p) => ({ ...p, title: e.target.value }))} />
            <Input placeholder="Title (Arabic)" value={editMedia.title_ar || ''} onChange={(e) => setEditMedia((p) => ({ ...p, title_ar: e.target.value }))} dir="rtl" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Custom Thumbnail <span className="text-xs text-gray-400 font-normal">(poster image for video)</span>
              </label>
              <div className="flex items-center gap-3">
                {editMedia.thumbnail_url ? (
                  <div className="w-16 h-12 rounded bg-zinc-800 border border-zinc-700 overflow-hidden flex-shrink-0 relative group">
                    <img src={editMedia.thumbnail_url} alt="Thumbnail" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setEditMedia(p => ({ ...p, thumbnail_url: null }))}
                      className="absolute inset-0 bg-black/70 text-red-400 font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
                <input ref={editThumbFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f, true) }} />
                <Button size="small" variant="secondary" onClick={() => editThumbFileRef.current?.click()} isLoading={thumbUploading}>
                  {thumbUploading ? "Uploading..." : editMedia.thumbnail_url ? "Change Thumbnail" : "Upload Thumbnail Image"}
                </Button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Linked Products <span className="text-xs text-gray-400 font-normal">(shown on right side of video)</span>
              </label>
              <ProductPicker selectedIds={editMedia.product_ids || []} onChange={(ids) => setEditMedia((p) => ({ ...p, product_ids: ids }))} />
            </div>
            <div className="flex items-center gap-3">
              <input id="editIsFeatured" type="checkbox" checked={!!editMedia.is_featured} onChange={(e) => setEditMedia((p) => ({ ...p, is_featured: e.target.checked }))} />
              <label htmlFor="editIsFeatured" className="text-sm">Featured Video (show prominently)</label>
            </div>
            {editMessage && (
              <div className={`text-sm px-3 py-2 rounded ${editMessage.includes('❌') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {editMessage}
              </div>
            )}
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex gap-2 w-full justify-end">
            <Drawer.Close asChild>
              <Button variant="secondary" onClick={closeAll}>Cancel</Button>
            </Drawer.Close>
            <Button isLoading={editSubmitting} onClick={handleEditSave}>Save Changes</Button>
          </div>
        </Drawer.Footer>
      </Drawer>

    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Media', icon: Photo })
export default MediaPage
