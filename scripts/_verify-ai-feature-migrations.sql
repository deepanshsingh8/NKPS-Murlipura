-- _verify-ai-feature-migrations.sql
--
-- Run AFTER _apply-ai-feature-migrations.sql. Every row should say PASS.
--
-- Checks the things that actually break silently rather than loudly: a missing
-- RLS flag, a policy that was never created, an absent foreign key. A table
-- existing proves very little on its own.
--
-- The column is check_name, not check. CHECK is a fully reserved keyword;
-- Postgres tolerates it as a column LABEL after an explicit AS, so the first
-- SELECT parsed fine and the final one — which has to reference it bare —
-- failed with "syntax error at or near check". Do not rename it back.

WITH checks AS (

  -- ── 110 school_profile ────────────────────────────────────────────────────
  SELECT '110 school_profile table' AS check_name,
         (to_regclass('public.school_profile') IS NOT NULL) AS ok,
         'table exists' AS expected
  UNION ALL
  SELECT '110 school_profile seeded (exactly 1 row)',
         (SELECT count(*) = 1 FROM school_profile),
         'one row, seeded from constants.ts'
  UNION ALL
  SELECT '110 singleton guard rejects a 2nd row',
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'school_profile'
                   AND indexname = 'school_profile_one_row'),
         'unique index school_profile_one_row'
  UNION ALL
  SELECT '110 school_profile RLS enabled',
         (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.school_profile'::regclass),
         'RLS on'
  UNION ALL
  SELECT '110 school_profile has 2 policies (public read, admin write)',
         (SELECT count(*) = 2 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'school_profile'),
         'exactly 2 policies'
  UNION ALL
  -- Asserts the DEFAULT, not the current value. The old check read
  -- `ai_enabled = false` and so failed the moment somebody ran
  -- _enable-ai-assistant.sql — i.e. it failed because the operator did the
  -- right thing. A verify script that goes red on correct state teaches
  -- people to ignore it, which costs more than the check was ever worth.
  SELECT '110 ai_enabled defaults OFF',
         (SELECT column_default IN ('false', 'false::boolean')
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'school_profile'
             AND column_name = 'ai_enabled'),
         'column defaults to false — switching it on is a deliberate act'

  -- ── 111 export_events ─────────────────────────────────────────────────────
  UNION ALL
  SELECT '111 export_events.source column',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'export_events' AND column_name = 'source'),
         'column exists'
  UNION ALL
  -- Same trap as the ai_enabled check above. This used to require EVERY row
  -- to read 'manual', so the first successful AI export turned it red — the
  -- check failed precisely because the feature it was verifying worked. What
  -- 111 actually guarantees is that the column is NOT NULL with a 'manual'
  -- default, so no pre-existing row was left without an answer.
  SELECT '111 export_events.source defaults to manual',
         (SELECT count(*) = 0 FROM export_events WHERE source IS NULL)
         AND (SELECT column_default LIKE '%manual%'
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'export_events'
                 AND column_name = 'source'),
         'no row without a source; new rows default to manual'
  UNION ALL
  SELECT '111 export_events.ai_run_id column',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'export_events' AND column_name = 'ai_run_id'),
         'column exists'
  UNION ALL
  SELECT '111 dataset CHECK was NOT widened',
         NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.export_events'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%ai_query%'),
         'dataset still names corpora only; source carries the new axis'

  -- ── 112 audit tables ──────────────────────────────────────────────────────
  UNION ALL
  SELECT '112 all four audit tables exist',
         (to_regclass('public.ai_conversations') IS NOT NULL
          AND to_regclass('public.ai_messages') IS NOT NULL
          AND to_regclass('public.ai_tool_calls') IS NOT NULL
          AND to_regclass('public.ai_query_runs') IS NOT NULL),
         'ai_conversations, ai_messages, ai_tool_calls, ai_query_runs'
  UNION ALL
  SELECT '112 all four have RLS ENABLED',
         (SELECT bool_and(relrowsecurity) FROM pg_class
          WHERE oid IN ('public.ai_conversations'::regclass,
                        'public.ai_messages'::regclass,
                        'public.ai_tool_calls'::regclass,
                        'public.ai_query_runs'::regclass)),
         'RLS on all four'
  UNION ALL
  -- This one is counter-intuitive on purpose. Zero policies IS the design:
  -- service-role only. If a policy ever appears here, someone widened access
  -- to other people's questions without deciding to.
  SELECT '112 all four have ZERO policies (intentional)',
         (SELECT count(*) = 0 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename IN ('ai_conversations','ai_messages','ai_tool_calls','ai_query_runs')),
         '0 policies — service-role access only'
  UNION ALL
  SELECT '112 export_events.ai_run_id FK closed the loop',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'export_events_ai_run_id_fkey'),
         'FK export_events.ai_run_id -> ai_query_runs.id'
  UNION ALL
  SELECT '112 tables carry their intentional-no-policy comment',
         (SELECT count(*) = 4 FROM pg_class c
          WHERE c.oid IN ('public.ai_conversations'::regclass,
                          'public.ai_messages'::regclass,
                          'public.ai_tool_calls'::regclass,
                          'public.ai_query_runs'::regclass)
            AND obj_description(c.oid, 'pg_class') ILIKE '%intentional%'),
         'comment says the missing policies are deliberate'

  -- ── 114 ─────────────────────────────────────────────────────────────────
  UNION ALL
  SELECT '114 ai_conversations is listable and soft-deletable',
         (SELECT count(*) = 4 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_conversations'
            AND column_name IN ('title','title_source','deleted_at','deleted_by')),
         'title, title_source, deleted_at, deleted_by'
  UNION ALL
  SELECT '114 the chat sidebar has an index that matches its query',
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'ai_conversations'
                   AND indexname = 'idx_ai_conversations_actor_recent'),
         'idx_ai_conversations_actor_recent (actor_id, feature, last_at DESC)'
  UNION ALL
  SELECT '114 ai_messages can carry a per-turn failure and a redaction',
         (SELECT count(*) = 2 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_messages'
            AND column_name IN ('error_code','redacted_at')),
         'error_code, redacted_at'
  UNION ALL
  SELECT '114 a query run knows which answer owns it, and what to call it',
         (SELECT count(*) = 2 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_query_runs'
            AND column_name IN ('message_seq','purpose')),
         'message_seq, purpose'
  UNION ALL
  SELECT '114 a result outlives the school day',
         (SELECT column_default LIKE '%24:00:00%'
                 OR column_default LIKE '%24 hours%'
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'ai_query_runs' AND column_name = 'expires_at'),
         'ai_query_runs.expires_at defaults to now() + 24 hours'
  UNION ALL
  SELECT '114 no user message still carries the injected session prefix',
         NOT EXISTS (SELECT 1 FROM ai_messages
                     WHERE role = 'user' AND content LIKE 'Current session: %'),
         'the backfill stripped the server-written prefix'
  UNION ALL
  SELECT '114 the feature check has room for the in-app guide',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'ai_conversations_feature_check'
                   AND pg_get_constraintdef(oid) LIKE '%guide%'),
         'feature IN (ask, remarks, parent, guide)'
  UNION ALL
  SELECT '114 ai_messages says out loud that it now holds student data',
         (SELECT obj_description('public.ai_messages'::regclass, 'pg_class')
                 ILIKE '%CHANGED IN 114%'),
         'the comment records that replies are stored, and what that costs'
)
SELECT
  CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result,
  check_name,
  expected
FROM checks
ORDER BY ok, check_name;
