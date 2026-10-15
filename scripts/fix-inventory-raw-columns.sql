-- Medusa v2 reads inventory_level.raw_*_quantity (BigNumber JSON), not the plain columns.
-- Our Odoo sync / webhooks / admin routes write only the plain columns via raw SQL, leaving raw_* NULL,
-- so Medusa sees 0 stock and add-to-cart fails with "insufficient_inventory".
-- This backfills existing rows and adds a trigger so every write path keeps raw_* in sync.
-- Idempotent: safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION sync_inventory_level_raw() RETURNS trigger AS $$
BEGIN
  NEW.raw_stocked_quantity  := jsonb_build_object('value', COALESCE(NEW.stocked_quantity, 0)::text,  'precision', 20);
  NEW.raw_reserved_quantity := jsonb_build_object('value', COALESCE(NEW.reserved_quantity, 0)::text, 'precision', 20);
  NEW.raw_incoming_quantity := jsonb_build_object('value', COALESCE(NEW.incoming_quantity, 0)::text, 'precision', 20);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_inventory_level_raw ON inventory_level;
CREATE TRIGGER trg_sync_inventory_level_raw
  BEFORE INSERT OR UPDATE OF stocked_quantity, reserved_quantity, incoming_quantity ON inventory_level
  FOR EACH ROW EXECUTE FUNCTION sync_inventory_level_raw();

-- Backfill existing rows (the trigger fires on this no-op update).
UPDATE inventory_level
SET stocked_quantity = stocked_quantity
WHERE deleted_at IS NULL;

COMMIT;
