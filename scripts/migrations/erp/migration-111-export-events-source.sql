-- migration-111-export-events-source.sql
--
-- Record whether an export was taken by a person or produced by the
-- assistant, without disturbing what `dataset` has always meant.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- This feature owns a reserved block: 110 school_profile, 111 export_events
-- source, 112 ai_audit, and 113 is held for the WhatsApp tables.
--
-- The block exists because sequential numbering failed here. 098 landed on
-- main as cms/migration-098-restrict-staff-pii.sql, then 099, 100 and 101 were
-- each claimed by a parallel branch mid-session — twice onto a number this
-- work had already taken. Renumbering into a gap terminates that race; the
-- gap itself is harmless, since apply order is by number and nothing reads the
-- sequence as contiguous.
--
-- Still re-run the check before adding a file:
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why a new column and not a new dataset value ────────────────────────────
-- The obvious move is to widen the `dataset` CHECK with an 'ai_query' value.
-- That would be wrong. `dataset` answers "which corpus left the school" —
-- students, staff, fees_dues, and so on — and every existing count, index and
-- future dashboard reads it that way. An AI-produced student sheet is still
-- the student corpus; only the route differs. Adding 'ai_query' would silently
-- reclassify those rows out of 'students' and make "how many student exports
-- happened this term" quietly wrong from the day the feature ships.
--
-- So `dataset` keeps its meaning and `source` carries the new axis. The
-- default is 'manual', which is exactly what every existing row is, so the
-- backfill is the default and no UPDATE is needed.
--
-- ── ai_run_id ───────────────────────────────────────────────────────────────
-- Points at the ai_query_runs row (added in migration 112) that produced
-- the sheet, so an auditor can go from "this CSV left the school" to the
-- question that was asked and the filters that actually ran. Nullable and
-- unconstrained for now: the FK is added alongside ai_query_runs so this
-- migration stays independently applicable.

ALTER TABLE export_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE export_events
  ADD COLUMN IF NOT EXISTS ai_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_events_source_known'
  ) THEN
    ALTER TABLE export_events
      ADD CONSTRAINT export_events_source_known
      CHECK (source IN ('manual', 'ai'));
  END IF;
END $$;

-- Auditors ask "what did the assistant hand out?" far more often than they
-- ask about any single actor, so this is the index that earns its keep.
CREATE INDEX IF NOT EXISTS idx_export_events_ai
  ON export_events (created_at DESC)
  WHERE source = 'ai';

COMMENT ON COLUMN export_events.source IS
  'How the export was produced: manual (a person used an export screen) or ai '
  '(the assistant produced the sheet). Distinct from dataset, which names the '
  'corpus and keeps its original meaning.';

COMMENT ON COLUMN export_events.ai_run_id IS
  'ai_query_runs.id that produced this export, when source = ''ai''. Lets an '
  'auditor trace a downloaded sheet back to the question and the scoped '
  'filters that produced it.';
