-- Migration 124 — let a staff member granted Fees actually read fee_payments.
--
-- ── The bug ─────────────────────────────────────────────────────────────────
-- A staff account holding the 'fees' editor grant opens Fees → Payment
-- Management, finds the student, and sees "No payments recorded yet" with
-- PAID ₹0 — while an admin looking at the same student sees ₹17,500 across two
-- receipts.
--
-- The grant is not the problem. It is doing its job: it passes the middleware
-- page gate, puts Fees in the sidebar, and satisfies verifyAdminOrEditor on
-- the write routes. The block is one layer lower. The fee screens read
-- fee_payments straight from the browser with the user's own JWT, so Postgres
-- applies RLS, and the only SELECT paths on that table are:
--
--     fee_payments_all_admin      role = 'admin'
--     fee_payments_select_student the student themselves
--     fee_payments_select_parent  their parents
--
-- role='staff' matches none of them. RLS filters rows rather than raising, so
-- the read returns zero rows with no error and the UI renders its empty state.
--
-- This is the same fault migration 084 fixed for students and
-- student_enrollments — its own header even lists fees among the affected
-- pages — but it only patched those two roster tables. The money table was
-- left behind.
--
-- Two consequences worse than the empty payment history:
--
--   * Dues & No-Dues prices every student with paid = 0, so the register shows
--     the WHOLE SCHOOL owing full fees and an empty No-Dues tab. Those are
--     numbers an operator acts on.
--   * Writes go through /api/fees/payments on the service-role client, which
--     bypasses RLS. So a staff member CAN record a payment and then cannot see
--     it — which invites recording it a second time.
--
-- ── The fix, and why it is feature-gated rather than role-coarse ────────────
-- 084 and 047 settled on role-coarse RLS ("RLS stays role-coarse so policy
-- bodies stay fast"), leaving per-feature gating to the application. That
-- reasoning was sound when a policy body was re-evaluated once per row — but
-- migration 102 established the fix for exactly that: wrapping the call as
-- (SELECT fn()) makes it an uncorrelated InitPlan, evaluated once per query
-- however many rows are scanned. With the wrapping below, a feature-aware
-- check costs the same as a role-coarse one, so the reason to stay coarse is
-- gone and there is no reason to hand every staff account in the school read
-- access to every family's payment history.
--
-- has_editor_capability() is deliberately general: it is the hook this
-- database has never had for editor_permissions, and the remaining tables with
-- this same gap (attendance, results, non_scholastic_assessments,
-- marksheet_publications — all still staff-blind) each become a six-line
-- follow-up once it exists.
--
-- ── Why this is additive ────────────────────────────────────────────────────
-- supabase-schema.sql is not a faithful mirror of the live policy set:
-- migration-erp-redesign renamed these policies and the rename was never
-- mirrored back (see migration 102's header). So this file DROPs and CREATEs
-- only its OWN new policy name and touches nothing that already exists.
-- Permissive policies are OR-ed, so adding one widens access by exactly the
-- predicate below and changes no existing rule.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ─── 1. The capability helper ───────────────────────────────────────────────
-- True when the caller is an admin (who holds everything), or holds
-- p_feature in editor_permissions.
--
-- SECURITY DEFINER so the lookup is not itself subject to the RLS on profiles
-- and editor_permissions — the same pattern as get_user_role(). STABLE so the
-- planner may hoist it. It discloses nothing: it only ever answers a question
-- about the calling user, and only yes or no.

CREATE OR REPLACE FUNCTION public.has_editor_capability(p_feature text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (
         p.role = 'admin'
         OR EXISTS (
           SELECT 1
             FROM public.editor_permissions ep
            WHERE ep.editor_id = p.id
              AND ep.feature_key = p_feature
         )
       )
  );
$$;

COMMENT ON FUNCTION public.has_editor_capability(text) IS
  'True when the calling user holds this feature key: admins always, everyone '
  'else via editor_permissions. The RLS-side counterpart of '
  'verifyAdminOrEditor() in packages/shared/src/lib/verify-admin.ts. Call it '
  'wrapped as (SELECT has_editor_capability(''key'')) so it is evaluated once '
  'per query as an InitPlan rather than once per row — see migration 102.';

-- Explicit for logged-in users; it is the caller's own capability it reports.
--
-- PUBLIC's default EXECUTE is deliberately LEFT IN PLACE. Revoking it would
-- not harden anything — with no session the function returns false, which is
-- already the answer — but it WOULD turn an anonymous read of any table
-- carrying this policy from "zero rows" into a hard permission error, because
-- Postgres evaluates every permissive policy for whoever is querying. An empty
-- result is the correct and safer outcome there.
GRANT EXECUTE ON FUNCTION public.has_editor_capability(text) TO authenticated;

-- ─── 2. The policy ──────────────────────────────────────────────────────────
-- SELECT only. Every write already goes through a server route on the
-- service-role client (/api/fees/payments, /api/admin, the refund and
-- change-request routes), each of which runs verifyAdminOrEditor('fees')
-- first. Granting INSERT/UPDATE here would add a second, weaker way in that
-- bypasses the change-request workflow editors are deliberately held to.

DROP POLICY IF EXISTS "fee_payments_select_fee_editor" ON public.fee_payments;
CREATE POLICY "fee_payments_select_fee_editor"
  ON public.fee_payments FOR SELECT
  USING ((SELECT public.has_editor_capability('fees')));

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- As the staff user, after granting them Fees on /people/users:
--
--   SELECT count(*), sum(amount_paid) FROM fee_payments WHERE student_id = '…';
--
-- should now match what an admin sees. And confirm the check is hoisted:
--
--   EXPLAIN (ANALYZE) SELECT id FROM fee_payments;
--   -- has_editor_capability should appear as InitPlan 1, not per row.
