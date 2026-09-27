-- migration-090-houses.sql
--
-- House master + per-session house assignment, for the Custom Report Builder's
-- "House Name" column and for house-wise sheets (sports day, assembly,
-- inter-house results).
--
-- ── Why house_id sits on student_enrollments, not students ──────────────────
-- Students change house between sessions — on class promotion into a new wing,
-- or to rebalance house strengths. A column on `students` holds only today's
-- house, so a report run for 2023-24 would print the CURRENT house against a
-- three-year-old cohort: wrong, and wrong in the silent way (a plausible value
-- in every cell). Enrollment is already the per-session row carrying class,
-- section, roll number, status and transport; house belongs beside them.
--
-- ── Why a master table, not a text column ───────────────────────────────────
-- The old ERP used free text and the live data shows exactly what that costs:
-- its house list contains YELLOW, "Yellow House", BLUE, "Blue House", "Ble",
-- GREEN, "Green House", RED, "Red House" — nine rows for four houses, so no
-- house-wise total was ever trustworthy. A FK makes the typo impossible.
--
-- Idempotent.

-- ─── 1. The master ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS houses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Short form for narrow report columns and roll-number prefixes ("R", "BLU").
  code       text,
  -- Hex, for house badges in the UI and colour bands on printed sheets.
  colour     text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: the whole point is to stop "RED" and "Red
-- House" coexisting. A plain UNIQUE(name) would not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_houses_name_unique
  ON houses (lower(btrim(name)));

ALTER TABLE houses DROP CONSTRAINT IF EXISTS chk_houses_colour;
ALTER TABLE houses ADD CONSTRAINT chk_houses_colour CHECK (
  colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$'
);

-- ─── 2. Assignment ──────────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: deleting a house must never delete a
-- student's enrollment row. Deactivating (is_active = false) is the intended
-- path anyway; deletion is the accident this guards.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS house_id uuid REFERENCES houses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_house
  ON student_enrollments (house_id) WHERE house_id IS NOT NULL;

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
-- Mirrors `streams`: readable by everyone (house names are printed on public
-- result sheets and the website's sports pages), writable by admins only.

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read houses" ON houses;
CREATE POLICY "Public can read houses"
  ON houses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert houses" ON houses;
CREATE POLICY "Admins can insert houses"
  ON houses FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can update houses" ON houses;
CREATE POLICY "Admins can update houses"
  ON houses FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can delete houses" ON houses;
CREATE POLICY "Admins can delete houses"
  ON houses FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ─── 4. Seed the four canonical houses ──────────────────────────────────────
-- Guarded per row on the case-insensitive name index, so re-running this
-- migration against a populated database cannot resurrect a house the school
-- has since renamed (the failure mode migration 059's section_cards seed hit).

INSERT INTO houses (name, code, colour, sort_order)
VALUES
  ('Red House',    'RED', '#DC2626', 1),
  ('Blue House',   'BLU', '#2563EB', 2),
  ('Green House',  'GRN', '#16A34A', 3),
  ('Yellow House', 'YEL', '#CA8A04', 4)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE houses IS
  'House master. Assignment lives on student_enrollments.house_id because a '
  'student''s house is per-session, not lifelong.';
