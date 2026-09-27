# Upstream sync — NKPS → Murlipura (September 2026) + Class Diary

- **Upstream:** `deepanshsingh8/NKPS` `main` @ **`2886b25`** (2026-09-22)
- **Base (last sync):** `00ac881` — `tasks/upstream-sync-2026-08.md`
- **Delta:** ~170 upstream commits, 438 files, 31 new migrations (086–126),
  dependency changes in `erp`, `cms` and `shared`.
- **Plus:** the Class Diary — Murlipura's replacement for the per-class
  WhatsApp groups (homework, holiday homework, notices, fee reminders, photos).

## 1. Method

Per-file **three-way merge** of `apps/erp`, `apps/cms`, `packages/shared`:
base = upstream @ `00ac881`, ours = Murlipura HEAD, theirs = upstream @
`2886b25`. Unlike the August "overlay then re-stitch", only files Murlipura
had actually changed needed any attention:

| Outcome | Files |
|---|---:|
| Taken from upstream (untouched here) | 214 updated, 151 added, 1 deleted |
| Auto-merged (both sides changed) | 9 — constants, permissions, types, pwa-manifest, ImageCropper, CounterAnimation, staff page, users API, registrations approve |
| Kept ours (upstream unchanged) | 6 |
| Murlipura-only, kept | 8 |
| Conflicts, resolved by hand | 5 — below |

**Hand-resolved**

- `apps/{erp,cms}/src/app/layout.tsx` — took upstream's viewport; theme colour
  moved to `ThemeProvider`, whose `THEME_COLORS` is now a Murlipura hand-merge
  point (`#0A3D2A` / `#05241A`).
- `apps/{erp,cms}/src/app/globals.css` — upstream filled the navy ramp to
  50–950 and added a full dark theme. Rebuilt both in forest green
  (hue ~150) so `bg-navy-100`-style chips and dark mode render green, not navy.
- `people/users/page.tsx` — upstream moved Users to `/administration/users`.
  Re-applied the temporary-password UI there (Pending passwords, Temp password
  badge, reveal). Upstream's new **Reset password** replaces our reset icon, and
  its route now also stores the new password in our vault
  (`storeTempPassword`) so it stays revealable until the user changes it.

**Other Murlipura adjustments**

- `migration-110-school-profile.sql` (+ schema mirror): seed row is Murlipura
  (name, Arya Nagar address, 302039, phones …42/…61, e-mails, RBSE, geo).
- AI remark drafts no longer tell the model the school is CBSE.
- Murlipura-local migrations renumbered into a **9xx band**: 087 → **901**,
  088 → **902**; the new Class Diary is **903**. Upstream now owns erp/087 and
  erp/088.
- Mobile-layout check: fixed the ERP/CMS offenders (TempPasswordDialog `85vh`,
  holiday-homework grid); the website's older pages go into
  `scripts/mobile-layout-baseline.json` (website is out of sync scope).
- `.env.example` / `turbo.json`: AI, WhatsApp, WebAuthn (App Lock) variables.

**Gate:** `typecheck` ✅ · `lint` 0 errors ✅ · `check:guide|api-auth|mobile|colors|pwa` ✅ ·
`build` 3/3 ✅ (placeholder env).

## 2. Database

`scripts/migrations/CONSOLIDATED-upstream-sync-2026-09.sql` — 086…126 verbatim
in ascending order, then 903. Wrong-database guard as in August; a DROP guard
before 104 so the script is re-runnable.

**Pre-flight against the live Murlipura DB (read-only, 2026-09-27):**

- State = August sync applied, plus 901 and 902 (buckets + `user_temp_credentials`).
  0 students, 0 enrollments, 0 payments, 2 classes, 39 teachers, 48 profiles —
  so the data-rewriting steps (122 sort order, 123 exit-date backfill, 115
  batch reconstruction) have nothing to rewrite.
- Every column, function and view the migrations reference exists; the four
  transport policies are exactly the ones 104 drops (its anon-read assertion
  will pass); `timetable_assignment_drift` has the column list 119 re-creates.
- 903 executed inside a transaction and rolled back — clean; nothing persisted.

**Status: ✅ applied 2026-09-27** to the Murlipura project via Supabase
migrations, in seven transactional batches (each all-or-nothing):
`upstream_sync_2026_09_part1_086_090` … `part6_121_126`, then
`murlipura_903_class_diary`. The consolidated script is kept for re-runs and
fresh databases; it is idempotent.

Side effect of 098: `staff_members` is no longer readable anonymously, so the
public website's faculty directory now reads the `public_staff_directory` view
(same fix as upstream).

Not included: `scripts/_apply-ai-feature-migrations.sql` /
`_enable-ai-assistant.sql`. The AI assistant stays off until
`ANTHROPIC_API_KEY` is set and `school_profile.ai_enabled` is switched on.

## 3. Class Diary

| Who | Where | Can |
|---|---|---|
| Teacher | `/teacher/class-diary` | Post to classes they class-teach or teach a subject in (same scope as attendance/marks); edit/delete own posts; see "Seen by N" |
| Office (admin, or staff/teacher granted **Class Diary**) | `/class-diary` | Post to any class or the whole school; pin; edit/delete anything |
| Parent | `/parent/diary` | Read posts for each child's current class + school-wide; outstanding fees card |
| Student | `/student/diary` | Same, for their own class |

- Types: Homework · Holiday Homework · Notice · Fee Reminder · Photos.
  Homework can carry a subject and a "submit by" date.
- Attachments: up to 10 photos/PDFs per post, 10 MB each, in the **private**
  `class-diary` bucket; phone photos are re-encoded to WebP before upload;
  families get 1-hour signed links. Upload paths are prefixed with the
  uploader's id so a post can't reference another class's files.
- Posting to several classes writes one row per class (`batch_id` links them),
  so each class's copy is edited, deleted and "seen" independently. Deleting a
  copy removes a file only when no other copy still uses it.
- Fee reminders: families see a live **Fees pending** card computed by the same
  `getStudentOutstandingDues()` the download gate uses, next to any reminder
  the office posts.
- Read receipts: opening the diary marks the loaded posts read; teachers see a
  count (accounts, not families).

Files: `migration-903-class-diary.sql`, `apps/erp/src/lib/class-diary.ts`,
`apps/erp/src/app/api/class-diary/**`, `apps/erp/src/components/class-diary/**`,
four pages, four sidebar links, two guide entries, feature key `class_diary`.

## 4. Remaining — needs a real database / people

| | Step | Status |
|---|---|---|
| 1 | Run `CONSOLIDATED-upstream-sync-2026-09.sql` on Murlipura | ✅ 2026-09-27 |
| 2 | Preview deploy: fees, students, timetable, reports smoke test | ⬜ |
| 3 | Class Diary end-to-end: teacher posts homework with a photo → parent sees it, photo opens, "Seen by 1" | ⬜ |
| 4 | Office posts a whole-school notice and a pinned fee reminder | ⬜ |
| 5 | Set `NEXT_PUBLIC_WEBAUTHN_RP_ID` **before** anyone enrols Face ID | ⬜ |
| 6 | Merge; tell teachers and parents to use the diary instead of the groups | ⬜ |

Known, not changed here: Murlipura overrides `blue-400..600` to green, and
upstream now uses `blue` to mean *information* in status badges, so an info
badge's text/icon can read green. Worth a look when the palette is next touched.
