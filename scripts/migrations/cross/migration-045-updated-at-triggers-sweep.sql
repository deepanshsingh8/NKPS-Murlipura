-- Migration 045 — Sweep `updated_at` triggers across the laggard tables
-- (audit M14 + L8).
--
-- The migration-031 DO block enumerates ~15 tables but missed the ones below.
-- Running an UPDATE on these tables left `updated_at` frozen, which silently
-- broke "most-recent-first" ORDER BY queries and "modified-since" admin views.
--
-- Idempotent: drops each trigger before recreating, and gates on column
-- existence so it survives partial deployments.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'gallery_images',
    'transfer_certificates',
    'disclosure_items',
    'disclosure_documents',
    'disclosure_board_results',
    'site_media',
    'result_master_subjects',
    'class_test_results',
    'non_scholastic_assessments',
    'non_scholastic_sub_subject_classes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'set_updated_at_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'set_updated_at_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;
