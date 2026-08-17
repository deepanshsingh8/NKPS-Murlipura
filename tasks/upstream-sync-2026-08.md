# Upstream sync — NKPS → Murlipura (August 2026)

Comparison and migration plan for bringing `apps/erp` and `apps/cms` up to the
state of the parent repo, **`deepanshsingh8/NKPS`** (`main`).

- **Last sync:** 2026-07-27 — commits `48ab205` (code) + `257729a` (DB), PR #9,
  with the follow-up fix `03aef8b` (PR #10).
- **Upstream HEAD at time of writing:** `00ac881`, 2026-08-16.
- **Delta:** 14 functional upstream commits, 3 new DB migrations, 0 dependency
  changes.

> ### The prior plan
> There is no separate plan document — the method is recorded in the commit
> messages of `48ab205` and `257729a`. It was: **overlay upstream's
> `apps/erp`, `apps/cms` and `packages/shared` wholesale, then re-stitch the
> Murlipura layer back on top**, and ship a single consolidated, idempotent SQL
> script for the DB rather than asking anyone to run 26 migrations in order.
> That approach is reused below. `scripts/migrations/CONSOLIDATED-erp-cms-upstream-sync.sql`
> is the template for the DB half.

---

## 1. Scope

| Area | In scope | Note |
|---|:---:|---|
| `apps/erp` | ✅ | 33 modified files, 4 new |
| `apps/cms` | ✅ | 7 modified files |
| `packages/shared` | ✅ | 14 modified, 2 new, 2 retired |
| `scripts/migrations` | ✅ | 3 new migrations + 1 ops script |
| `apps/website` | ❌ | Deliberately excluded — Murlipura's website has diverged (chalkboard theme, RBSE content, Murlipura nav). See [§5](#5-decisions-needed) for the one place this bites. |

**No dependency changes.** Every `package.json` across `erp`, `cms` and
`shared` is byte-identical to upstream. Nothing to install, no lockfile churn,
no version-bump risk. This is the single biggest de-risking fact in this sync.

---

## 2. What upstream added

Six feature groups, ordered by size.

### A. Instalment-based fee schedules — the big one
`198f0a7`, `ec0cc71`, `2d2318a`, `69153e6`, `244d0c0`

Replaces the recurring one-row-per-class fee model with named instalments
carrying due dates, late-fee start dates and new/existing student targeting.

| File | Change |
|---|---|
| `apps/erp/.../fees/_components/AdminFeesContent.tsx` | **1508 lines** — largest single diff |
| `apps/erp/.../fees/_components/FeeScheduleGrid.tsx` | **new** — the schedule editor |
| `apps/erp/app/(admin)/fees/dues/` | **new** route — dues & no-dues register |
| `apps/erp/app/api/fees/schedule/` | **new** API route |
| `apps/erp/lib/fees.ts` | 276 lines — instalment maths |
| `apps/erp/lib/student-dues.ts` | 45 lines — dues measured to date |
| `apps/erp/app/{parent,student}/fees/page.tsx` | dues shown on portal fee screens |
| `packages/shared/components/DashboardAnalytics.tsx` | 259 lines — outstanding-dues card |
| `packages/shared/lib/validations.ts` | `feeScheduleRowSchema`, `feeScheduleSchema`, `feeScheduleCopySchema` |
| `packages/shared/types/index.ts` | `FeeStudentType`, `FEE_HEADS` |
| `apps/erp/components/ErpSidebar.tsx` | adds the "Dues & No-Dues" nav link |
| **DB** | `erp/migration-085-fee-instalment-schedule.sql` |

Also adds fee headcounts and makes the fees screens default to every student.

### B. Per-column sorting and filtering on list tables
`3e378c5`

New shared primitive `packages/shared/components/ui/data-table.tsx`
(`SortFilterHead`, `TableFilterSummary`, `useTableControls`, `TableColumns`),
then rolled out across **25 list pages** — 21 in ERP, 4 in CMS.

This is the widest-reaching change but the most mechanical: each page gains a
`TableColumns` descriptor and swaps its `<th>`s for `SortFilterHead`. It
accounts for most of the mid-size diffs (46–158 lines each) in academics,
exams, transport, people, calendar, attendance, and the CMS list pages.

Supporting change: `packages/shared/lib/hooks/use-url-state.ts` (33 lines).

### C. Transport — suggest buses by stop
`b351318`, `ce42e21`, `e2eb5ec`

- `apps/erp/app/api/transport/assignments/` — **new** service-role route
- `apps/erp/.../transport/assignments/page.tsx` — 622 lines
- Fixes the no-bus deep link; surfaces late fees and exits

### D. Unified NKPS Agent widget
`ac3a711`

`packages/shared/components/NkpsAgent.tsx` **replaces** `ChatBot.tsx` +
`WhatsAppButton.tsx`, which upstream deleted. Murlipura still has both old
files.

> ⚠️ Murlipura's website mounts the old components. Retiring them is an ERP/CMS
> sync action with a **website** consequence — see [§5](#5-decisions-needed).

### E. Student Council & House Captains
`82925eb`, `fa4892f`, `00ac881`

Adds `student_council` and `house_captains` to `SectionCardType`. The CMS side
is data-driven — no new CMS files, it flows through the existing section-cards
UI once the type union and the DB constraint allow it.

| | |
|---|---|
| `packages/shared/types/index.ts` | two new union members |
| **DB** | `cms/migration-086-student-council-sections.sql` |
| Website | new display components — **out of scope** |

### F. Staff / student correctness and performance
`d2b7783`, `06481a0`, `3a99aa9`, `84b457b`

- Cut round trips in the student list and auth gates (`people/students`, 511 lines)
- Fix input lag in the add/edit student form (`StudentFormFields.tsx`, 245 lines)
- Restore student-data reads for the `staff` role — **DB** `erp/migration-084-staff-student-read-rls.sql`
- Show which field failed when a staff save is rejected (`people/staff`, 249 lines)
- `packages/shared/lib/{verify-admin,admin-proxy,supabase/middleware,student-template}.ts`

---

## 3. What must survive — the Murlipura layer

Overlaying upstream will flatten all of this. Every item below has to be
re-applied afterwards. This is the same re-stitch list as the July sync, plus
one new entry.

### Branding — never take upstream's version

| File | What is ours |
|---|---|
| `packages/shared/lib/constants.ts` | Name, tagline, Murlipura address + pin `302039`, phones `…42`/`…61`, `nkpsem@`/`nkpsjaipur@`, WhatsApp, **RBSE** affiliation, mission/vision. Upstream is Rajawas/CBSE with a different geo. |
| `packages/shared/lib/seo.ts` | Murlipura metadata + `DEFAULT_SITE_URL = https://www.nkpublicschool.org` |
| `packages/shared/lib/email.ts` | `noreply@nkpublicschool.org` fallback ← **new since July; came from PR #11** |
| `packages/shared/lib/pwa-manifest.ts` | `THEME_COLOR = "#0A3D2A"` |
| `apps/{erp,cms}/src/app/layout.tsx` | `themeColor: "#0A3D2A"` |
| `apps/{erp,cms}/src/app/globals.css` | Forest-emerald palette (40 lines each) |
| `packages/shared/components/CounterAnimation.tsx` | Our superset with the optional `display` prop, used by the website |

### Murlipura-only CMS features — upstream has no equivalent

- `apps/cms/src/app/holiday-homework/` + `apps/cms/src/app/api/holiday-homework/`
- `apps/cms/src/app/prospectus/` + `apps/cms/src/app/api/prospectus/`
- `apps/cms/src/app/change-password/`
- `packages/shared/types/index.ts` → `HolidayHomework`, `ProspectusDocument`
- `packages/shared/lib/permissions.ts` → the `prospectus` and `holiday_homework`
  feature keys and their catalog rows

`types/index.ts` and `permissions.ts` therefore need a **merge, not an
overwrite** — they carry Murlipura additions *and* upstream additions.

---

## 4. Risks

### 🔴 R1 — Migration 086 silently drops `latest_updates`

`cms/migration-086-student-council-sections.sql` drops and recreates the
`section_cards_section_check` constraint from upstream's list of allowed
sections. That list **does not include `latest_updates`**, which Murlipura
allows and has seeded rows for (`cms/apply-section-card-defaults.sql` inserts
three: "Admissions Open 2026-27", "Annual Sports Meet", "Board Exam
Preparation"). Upstream has no `latest_updates` anywhere.

Run 086 verbatim and the `ALTER` fails against existing rows — or, if those
rows were removed, it quietly makes them un-insertable later.

**Fix:** patch 086 to carry the union — upstream's 16 sections **plus**
`latest_updates`. This is exactly the failure `03aef8b` fixed last time; the
constraint is a recurring collision point and should be treated as a
merge-by-hand file every sync.

### 🟠 R2 — Retiring ChatBot/WhatsAppButton reaches into the website

Deleting them because upstream did will break the website's imports. Either
keep both files until the website is migrated, or do the `NkpsAgent` swap on
the website in the same pass — which widens scope past ERP/CMS.

### 🟠 R3 — `reset-current-year-fee-structures.sql` is not a migration

Upstream ships it under `scripts/migrations/erp/` but its own header says it is
**not** a migration and nothing runs it automatically. It deletes and
deactivates fee-structure rows. Import it for parity, but it must not go into
the consolidated script, and it must never be run unattended.

### 🟡 R4 — Migration numbering has already collided

Murlipura owns `cms/migration-059..062` (prospectus, holiday-homework,
news-achievements, RBSE rebrand) while upstream's `059–083` occupy the same
numbers in `base/`, `cross/` and `erp/`. They don't clash today only because
they sit in different directories. Upstream is now at 086 and will keep
climbing into our range. Worth renumbering the Murlipura-local ones into a
reserved band (e.g. `9xx`) as part of this pass.

### 🟡 R5 — Sequencing against the `.org` launch

This lands on the same branch as the domain cutover. A 1500-line fees rewrite
going live in the same window as the DNS change means a broken fee screen and
a broken domain look identical from the outside. Recommend: **land the domain
cutover first, verify it, then sync.**

---

## 5. Decisions needed

1. **Website scope.** Student Council / House Captains and the `NkpsAgent`
   swap both have website halves. Options: (a) ERP+CMS only, leave the section
   types unrenderable and keep the old chat components; (b) include the two
   website pieces; (c) full website sync — *not* recommended, the themes have
   diverged too far.
2. **Fee-model cutover.** Migration 085 changes the fee model. If Murlipura has
   live fee data for the current year, decide whether to rebuild schedules via
   the reset script or migrate the existing rows.
3. **Ordering vs the domain launch** — see R5.

---

## 6. Execution plan

**Phase 0 — Baseline**
1. Confirm `main` is green: `pnpm install --frozen-lockfile && pnpm run lint && pnpm run typecheck && pnpm run build`.
2. Branch from `main`. Tag the pre-sync commit so a revert is one command.
3. Record the upstream SHA being synced (`00ac881`) **in the commit message** —
   the July sync didn't, which is why this comparison had to be reconstructed
   from dates.

**Phase 1 — Code overlay**
4. Overlay `apps/erp/src`, `apps/cms/src`, `packages/shared/src` from upstream.
5. Re-apply every item in [§3](#3-what-must-survive--the-murlipura-layer).
6. Hand-merge `types/index.ts` and `permissions.ts` (both directions).
7. Restore the Murlipura-only CMS route and API directories.
8. Resolve R2 per the §5 decision.
9. Gate: `lint`, `typecheck`, `build` all clean across the three apps.

**Phase 2 — Database**
10. Import `erp/084`, `erp/085`, `cms/086` and the `reset-…` ops script.
11. **Patch 086 for `latest_updates`** (R1).
12. Build `CONSOLIDATED-upstream-sync-2026-08.sql` — ordered, idempotent,
    ERP-before-CMS, excluding the reset script and any Rajawas-specific seeds.
13. Dry-run against a Supabase branch or a restored copy, never production first.

**Phase 3 — Verification**
14. Fee schedule: create instalments, publish, check dues on admin, parent and
    student screens, generate a receipt.
15. Sort/filter on a sample of the 25 touched list pages.
16. Transport: assign by stop, follow the no-bus deep link.
17. Staff role: confirm 084 restored student reads.
18. CMS: confirm holiday-homework, prospectus and change-password still work —
    these are the ones the overlay is most likely to have eaten.
19. Confirm `latest_updates` cards still render.

**Phase 4 — Ship**
20. One PR. Body lists the upstream SHA, the feature groups, and the DB script
    that has to be run.
21. Run the consolidated script **before** merging, so the deploy doesn't land
    code that needs columns the DB lacks.

---

## 7. Reference

| | |
|---|---|
| Upstream | `https://github.com/deepanshsingh8/NKPS` @ `00ac881` |
| Read-only clone used for this comparison | `/workspace/deepanshsingh8/nkps` |
| Prior sync | `48ab205`, `257729a`, fix `03aef8b` (PRs #9, #10) |
| Consolidated-migration template | `scripts/migrations/CONSOLIDATED-erp-cms-upstream-sync.sql` |

Regenerate the file-level comparison with:

```bash
U=/workspace/deepanshsingh8/nkps
for d in apps/erp apps/cms packages/shared; do
  echo "### $d"
  diff -rq "$U/$d/src" "$d/src"
done
```
