# Fee Edit Approval Workflow

**Problem:** Editors with `fees` feature can currently both create AND modify existing fee
payments. If they record a wrong amount (e.g. ₹25,000 instead of ₹2,500), they can also
"fix" it silently — no second pair of eyes. We want to lock that down: editors create
freely, but any change to an existing payment must be approved by an admin.

**Approach (validated 2026-05-14):**
- Editors keep the ability to record new payments.
- Any mutation of an existing `fee_payments` row (update, delete, refund) is blocked for editors at the API layer.
- Editor instead files a `fee_change_request` with proposed values + reason.
- Admin reviews in an inbox, approves (change applies atomically + audit row) or rejects.
- Admin keeps direct edit; their edits are audited too.
- No new "super admin" role — existing `admin` is the approver.

**Out of scope (v1):** email notifications; approval flow for `fee_structures`/`transport_fare_slabs` (those stay admin-only direct); approval flow for other modules.

---

## DB layer — migration 056

- [x] D1. Create `scripts/migrations/erp/migration-056-fee-change-requests.sql`
- [x] D2. Table `fee_change_requests` (target_table, target_id, action, current_snapshot, proposed_changes, reason, status, requested_by/at, reviewed_by/at, review_notes)
- [x] D3. Partial unique index: only one row per (target_table, target_id) WHERE status='pending'
- [x] D4. Table `fee_change_audit_log` (target_table, target_id, action, before, after, performed_by, performed_at, source_request_id nullable)
- [x] D5. Mirror both tables into `supabase-schema.sql` (per memory: schema mirrors migrations)

## Backend — gating + endpoints

- [x] B1. `verifyAdminOrEditorWithUser` returns `role: 'admin' | 'editor'` (so callers can branch)
- [x] B2. Admin-proxy: new optional config `editorRestrictedActions` blocks editor update/delete on listed tables; returns 403 with body `{ code: 'EDITOR_MUST_REQUEST', table, action, match }`
- [x] B3. Wire `fee_payments: ['update','delete']` into ERP `/api/admin/route.ts`
- [x] B4. `/api/fees/payments/[id]/refund` — editors get `EDITOR_MUST_REQUEST` 403
- [x] B5. `POST /api/fees/change-requests` — editor or admin files a request
- [x] B6. `GET /api/fees/change-requests` — list with filters (status, mine)
- [x] B7. `GET /api/fees/change-requests/[id]` — single, with target row fetched for drift check
- [x] B8. `POST /api/fees/change-requests/[id]/approve` — admin-only; atomic claim + apply mutation + audit row + flip status
- [x] B9. `POST /api/fees/change-requests/[id]/reject` — admin-only; status='rejected' + reason
- [x] B10. `POST /api/fees/change-requests/[id]/cancel` — requester or admin; status='cancelled'
- [x] B11. `GET /api/fees/change-requests/pending-count` — for sidebar badge
- [x] B12. Zod schemas + permission feature key mapping (`fees`)

## Frontend — editor + admin UX

