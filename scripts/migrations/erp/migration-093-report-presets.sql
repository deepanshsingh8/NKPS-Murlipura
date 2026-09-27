-- migration-093-report-presets.sql
--
-- Saved column/filter selections for the Custom Report Builder.
--
-- Numbered 093, not 091: 091 was claimed by migration-091-export-events on
-- main while this branch was in flight. 093 has never been used anywhere in
-- this repo's history and is the number main's own plan file expects, so it
-- leaves no permanent gap.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
-- The old ERP's report screen saved nothing: /CustomReport 404s, only
-- /CustomReport/Create exists. Every time the office wanted the same contact
-- sheet they re-ticked the same boxes out of 111. That is the single biggest
-- daily cost of the old screen, and it is a table.
--
-- ── Ownership model ─────────────────────────────────────────────────────────
-- Private by default. `is_shared` publishes a preset to everyone who can open
-- the reports screen, and only admins may set it — otherwise any editor could
-- push a preset into every colleague's list.
--
-- created_by IS NULL marks a SYSTEM preset (the two seeded below). They are
-- shared, they belong to nobody, and only an admin can touch them.
--
-- ── Why the session id is stored but overridden at run time ─────────────────
-- `filters` is stored whole, session id included, because a partial filter
-- blob would need bespoke merge logic on load. The UI substitutes the session
-- picker's current value when it applies a preset, so "Class-wise contact
-- sheet" works in any year rather than silently reporting on 2026-27 forever.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS report_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Room for the planned fee / attendance / result reports without a second
  -- table; each one gets its own field registry but the same preset shape.
  entity     text NOT NULL DEFAULT 'students',
  -- The whole ReportFilters object (packages/shared/src/lib/report-filters.ts).
  filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered ReportField keys. Unknown keys are dropped on load rather than
  -- erroring, so retiring a field does not break every saved preset.
  fields     text[] NOT NULL DEFAULT '{}',
  is_shared  boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_presets_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT report_presets_entity_known CHECK (entity IN ('students'))
);

-- ON DELETE CASCADE above, not SET NULL: a deleted user's private presets
-- should go with them. SET NULL would silently promote them to system presets,
-- which is the opposite of what anyone intends.

-- One name per owner. Partial, because NULL owners (system presets) need
-- their own global uniqueness — and in Postgres NULL <> NULL, so a single
-- composite unique index would let duplicate system presets through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_owner_name
  ON report_presets (created_by, lower(btrim(name)))
  WHERE created_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_system_name
  ON report_presets (lower(btrim(name)))
  WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_report_presets_visible
  ON report_presets (entity, is_shared, created_by);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Defence in depth: the API also checks ownership explicitly, but a preset is
-- per-user data and the table should be safe on its own.

ALTER TABLE report_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or shared report_presets" ON report_presets;
CREATE POLICY "Read own or shared report_presets"
  ON report_presets FOR SELECT
  USING (created_by = auth.uid() OR is_shared OR public.get_user_role() = 'admin');

-- A caller may only create presets owned by themselves, and may not publish
-- one unless they are an admin.
DROP POLICY IF EXISTS "Insert own report_presets" ON report_presets;
CREATE POLICY "Insert own report_presets"
  ON report_presets FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Update own report_presets" ON report_presets;
CREATE POLICY "Update own report_presets"
  ON report_presets FOR UPDATE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin')
  WITH CHECK (
    (created_by = auth.uid() OR public.get_user_role() = 'admin')
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Delete own report_presets" ON report_presets;
CREATE POLICY "Delete own report_presets"
  ON report_presets FOR DELETE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin');

-- ─── Seed: two system presets ───────────────────────────────────────────────
-- So the screen is not empty on day one, and so the two reports the office
-- actually runs are one click.
--
-- Field keys must exist in packages/shared/src/lib/report-fields.ts. Unknown
-- keys are dropped silently on load, so a typo here degrades to a missing
-- column rather than an error — scripts/_verify-report-fields.mts is what
-- catches that.
--
-- `serial` and `student_name` are omitted deliberately: they are always-on and
-- get prepended by resolveFields().

INSERT INTO report_presets (name, entity, filters, fields, is_shared, created_by)
VALUES
  (
    'Contact Sheet',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_section', 'roll_number',
      'father_name', 'father_mobile', 'mother_mobile', 'phone'
    ],
    true,
    NULL
  ),
  (
    'UDISE+ Extract',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_name', 'section', 'gender', 'date_of_birth',
      'father_name', 'mother_name', 'category', 'minority_group',
      'is_bpl', 'is_ews', 'is_cwsn', 'is_rte', 'medium_of_instruction',
      'pen_number', 'apaar_number', 'aadhar_number', 'distance_band',
      'parent_highest_education'
    ],
    true,
    NULL
  )
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN report_presets.created_by IS
  'NULL means a system preset: shared, owned by nobody, admin-only to modify.';
