# Admin/Editor: per-student results editor

Goal: let admin (and editor with `results` permission) search any student, see all their exams with marks, and edit/delete marks — independent of teacher assignments.

## Scope
- Lives at `/admin/exams/results/edit` (sibling of existing analytics page; nests under existing Exams sidebar group → no new top-level entry).
- Reuses existing `results` feature key for editor permission gating.
- Does NOT touch RLS — admins already have full access; editors hit API routes that go through service-role via `verifyAdminOrEditor("results")`.

## Tasks

### Backend
- [x] `GET /api/erp/results/by-student?student_id=...` — returns student info, exam list, results grouped by exam → subject, plus class subject roster for "+ add missing subject" UI.
- [x] `POST /api/erp/results/by-student` — upserts one (student_id, exam_type_id, subject_id) row, recomputes grade.
- [x] `DELETE /api/erp/results/by-student?id=...` — deletes a single row.
- [x] `PATCH /api/erp/results/by-student` — surgical unlock (scope=row | scope=exam) for the A1 unlock workflow. Logs to publish_events.
- [x] All four gated by `verifyAdminOrEditor("results")` / `verifyAdminOrEditorWithUser("results")`.
- [x] Block edits + deletes on published rows; surface PUBLISHED_LOCKED so the UI can offer the unlock path.

### Frontend
- [x] New page `/admin/exams/results/edit/page.tsx` — student search → exam accordion → marks grid with save/delete/unlock per row + add-missing-subject row.
- [x] Per-row unlock button + per-exam "Unlock all" with banner explaining the consequence.
- [x] No raw UUIDs — class label, exam name, subject name resolved server-side.

### Wiring
- [x] "Edit student results" Link in the analytics page header — no new sidebar entry.

## Out of scope (for now)
- Bulk edit across students (already exists via `/api/erp/results/bulk`).
- Editing exam_type max_marks — the source-of-truth remains exam_types.
- History/audit log of mark edits (the `entered_by` column already records who saved last).
