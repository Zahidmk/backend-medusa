-- Odoo identity lives in JSONB metadata, and every sync path looks rows up by it:
--   product.metadata->>'odoo_id'                  (odoo-sync-job, webhooks/products, +5 call sites)
--   product_category.metadata->>'odoo_id'         (category sync, 11 call sites)
--   product_variant.metadata->>'odoo_variant_id'  (variant sync)
--
-- None of these were indexed, so each lookup was a sequential scan of the whole
-- table (~4.3ms and 735 buffers per product lookup against 6.9k rows). The
-- product sync job runs every 5 minutes and does this per product.
--
-- CONCURRENTLY so the live tables are never locked; this means the statements
-- cannot run inside a transaction block, hence no BEGIN/COMMIT here.
-- IF NOT EXISTS makes the script idempotent.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_odoo_id
  ON product ((metadata->>'odoo_id'))
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_category_odoo_id
  ON product_category ((metadata->>'odoo_id'))
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variant_odoo_variant_id
  ON product_variant ((metadata->>'odoo_variant_id'))
  WHERE deleted_at IS NULL;
