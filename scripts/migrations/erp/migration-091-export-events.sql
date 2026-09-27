-- Migration 091 — export_events (who downloaded which list, and how much of it).
--
-- The admin lists gain a filter-then-download action across every section:
-- students, staff, fees, transport, users. One click on the students list now
-- yields every child's name, class, father's name, address and parent mobile
-- as a file that leaves the building, and nothing records that it happened.
-- This table is that record.
--
-- ── Why not a new FeatureKey instead ───────────────────────────────────────
-- Gating "may export" separately from "may view" would gate nothing: an editor
-- granted `students` already renders every one of those rows on screen, and
-- select-all + copy-paste is an export. The control that actually helps is
-- knowing a bulk extraction occurred (this table) plus withholding contact
-- fields from non-admins (enforced in the export routes), not a checkbox that
-- stops the Download button while the data sits in the DOM.
--
-- ── Why append-only, admin-read, service-role-write ────────────────────────
-- Same posture as student_status_history (087): an audit row must not be
-- editable by the actor it describes. Writes go exclusively through the
-- export routes on the service-role client, so no INSERT/UPDATE/DELETE policy
-- is granted to any role.
--
-- ── Why only server-generated exports appear here ──────────────────────────
-- Non-sensitive operational tables (calendar, buses, stops, exam timetable)
-- build their CSV/XLSX in the browser, and are deliberately NOT logged: a
-- client-side beacon is trivially blocked, and a log that silently misses
-- entries is worse than no log because it reads as complete. The sensitive
-- datasets are routed through the server precisely so that this table IS
-- complete for them.
--
-- `publish_events` was considered and rejected as the sink for the same reason
-- 087 rejected it: its event_type CHECK is results-publishing vocabulary, and
-- every field here would collapse into unqueryable free text.

-- ── What actually writes here ──────────────────────────────────────────────
-- Today: 'students' (the one dataset the server can answer better than the
-- browser — past sessions include students who have since left, and the
-- subject filter needs a two-hop join the list payload does not carry) and
-- 'table_pdf' (every PDF, from any list, since rendering is server-side).
--
-- The other dataset values are reserved. They are listed now so that moving a
-- dataset server-side later is a route change rather than a CHECK-constraint
-- migration — but note that moving one only makes sense when the server can
-- supply something the page cannot. Where the browser already holds every row
-- (staff, users), a server route could withhold nothing and would log an act
-- the page can perform anyway, which is the "complete-looking but hollow"
-- outcome this table is meant to avoid.

CREATE TABLE IF NOT EXISTS export_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: the record of an export must outlive the account
  -- that made it (see migration 046).
  actor_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role       text,
  dataset          text NOT NULL CHECK (dataset IN (
                     'students', 'staff', 'fees_dues', 'transport_assignments',
                     'users', 'registrations', 'table_pdf')),
  feature_key      text,
  format           text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  row_count        integer NOT NULL DEFAULT 0,
  column_count     integer NOT NULL DEFAULT 0,
  fields           text[] NOT NULL DEFAULT '{}',
  -- True when the export included an admin-only field group (contact details,
  -- identity numbers). The one column worth alerting on.
  sensitive        boolean NOT NULL DEFAULT false,
  filter_summary   text,
  filter_spec      jsonb,
  source_app       text CHECK (source_app IN ('erp', 'cms')),
  source_path      text,
  -- text, NOT inet: a malformed X-Forwarded-For would raise 22P02 and, since
  -- the insert rides alongside the download, an audit write must never be able
  -- to fail the download it is describing.
  client_ip        text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_events_actor
  ON export_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_events_dataset
  ON export_events(dataset, created_at DESC);
-- Partial: "show me the bulk extractions of contact data" is the query this
-- table exists to answer quickly.
CREATE INDEX IF NOT EXISTS idx_export_events_sensitive
  ON export_events(created_at DESC) WHERE sensitive;

ALTER TABLE export_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read export_events" ON export_events;
CREATE POLICY "Admins read export_events"
  ON export_events FOR SELECT
  USING (public.get_user_role() = 'admin');
