# Editor as a capability — implementation tracker

Plan source: `~/.claude/plans/happy-exploring-sketch.md` (approved 2026-04-29)

Drop `'editor'` from the role enum. Add `'staff'`. Editor capability becomes feature-selectable on top of `staff` or `teacher`. Admin always wins.

## Tasks

### Database
- [x] Write `scripts/migration-047-editor-capability.sql` (slot 047 — 044/045/046 are taken)
  - [x] Backfill `UPDATE profiles SET role='staff' WHERE role='editor'`
  - [x] Drop + recreate `profiles_role_check` constraint with new values
  - [x] Add `public.has_editor_feature(text)` SQL helper
  - [x] Update RLS: `profiles` "Admins can read all profiles" — replace 'editor' with 'staff'
  - [x] Update RLS: `student_remarks` "Teachers read all remarks" — replace 'editor' with 'staff' (only 1 such policy in current schema; the other 3 student_remarks policies already excluded 'editor')
- [x] Mirror all of the above into `supabase-schema.sql`

### Shared package
- [x] `packages/shared/src/lib/verify-admin.ts`
  - [x] `verifyAdminOrEditor(featureKey?)` — admin passes; otherwise require row
  - [x] `verifyAdminOrEditorWithUser(featureKey?)` — same shape change
  - [x] `getCallerAccess()` — drop role==='editor' branch, return permissions for any non-admin
- [x] `packages/shared/src/lib/access.ts` — `callerHasAdminOrEditorPerm` mirror change
- [x] `packages/shared/src/lib/permissions.ts` — add `canHoldEditorCapability(role)` + ProfileRole type

### Middleware + login redirects
- [x] `packages/shared/src/lib/supabase/middleware.ts`
  - [x] `getDashboardPath`: staff → `/`
  - [x] Admin-area gate: allow admin/staff/teacher; per-feature gate filters teachers without grants
  - [x] Editor feature gate: change `role === "editor"` → `role !== "admin"`
- [x] `apps/cms/src/app/login/page.tsx` — `redirectByRole`: { admin: "/", staff: "/" } (teachers enter via SwitchAppMenu cookie-share)
- [x] `apps/cms/src/proxy.ts` — replace editor check with staff/teacher+capability check
- [x] `apps/erp/src/app/(admin)/login/page.tsx` — drop editor, add staff
- [x] `apps/erp/src/app/portal/login/page.tsx` — same
- [x] `apps/erp/src/app/portal/settings/page.tsx` — branch on staff for admin-area redirect; teacher with from=cms/erp hint returns to source app

### Sidebar + module dashboards
- [x] `packages/shared/src/components/SidebarShell.tsx` — admin bypass; non-admin loads editor_permissions; renamed `isEditor` → `isAdmin` + `isCapabilityAllowed`
- [x] `packages/shared/src/types/index.ts` — UserRole drops 'editor', adds 'staff'
- [x] `apps/erp/src/app/(admin)/academics/page.tsx` — capability-presence filter (admin-bypass)
- [x] `apps/erp/src/app/(admin)/people/page.tsx` — same
- [x] `apps/erp/src/app/(admin)/exams/page.tsx` — same

### Switch UI
- [x] `apps/erp/src/components/portal/SwitchAppMenu.tsx` — new component (lives in apps/erp; teacher-only, not shared)
- [x] Added `footerExtra` slot to PortalSidebar; mounted SwitchAppMenu in TeacherSidebar (students/parents don't pass it, no extra DB hits for them)

### User management
- [x] `packages/shared/src/lib/validations.ts` — createUserSchema enum update
- [x] `apps/erp/src/app/api/users/route.ts` — validRoles update + role-demotion cleanup (admin/student/parent demotions wipe editor_permissions)
- [x] `apps/erp/src/app/api/editor-permissions/route.ts` — uses canHoldEditorCapability (staff/teacher only)
- [x] `apps/erp/src/app/(admin)/people/users/page.tsx` — ROLES array, badge, tabs ("Editors" → "Staff"), Permissions button visible for staff/teacher
- [x] `apps/erp/src/components/EditorPermissionsDialog.tsx` — copy refresh

### API audit pass
- [x] Grep `role === "editor"` across apps + packages — caught 30+ files
- [x] Variant A (admin-only fall-through, ~9 files): replaced editor branch with `if (role !== "admin")`
- [x] Variant B (admin/teacher fall-through, ~14 files): replaced editor branch with `if (role !== "admin" && role !== "teacher")`
- [x] Special: `results/bulk/route.ts` (3 branches incl. publish_results + finalized lock)
- [x] Special: `results/remarks/route.ts` (admin/editor M10-clobber rule → non-teacher)
- [x] Special: `fees/receipt/route.tsx` (isAdmin = admin/staff/teacher-with-fees-perm)
- [x] Special: `final-result/route.ts` + `report-card/pdf/route.tsx` (callerRole staff list)
- [x] Special: `lib/report-card.ts` (canViewReportCard staff-with-results)

### Verification (automated)
- [x] `pnpm --filter @nkps/erp lint` — only pre-existing failures unrelated to this change (no editor-capability files)
- [x] `pnpm --filter @nkps/erp build` — Compiled successfully
- [x] `pnpm --filter @nkps/cms build` — Compiled successfully
- [x] `pnpm exec tsc --noEmit` for apps/erp and apps/cms — clean

### Verification (manual — pending DB run)
After applying `migration-047-editor-capability.sql` to dev Supabase:
- [ ] Existing role='editor' user → role='staff', editor_permissions rows intact
- [ ] Staff login → admin root, sidebar shows only granted features
- [ ] Teacher (no perms) → /teacher; no Switch link; /admin/* redirects back to /teacher
- [ ] Teacher + Gallery grant → /teacher → SwitchAppMenu shows "Switch to CMS" → CMS Gallery only
- [ ] Teacher + Gallery → direct cms.nkps.com/articles → 403 / redirect (no grant)
- [ ] PATCH user role staff→student wipes their editor_permissions
- [ ] Try POST /api/editor-permissions with target role='student' → 400 "can only be granted to staff or teachers"
