-- Migration 903 (Murlipura-local) — Class Diary.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The school runs one WhatsApp group per class for daily homework, holiday
-- homework, fee reminders, function photos and the day's notices. This moves
-- that traffic into the ERP, where it is tied to the class roster the school
-- already maintains: a post reaches exactly the families whose child is
-- enrolled in the class, a parent who leaves the school stops seeing it, and
-- the phone numbers of 40 families are no longer visible to each other.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- Murlipura-local migrations live in a reserved 9xx band (901 prospectus /
-- holiday-homework storage, 902 temp credentials, 903 this). Upstream NKPS
-- numbers globally and is at 126; the band keeps the two sequences from
-- colliding on every sync.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
-- One row per (post, class). Posting the same homework to three sections
-- writes three rows sharing the same attachments, so each class's feed,
-- "seen by" count and delete are independent. class_id NULL means the whole
-- school (admin/editor only) — a fee-date reminder or a holiday notice.
--
-- Attachments are storage object paths in the PRIVATE "class-diary" bucket,
-- stored as a jsonb array of {path, name, type, size}. Nothing is public: the
-- API hands out short-lived signed URLs after it has checked the caller can
-- see the post, because photos of children do not belong in a public bucket.
--
-- ── Access ──────────────────────────────────────────────────────────────────
-- Every read and write goes through /api/class-diary with the service-role
-- client, which scopes rows in TypeScript (apps/erp/src/lib/class-diary.ts):
--   admin / editor with the class_diary feature → every class, school-wide
--   teacher → classes in get_my_class_ids() (class teacher OR subject teacher,
--             the same scope attendance and marks use)
--   parent  → classes their children are enrolled in this session
--   student → their own class this session
-- The SELECT policies below mirror that scope so a browser-client read can
-- never see more than the API would return. There are no write policies:
-- writes are API-only.
--
-- Idempotent. SAFE TO RE-RUN.

BEGIN;

SET LOCAL search_path = public;

CREATE TABLE IF NOT EXISTS class_diary_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = whole school.
  class_id         uuid REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  subject_id       uuid REFERENCES subjects(id) ON DELETE SET NULL,
  kind             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  -- The school day the post is for, in IST — not created_at, which is UTC and
  -- lands on the previous day for anything posted before 05:30.
  post_date        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  due_date         date,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_pinned        boolean NOT NULL DEFAULT false,
  -- Rows sharing a batch_id were posted together to several classes.
  batch_id         uuid,
  -- SET NULL, not CASCADE: a teacher's posts outlive their login.
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Denormalised so the feed still names the author after the profile goes.
  author_name      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT class_diary_kind_known CHECK (
    kind IN ('homework', 'holiday_homework', 'notice', 'fee_reminder', 'photos')
  ),
  CONSTRAINT class_diary_title_len CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT class_diary_body_len CHECK (length(body) <= 5000),
  CONSTRAINT class_diary_attachments_array CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT class_diary_due_after_post CHECK (due_date IS NULL OR due_date >= post_date)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_class_date
  ON class_diary_posts (class_id, post_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_diary_school_wide
  ON class_diary_posts (post_date DESC, created_at DESC) WHERE class_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_diary_created_by
  ON class_diary_posts (created_by);
CREATE INDEX IF NOT EXISTS idx_class_diary_subject
  ON class_diary_posts (subject_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_year
  ON class_diary_posts (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_batch
  ON class_diary_posts (batch_id) WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_class_diary_posts ON class_diary_posts;
CREATE TRIGGER set_updated_at_class_diary_posts
  BEFORE UPDATE ON class_diary_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read receipts — the ERP's version of WhatsApp's blue ticks. One row per
-- (post, reader); the teacher sees a count, never a list of who has not read.
CREATE TABLE IF NOT EXISTS class_diary_reads (
  post_id    uuid NOT NULL REFERENCES class_diary_posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_reads_profile
  ON class_diary_reads (profile_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE class_diary_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_diary_reads ENABLE ROW LEVEL SECURITY;

-- (select …) wrappers so each helper is evaluated once per statement rather
-- than once per row (migration 102).
DROP POLICY IF EXISTS "Admins and diary editors read class diary" ON class_diary_posts;
CREATE POLICY "Admins and diary editors read class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'admin'
    OR (select public.has_editor_feature('class_diary'))
  );

DROP POLICY IF EXISTS "Teachers read their classes' diary" ON class_diary_posts;
CREATE POLICY "Teachers read their classes' diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'teacher'
    AND (
      class_id IS NULL
      OR class_id IN (SELECT public.get_my_class_ids())
      OR created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Students read their class diary" ON class_diary_posts;
CREATE POLICY "Students read their class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'student'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id = (select public.get_my_student_id())
      )
    )
  );

DROP POLICY IF EXISTS "Parents read their children's class diary" ON class_diary_posts;
CREATE POLICY "Parents read their children's class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'parent'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id IN (SELECT public.get_my_children_ids())
      )
    )
  );

DROP POLICY IF EXISTS "Users read their own diary receipts" ON class_diary_reads;
CREATE POLICY "Users read their own diary receipts"
  ON class_diary_reads FOR SELECT
  USING (profile_id = (select auth.uid()));

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Private. No storage.objects policies on purpose: uploads use signed upload
-- URLs minted by /api/class-diary/upload-url after the scope check, and
-- downloads use signed URLs minted by the feed route.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-diary', 'class-diary', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
