-- Migration 025: Publish workflow (two-stage).
--
-- Stage 1 — Publish Result: toggle `results.is_published` so students/parents
-- can see marks in the portal. Already a column; this migration just adds
-- the audit trail via `publish_events`.
--
-- Stage 2 — Finalize Marksheet: snapshot the fully-rendered report-card data
-- into `marksheet_publications.snapshot` (jsonb) and serve the same bytes on
-- every subsequent PDF download. Edits after finalization do NOT change the
-- snapshot; re-finalizing creates version+1 and auto-unpublishes the prior
-- active version.

CREATE TABLE IF NOT EXISTS marksheet_publications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  schema_version text NOT NULL DEFAULT 'v1',
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  unpublished_at timestamptz,
  unpublish_reason text,
  unpublished_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT marksheet_publications_version_unique
    UNIQUE (student_id, exam_type_id, version),
  CONSTRAINT marksheet_publications_version_positive
    CHECK (version > 0),
  CONSTRAINT marksheet_publications_unpublish_consistent
    CHECK (
      (unpublished_at IS NULL AND unpublish_reason IS NULL)
      OR (unpublished_at IS NOT NULL)
    )
);

-- Partial unique index: at most one active (non-unpublished) version per
-- (student, exam). Re-finalize must flip the old row's unpublished_at before
-- inserting the new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_active_one
  ON marksheet_publications(student_id, exam_type_id)
  WHERE unpublished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_marksheet_class_exam
  ON marksheet_publications(class_id, exam_type_id);
CREATE INDEX IF NOT EXISTS idx_marksheet_student
  ON marksheet_publications(student_id);

CREATE TABLE IF NOT EXISTS publish_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL CHECK (
    event_type IN (
      'publish_results',
      'unpublish_results',
      'finalize_marksheet',
      'unpublish_marksheet',
      're_finalize_marksheet'
    )
  ),
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  acted_at timestamptz DEFAULT now(),
  note text
);

CREATE INDEX IF NOT EXISTS idx_publish_events_exam
  ON publish_events(exam_type_id, acted_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_events_student
  ON publish_events(student_id, acted_at DESC);

-- ── RLS: marksheet_publications ─────────────────────────────────────────────
-- Snapshot contents are sensitive (student marks + remarks). Admin has full
-- access; PDF route uses admin (service-role) client for snapshot reads after
-- gating via canViewReportCard.

ALTER TABLE marksheet_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to marksheet_publications" ON marksheet_publications;
CREATE POLICY "Admins full access to marksheet_publications"
  ON marksheet_publications FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read marksheet_publications for their classes" ON marksheet_publications;
CREATE POLICY "Teachers can read marksheet_publications for their classes"
  ON marksheet_publications FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

-- ── RLS: publish_events ────────────────────────────────────────────────────
-- Audit log — admin read; inserts happen via admin client in the API.

ALTER TABLE publish_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read publish_events" ON publish_events;
CREATE POLICY "Admins read publish_events"
  ON publish_events FOR SELECT
  USING (public.get_user_role() = 'admin');
