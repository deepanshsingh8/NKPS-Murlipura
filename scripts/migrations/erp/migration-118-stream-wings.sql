-- Migration 118 — wings: a reusable class band with its own subject set.
--
-- ── What a wing is ──────────────────────────────────────────────────────────
-- The school groups classes into wings — Pre-Primary, Primary (I–V), Middle
-- (VI–VIII), Senior (IX–XII). It already thinks this way: staff_members.category
-- carries prePrimaryCoordinator / primaryCoordinator / middleCoordinator /
-- seniorCoordinator.
--
-- The ask: define "Middle Wing = classes VI–VIII, these 11 subjects" once, then
-- press a button and have those subjects allotted to every class AND section in
-- the band — instead of repeating the work nine times for VI-A/B/C, VII-A/B/C,
-- VIII-A/B/C.
--
-- ── Why on `streams` rather than a new table ────────────────────────────────
-- The admin had already built "Middle Wing" on the Streams tab, because a
-- stream is the only thing in the ERP that owns a set of subjects
-- (stream_subjects). Reusing the table keeps that profile and its subject
-- picks, and lets the existing "Manage subjects" dialog serve both.
--
-- ── The danger, and the guard ───────────────────────────────────────────────
-- A stream is NOT just a label. classes.stream_id, student_enrollments.stream_id
-- and fee_structures.stream_id all read it, and fee resolution keys off it. A
-- wing loose in that machinery would change what students are charged.
--
-- So `kind` is a hard discriminator, and wings carry their band in `class_names`
-- rather than ever being attached to classes.stream_id. Every picker and every
-- importer name-lookup filters to kind='stream'; the two places that resolve a
-- STORED stream_id back to a name are deliberately left unfiltered, so a stored
-- id always renders.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stream',
  -- Class NAMES, not class ids: classes are per-academic-year rows, and a wing
  -- has to outlive the year rollover. Values come from CLASS_ORDER in
  -- packages/shared/src/lib/constants.ts — 'Nursery','LKG','UKG','I'…'XII' —
  -- so Middle Wing is {'VI','VII','VIII'}.
  ADD COLUMN IF NOT EXISTS class_names text[] NOT NULL DEFAULT '{}';

-- Added separately so the migration is re-runnable: ADD COLUMN IF NOT EXISTS
-- skips the column on a second run, and would skip an inline CHECK with it.
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_kind_check;
ALTER TABLE streams
  ADD CONSTRAINT streams_kind_check CHECK (kind IN ('stream', 'wing'));

COMMENT ON COLUMN streams.kind IS
  'stream = an academic stream for XI/XII (Science, Commerce, Humanities), the '
  'original meaning: attachable to classes.stream_id and read by fee '
  'resolution. wing = a band of classes with a shared subject set, used only to '
  'push subjects onto classes. Wings are filtered out of every stream picker '
  'and every importer name-lookup.';
COMMENT ON COLUMN streams.class_names IS
  'For kind=wing: the class names the wing covers, e.g. {VI,VII,VIII}. Names '
  'rather than class ids so the wing survives the academic-year rollover. '
  'Always empty for kind=stream.';

-- Every existing row is an academic stream with no band, so XI/XII behaviour is
-- byte-identical the moment this lands. The defaults already do this; the
-- UPDATE is here only for a row that predates the NOT NULL default somehow.
UPDATE streams SET kind = 'stream' WHERE kind IS NULL;

-- Pickers filter on kind, and there are few streams, but the index costs
-- nothing and makes the intent legible in the catalog.
CREATE INDEX IF NOT EXISTS idx_streams_kind ON streams(kind);

COMMIT;