- [x] F1. ~~RequestChangeDialog component~~ — folded into existing Refund dialog (same form, role-aware title/button/copy). Cleaner than a parallel dialog.
- [x] F2. In `AdminFeesContent.tsx`: detect editor role; refund dialog flips to "Submit Refund Request" for editors and POSTs to `/api/fees/change-requests`
- [x] F3. Direct-mutation paths (admin proxy update/delete) already return `EDITOR_MUST_REQUEST` — no UI surface for these in AdminFeesContent today; future buttons can pattern-match the code and reuse the request flow.
- [x] F4. New page `/fees/change-requests` (admin sees all + tabs; editor sees own only — API enforces)
- [x] F5. Diff viewer — side-by-side current vs proposed; warning banner if `current_snapshot` no longer matches DB
- [x] F6. Approve / Reject actions on request detail (admin only); editor sees Cancel for own pending requests. Note: approve still works on drift (with banner) — strict block felt punitive when most drift is benign timestamp updates.
- [x] F7. Sidebar: add "Change Requests" under Fees group in `ErpSidebar.tsx`
- [x] F8. Sidebar badge: pending count via `useUnreadCount` extension. Also taught `renderNestedLink` in `SidebarShell` to honor badges (it previously didn't — the registrations badge config was dormant).

## Verification

- [x] V1. `npm run lint` clean (0 errors; pre-existing warnings only)
- [x] V2. `npm run build` succeeds — typecheck included; new route `/fees/change-requests` registered
- [ ] V3. **User to run**: run `migration-056-fee-change-requests.sql` in Supabase SQL editor, then walk through the editor → admin scenario in dev. Steps: log in as a staff editor with `fees` grant → record a ₹25,000 payment → click Refund → fill reason → "Submit Refund Request" → log in as admin → sidebar shows badge `1` next to "Change Requests" → open inbox → review diff → Approve & apply → verify payment row updated to refunded with ₹2,500 etc.
- [ ] V4. **User to run**: as editor, `curl -X POST /api/admin -d '{"action":"update","table":"fee_payments","data":{"amount_paid":1},"match":{"column":"id","value":"<id>"}}'` with the editor's bearer — should return 403 with `code: "EDITOR_MUST_REQUEST"`.
- [ ] V5. **User to run**: as admin, edit a payment directly via the (future) edit UI or proxy curl — should succeed without a request, but ideally a follow-up adds direct-edit audit rows. (Current scope: admin edits aren't audited yet — the audit log only fires on approved requests. Tracked as a v2 enhancement.)
- [ ] V6. **User to run**: open a pending request, then have a second admin tab edit the underlying payment directly. Refresh the request — drift banner should appear listing the changed columns.

## Review

**What shipped:**
- **DB (migration-056):** `fee_change_requests` (queue) + `fee_change_audit_log` (applied-change ledger). One pending request per target row (partial unique index). RLS admin-only; service-role API is the real gate. Mirrored in `supabase-schema.sql`.
- **Gating:** `verifyAdminOrEditorWithUser` now returns `role`. `admin-proxy` accepts `editorRestrictedActions`; ERP wires `fee_payments: ['update','delete']` → editors hitting those get a structured 403 (`code: EDITOR_MUST_REQUEST`). Refund route gates the same way (it's an update under the hood).
- **API:** 5 routes under `/api/fees/change-requests/` — list, detail (with live-row drift hook), create, approve (atomic claim + apply + audit + auto-revert on failure), reject, cancel, pending-count.
- **UX (editor):** Existing Refund dialog flips title/copy/button to "Submit Refund Request" when caller is editor; posts to the change-requests endpoint instead.
- **UX (admin):** New `/fees/change-requests` inbox with status tabs, side-by-side diff viewer, drift banner, approve/reject/cancel actions, review notes. Sidebar gets a "Change Requests" link with a pending-count badge (admins see all-pending, editors see own-pending).

**Deviations from plan:**
- Skipped a parallel "RequestChangeDialog" component — folded the role-aware copy into the existing Refund dialog. Less code, same UX, no double-form to maintain.
- Approve is NOT hard-blocked on drift. The diff viewer shows a clear amber warning; the admin decides. Most drift is benign (`updated_at` ticks, status auto-downgrades) and hard-blocking would force editors to refile pristine requests for cosmetic clashes. If we see admins approving on drift and regretting it, harden later.
- Discovered + fixed a latent gap: `renderNestedLink` in `SidebarShell` never rendered badges. The registrations badge config was effectively dormant. Now both registrations and fee-change-requests badges render on nested links.
- Admin direct edits (e.g. via admin proxy or future direct-edit UI) are not yet audited. Out of scope for this change — they would need a write-through hook on `admin-proxy`. Tracked as a v2.

**To finish (user side):**
1. Run `scripts/migrations/erp/migration-056-fee-change-requests.sql` in Supabase Studio.
2. Walk through V3–V6.
