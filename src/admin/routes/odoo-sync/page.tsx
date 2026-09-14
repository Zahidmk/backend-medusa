/**
 * Admin UI — Odoo Sync Dashboard
 * Route: /app/odoo-sync
 *
 * One page with a "Sync Now" button per sync type (Products, Inventory,
 * Categories, Brands), each showing its own last-sync time and a result
 * summary after running. Every button calls an existing admin endpoint —
 * this page doesn't duplicate any sync logic.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Button, Heading, Text } from "@medusajs/ui"
import { ArrowPathMini, CheckCircle, ExclamationCircle, ArrowPath } from "@medusajs/icons"
import { defineRouteConfig } from "@medusajs/admin-sdk"

interface SyncResult {
  success: boolean
  message?: string
  error?: string
  elapsed_ms?: number
  [key: string]: any
}

interface SyncCardConfig {
  key: string
  title: string
  description: string
  apiBase: string
  formatStatus: (status: any) => { label: string; value: string }[]
}

const CARDS: SyncCardConfig[] = [
  {
    key: "products",
    title: "Products",
    description: "Imports new products from Odoo. Existing products are also refreshed automatically every 5 minutes.",
    apiBase: "/admin/odoo/sync-now",
    formatStatus: (s) => [
      { label: "Odoo products", value: s?.odoo_products ?? "—" },
      { label: "Medusa products", value: s?.medusa_products ?? "—" },
      { label: "Missing", value: s?.missing ?? "—" },
    ],
  },
  {
    key: "inventory",
    title: "Inventory",
    description: "Updates stock quantities for already-synced variants by matching SKU.",
    apiBase: "/admin/odoo/sync-inventory",
    formatStatus: (s) => [
      { label: "Inventory items", value: s?.inventory?.items ?? "—" },
      { label: "Inventory levels", value: s?.inventory?.levels ?? "—" },
    ],
  },
  {
    key: "categories",
    title: "Categories",
    description: "Syncs instantly via webhook + every 5 min backup. Use this for an immediate full sync.",
    apiBase: "/admin/odoo/sync-categories",
    formatStatus: (s) => [
      { label: "Total", value: s?.categories?.total ?? "—" },
      { label: "Parents", value: s?.categories?.root ?? "—" },
      { label: "Subcategories", value: s?.categories?.children ?? "—" },
    ],
  },
  {
    key: "brands",
    title: "Brands",
    description: "Also runs automatically once a day. Use this to pull new Odoo brands immediately.",
    apiBase: "/admin/odoo/sync-brands",
    formatStatus: (s) => [
      { label: "Brands", value: s?.brands?.total ?? "—" },
    ],
  },
]

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never synced"
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}

export interface SyncCardHandle {
  runSync: () => Promise<SyncResult>
}

const SyncCard = forwardRef<SyncCardHandle, { card: SyncCardConfig }>(({ card }, ref) => {
  const [status, setStatus] = useState<any>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)

  const fetchStatus = async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch(card.apiBase, { credentials: "include", headers: { "Content-Type": "application/json" } })
      const data: any = await res.json()
      if (data.success) setStatus(data)
    } catch {
      // ignore — status is best-effort
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSync = async (): Promise<SyncResult> => {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch(card.apiBase, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } })
      const data: any = await res.json()
      setResult(data)
      if (data.success) await fetchStatus()
      return data
    } catch (e: any) {
      const failure = { success: false, error: e.message }
      setResult(failure)
      return failure
    } finally {
      setSyncing(false)
    }
  }

  useImperativeHandle(ref, () => ({ runSync: handleSync }))

  const statusRows = formatStatusSafe(card, status)

  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading level="h2" className="text-base">{card.title}</Heading>
          <Text className="text-ui-fg-subtle text-sm mt-1">{card.description}</Text>
        </div>
        <Button variant="secondary" size="small" isLoading={syncing} disabled={syncing} onClick={handleSync}>
          <ArrowPathMini className="mr-1.5" />
          {syncing ? "Syncing..." : "Sync Now"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 border-t border-ui-border-base pt-3">
        <div>
          <Text className="text-xs text-ui-fg-subtle uppercase tracking-wider">Last Sync</Text>
          <Text className="text-sm font-semibold">{loadingStatus ? "..." : formatDate(status?.last_sync)}</Text>
        </div>
        {statusRows.map((row) => (
          <div key={row.label}>
            <Text className="text-xs text-ui-fg-subtle uppercase tracking-wider">{row.label}</Text>
            <Text className="text-sm font-semibold">{loadingStatus ? "..." : row.value}</Text>
          </div>
        ))}
      </div>

      {result && (
        <div
          className={`rounded-md border p-3 text-sm ${
            result.success
              ? "border-ui-tag-green-border bg-ui-tag-green-bg"
              : "border-ui-tag-red-border bg-ui-tag-red-bg"
          }`}
        >
          <div className="flex items-start gap-2">
            {result.success ? (
              <CheckCircle className="mt-0.5 shrink-0 text-ui-tag-green-icon" />
            ) : (
              <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-red-icon" />
            )}
            <div>
              <Text className="font-medium">{result.success ? "Sync successful" : "Sync failed"}</Text>
              <Text className="text-ui-fg-subtle mt-0.5">{result.message || result.error}</Text>
              {(result.errors || 0) > 0 && (
                <Text className="text-ui-tag-red-icon mt-0.5">{result.errors} errors</Text>
              )}
              {result.elapsed_ms != null && (
                <Text className="text-ui-fg-subtle text-xs mt-0.5">{result.elapsed_ms}ms</Text>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
SyncCard.displayName = "SyncCard"

function formatStatusSafe(card: SyncCardConfig, status: any) {
  try {
    return card.formatStatus(status || {})
  } catch {
    return []
  }
}

export default function OdooSyncDashboardPage() {
  const [syncingAll, setSyncingAll] = useState(false)
  const [allSummary, setAllSummary] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, SyncCardHandle | null>>({})

  const handleSyncAll = async () => {
    setSyncingAll(true)
    setAllSummary(null)
    const outcomes: string[] = []
    // Run one at a time (not in parallel) so a slow/heavy sync — Products can
    // take a few minutes over the full catalog — doesn't pile database load
    // on top of the others at once.
    for (const card of CARDS) {
      const handle = cardRefs.current[card.key]
      if (!handle) continue
      const res = await handle.runSync()
      outcomes.push(`${card.title}: ${res.success ? "✓" : "✗ " + (res.error || "failed")}`)
    }
    setAllSummary(outcomes.join("  •  "))
    setSyncingAll(false)
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading level="h1" className="flex items-center gap-2">
            <ArrowPath /> Odoo Sync
          </Heading>
          <Text className="text-ui-fg-subtle mt-1">
            Manually trigger a sync for each data type. Most of these also run automatically in the background —
            use these buttons when you need the latest data from Odoo right now.
          </Text>
        </div>
        <Button variant="primary" size="base" isLoading={syncingAll} disabled={syncingAll} onClick={handleSyncAll}>
          <ArrowPathMini className="mr-2" />
          {syncingAll ? "Syncing All..." : "Sync All"}
        </Button>
      </div>

      {allSummary && (
        <Text className="text-ui-fg-subtle text-sm">{allSummary}</Text>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map((card) => (
          <SyncCard key={card.key} card={card} ref={(el) => { cardRefs.current[card.key] = el }} />
        ))}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Odoo Sync", icon: ArrowPath })
