-- schema-mirror-audit.sql
--
-- Run this in the Supabase SQL editor and paste the output back.
--
-- WHY THIS EXISTS
-- supabase-schema.sql is treated as the canonical mirror of the database, and
-- the project rule is that every migration is appended to it in the same turn.
-- That rule has been broken often enough that the mirror can no longer be
-- trusted for anything addressed BY NAME:
--
--   * migration-erp-redesign.sql drops the original policy names ("Users can
--     read own profile", "Admins can read all students", ...) and replaces them
--     with a different scheme (profiles_select_own, students_select_admin, ...).
--     The mirror contains ZERO of the new names and still lists all the old
--     ones. The redesign demonstrably ran - the teachers / parents /
--     payment_orders / notifications tables it creates are live.
--   * ~50 policies across profiles, students, student_enrollments, results,
--     attendance, fee_payments and parents are defined in migrations but absent
--     from the mirror.
--   * student_enrollments.pickup_address is used in production code
--     (admin-tables.ts, api/transport/assignments) but appears nowhere in the
--     mirror. A database built from the mirror alone would 400 on that page.
--
-- The practical consequence, already hit once: a migration written as
-- DROP POLICY "<name from the mirror>" + CREATE POLICY would drop NOTHING and
-- create a SECOND policy alongside the live one. Permissive policies are OR-ed,
-- so that silently WIDENS ACCESS. migration-102 had to be rewritten as an
-- ALTER POLICY transform over pg_policies to be safe.
--
-- Until this is reconciled, treat any migration that names a policy or an index
-- as unsafe.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Live policy inventory ────────────────────────────────────────────────
-- Compare against the CREATE POLICY statements in supabase-schema.sql.
-- Anything here that is not in the mirror is drift; anything in the mirror that
-- is not here is a ghost.
SELECT tablename,
       policyname,
       cmd,
       roles::text,
       qual,
       with_check
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname;

-- ── 2. Did migration-102 actually hoist every scalar helper call? ───────────
-- Should return ZERO rows for the 15 tables 102 covered. Any row here is a
-- policy still paying per-row evaluation.
SELECT tablename, policyname,
       CASE WHEN qual       ~ '(^|[^T] )(get_user_role|get_my_student_id|get_my_teacher_id|get_my_parent_id|uid)\(\)'
            THEN 'qual' ELSE 'with_check' END AS where_found
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (
        qual       ~ '(^|[^T] )(get_user_role|get_my_student_id|get_my_teacher_id|get_my_parent_id)\(\)'
     OR with_check ~ '(^|[^T] )(get_user_role|get_my_student_id|get_my_teacher_id|get_my_parent_id)\(\)'
   )
 ORDER BY tablename, policyname;

-- ── 3. Tables with RLS enabled but NO policy (deny-all by accident) ─────────
SELECT c.relname AS table_with_rls_but_no_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname='public' AND p.tablename = c.relname)
 ORDER BY 1;

-- ── 4. Tables with NO row-level security at all ────────────────────────────
-- Anything reachable with the anon key belongs here only deliberately.
SELECT c.relname AS table_without_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
 ORDER BY 1;

-- ── 5. Genuinely redundant indexes ─────────────────────────────────────────
-- The 34 candidates were NOT dropped in migration-103 because deciding that
-- from a stale mirror is how you lose a read path. This lists indexes whose
-- column list is a leading prefix of another index on the same table, which is
-- the only safe basis for dropping one. Partial and unique indexes excluded.
SELECT c.relname   AS table_name,
       i1.relname  AS redundant_index,
       i2.relname  AS covered_by
  FROM pg_index x1
  JOIN pg_class i1     ON i1.oid = x1.indexrelid
  JOIN pg_class c      ON c.oid  = x1.indrelid
  JOIN pg_namespace n  ON n.oid  = c.relnamespace
  JOIN pg_index x2     ON x2.indrelid = x1.indrelid
                      AND x2.indexrelid <> x1.indexrelid
  JOIN pg_class i2     ON i2.oid = x2.indexrelid
 WHERE n.nspname = 'public'
   AND NOT x1.indisprimary AND NOT x1.indisunique
   AND x1.indpred IS NULL  AND x2.indpred IS NULL
   AND array_to_string(x2.indkey,' ') LIKE array_to_string(x1.indkey,' ') || '%'
 ORDER BY 1, 2;

-- ── 6. Foreign keys with no supporting index ───────────────────────────────
-- Should be empty after migration-103. Each row is a parent DELETE that
-- sequentially scans the child table.
SELECT c.conrelid::regclass AS child_table,
       a.attname            AS unindexed_fk_column,
       c.confrelid::regclass AS parent_table
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
 WHERE c.contype = 'f'
   AND c.connamespace = 'public'::regnamespace
   AND NOT EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND i.indkey[0] = k.attnum
   )
 ORDER BY 1, 2;

-- ── 7. Columns in the database that the mirror may not know about ──────────
-- Spot-check: pickup_address should appear here and is absent from the mirror.
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('student_enrollments','students','fee_payments')
 ORDER BY table_name, ordinal_position;
