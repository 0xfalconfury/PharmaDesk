-- ============================================================
-- One-time migration for existing installations.
-- Safe to run any number of times.
-- ============================================================

-- 1. Repair any rows where quantity_remaining > quantity_received
UPDATE medicine_batches
SET quantity_received = quantity_remaining
WHERE quantity_remaining > quantity_received;

-- 2. Drop any check constraint that still enforces
--    "quantity_remaining <= quantity_received"
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'medicine_batches'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%quantity_remaining <= quantity_received%'
  LOOP
    EXECUTE format('ALTER TABLE medicine_batches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 3. Ensure the new composite check exists exactly once
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'medicine_batches'::regclass
      AND conname = 'medicine_batches_quantities_check'
  ) THEN
    ALTER TABLE medicine_batches
      ADD CONSTRAINT medicine_batches_quantities_check
      CHECK (quantity_received > 0 AND quantity_remaining >= 0);
  END IF;
END $$;