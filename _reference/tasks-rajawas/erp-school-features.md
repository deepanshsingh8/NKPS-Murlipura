# ERP — School-Specific Feature Requirements

Implementation log for the 10-section spec from on-ground school feedback.

---

## §1 Photograph upload spec & aspect fix ✅

- New `packages/shared/src/lib/photo-spec.ts` — single source of truth for the
  spec (1200 × 1500 px, 4:5 portrait, 2 MB, JPG/PNG) plus `validatePhotoFile()`.
- `packages/shared/src/components/FileDropZone.tsx` — actually enforces
  `maxSizeMB`, plus optional `acceptedMimeTypes` / `acceptedExtensions` /
  `onReject`.
- `apps/erp/src/app/(admin)/people/staff/page.tsx`:
  - Cropper switched from 1:1 round to 4:5 rectangular.
  - Helper text shown above the dropzone.
  - List & edit-dialog thumbnails switched from `rounded-full object-cover` to
    `aspect-[4/5] object-contain` so portraits aren't clipped.
- `apps/erp/src/app/portal/settings/page.tsx` — avatar size limit dropped from
  5 MB → 2 MB; format restricted to JPG/PNG.
- `apps/erp/src/components/pdf/AdmitCardPDF.tsx` — `objectFit: cover` →
  `contain` so 4:5 photos render fully inside the 84×104 frame.
- `apps/erp/src/app/api/upload-url/route.ts` — staff-photos bucket no longer
  accepts WebP and the description reflects the new spec.

## §2 Auto Timetable Generator (4 templates) ✅

- New table `timetable_templates` + `timetable_template_periods` (migration 049).
- Built-in templates A.1 / A.2 / A.3 / A.4 seeded with 8/6/5/4 teaching periods
  and a 20-minute lunch slot.
- Manager UI: `/admin/timetable/templates` — clone any system template, edit
  periods, delete custom ones. Server validation: every template must include
  at least one lunch slot.
- Generator UI: `/admin/timetable/generate` — pick template + classes + days,
  optional `replace`, optional `allow_subject_repeat`. Backed by
  `POST /api/timetable/generate` which enforces:
  - no teacher in two sections in the same period (cross-class)
  - no subject scheduled twice in the same day for one class
  - lunch positions are written as `is_break = true`
  - never overwrites unless `replace = true`
- Conflicts that the generator could not place are returned per row and shown
  inline.

## §3 Lunch break slot ✅

- `kind = 'lunch'` is a first-class concept in `timetable_template_periods`
  with configurable position and duration per template.
- The four built-in templates each include a 20-minute lunch.
- Generator writes lunch as `is_break = true` so the existing manual editor
  shows it (now styled distinctly with an amber background in
  `apps/erp/src/app/(admin)/timetable/page.tsx`).

## §4 Per-stream Compulsory / Elective tagging ✅

- `stream_subjects.requirement_type` (`compulsory` | `elective`) added.
  Mirrored to legacy `is_mandatory` for back-compat.
- Stream manager UI in `apps/erp/src/app/(admin)/academics/subjects/page.tsx`
  now writes both columns and shows the toggle as **Compulsory / Elective**.

## §5 Elective 5 / Elective 6 slots ✅

- New dedicated `student_elective_picks` table `(id, student_id, slot,
  subject_id, …)` with `unique(student_id, slot)`. Architectural note: the
  earlier `student_subjects` join table was dropped by `migration-erp-redesign`
  (subjects are inferred from class enrollment + class_subjects). Electives
  are inherently per-student, so they get a narrow dedicated table rather
  than reviving the deprecated one.
- New `elective_slot_options` table — admin-editable list of allowed subjects
  per slot. Seeded with:
  - Slot 5: Informatics Practices, Physical Education
  - Slot 6: Hindustani Music (Vocal), Painting
- New page `/admin/academics/electives` — slot-options manager + per-student
  picker for active XI/XII enrollments.
- API: `GET /api/electives`, `POST/DELETE /api/electives/options`,
  `POST/DELETE /api/electives/students`. Pick endpoint validates the chosen
  subject is a registered option for that slot.

## §6 Mathematics — Standard / Advanced ✅

- Migration 049 seeds two new subjects: `Mathematics — Standard` (code 241)
  and `Mathematics — Advanced` (code 041).
- The plain `Mathematics` subject is **not** auto-migrated. The Subjects page
  shows a banner whenever it's still linked to any class IX–XII so admin can
  reassign manually.

## §7 Arts → Humanities ✅

- DB seed already used Humanities; migration 049 contains a defensive backfill
  for any historical `Arts` rows.
- UI: `apps/erp/src/components/StudentBulkUpload.tsx` instruction text
  updated. The remaining `Arts` reference in `exams/page.tsx` is the
  co-curricular skill (fine arts), not the stream.

## §8 §9 Subject categories + nicknames ✅

- `subjects.category` (`languages` | `academic` | `co_curricular`),
  `subjects.nickname` text columns.
- Subjects admin form now requires Category and accepts a Nickname.
- List view filterable by category with badges; quick-setup wizard defaults
  new subjects to `academic`.
- Migration 049 best-effort backfills based on the subject name regex; admin
  can recategorize from the form.

## §10 Excel upload for timetables ✅

- New endpoints:
  - `GET  /api/timetable/import/template` — downloadable .xlsx with sample data
  - `POST /api/timetable/import` — parse + preview, no DB writes; returns
    per-row status (ok / warning / error) and conflict messages
  - `POST /api/timetable/import/commit` — atomic insert; refuses if any row
    has an error (no partial commit)
- New page `/admin/timetable/import` — preview table with downloadable
  CSV error report when rows fail.

---

## Migrations

- `scripts/migrations/erp/migration-049-school-features.sql` — single migration covering all
  schema changes plus seeds (per the project's "schema mirrors migrations"
  rule, every change is also reflected in `supabase-schema.sql`).

## Sidebar

`apps/erp/src/components/ErpSidebar.tsx` updated to surface
`/academics/electives` and the academics index page now lists it as a tile.
The timetable index gained header buttons for Templates / Auto Generate /
Import (Excel).
