-- migration-112-ai-audit.sql
--
-- The audit trail for every assistant interaction.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- This feature owns a reserved block: 110 school_profile, 111 export_events
-- source, 112 ai_audit, and 113 is held for the WhatsApp tables.
--
-- The block exists because sequential numbering failed here. 098 landed on
-- main as cms/migration-098-restrict-staff-pii.sql, then 099, 100 and 101 were
-- each claimed by a parallel branch mid-session — twice onto a number this
-- work had already taken. Renumbering into a gap terminates that race; the
-- gap itself is harmless, since apply order is by number and nothing reads the
-- sequence as contiguous.
--
-- Still re-run the check before adding a file:
--   ls scripts/migrations/*/ | grep -oE 'migration-[0-9]+' | sort | uniq -d
--
--
-- ── Why this is four tables and not one ─────────────────────────────────────
-- A single "ai_log" row per request cannot answer the question that actually
-- matters in an audit: *did the assistant ever read something the caller was
-- not entitled to?* Answering that needs the model's request and the server's
-- rewrite of it side by side, per tool call, which is a different grain from
-- the conversation and from the message.
--
-- ── The security signal ─────────────────────────────────────────────────────
-- ai_tool_calls stores BOTH args_raw (what the model asked for) and
-- args_scoped (what actually ran after the server injected the row scope).
-- The delta between them is the alarm: a model that tried to widen its own
-- scope shows up as a diff, and error_code = 'scope_violation' is countable.
-- Storing only the executed arguments would hide exactly the attempt worth
-- knowing about.
--
-- ── What is deliberately NOT stored ─────────────────────────────────────────
-- No row contents, ever. Counts, field KEYS and filter shapes only. An audit
-- table that copies the student data it is auditing doubles the blast radius
-- of the thing it exists to protect. Where the rows themselves matter, follow
-- ai_query_runs.id and re-run the query under a fresh authorization check.
--
-- ── RLS: enabled, zero policies, ON PURPOSE ─────────────────────────────────
-- These tables are service-role only. RLS is enabled with no policies so that
-- any client credential reads them as empty.
--
-- The explicit COMMENT on each table saying so is not decoration. An
-- unpolicied table under RLS returns an empty result rather than an error, so
-- the next person to read this schema cannot otherwise distinguish "locked
-- down deliberately" from "someone forgot the policy" — which is precisely
-- how bus_stops/bus_stop_fees came to silently understate transport fees.

-- ── Conversations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the request came in. whatsapp has no Supabase session, so user_id
  -- is null there and parent_id carries the identity.
  channel text NOT NULL CHECK (channel IN ('erp_web', 'portal_web', 'whatsapp')),
  feature text NOT NULL CHECK (feature IN ('ask', 'remarks', 'parent')),

  -- Actor. SET NULL so the trail outlives the account, matching export_events
  -- and historical_corrections.
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role text,
  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,

  -- The scope this conversation ran under, denormalised so an auditor can
  -- filter without joining every tool call. scope_hash is the fingerprint the
  -- export path re-checks before letting a download proceed.
  scope_kind text NOT NULL CHECK (scope_kind IN ('all', 'classes', 'students')),
  scope_hash text NOT NULL,

  model text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'error', 'aborted')),
  error_code text,

  started_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor
  ON ai_conversations (actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_channel
  ON ai_conversations (channel, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_parent
  ON ai_conversations (parent_id, started_at DESC) WHERE parent_id IS NOT NULL;

-- ── Messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL,

  role text NOT NULL CHECK (role IN ('user', 'assistant')),

  -- The human's own words are kept because support cannot debug "the
  -- assistant gave a wrong answer" without them. The assistant's data-bearing
  -- output is NOT kept here — follow ai_query_runs instead.
  content text,

  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  stop_reason text,
  latency_ms integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, seq);

-- ── Tool calls ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_seq integer,

  tool_name text NOT NULL,

  -- The pair that makes this table worth having. See the header.
  args_raw jsonb,
  args_scoped jsonb,
  scope_applied jsonb,

  -- Shape of what came back, never the contents.
  row_count integer,
  preview_row_count integer,
  field_keys text[] NOT NULL DEFAULT '{}',
  sensitive_included boolean NOT NULL DEFAULT false,

  duration_ms integer,
  error_code text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_conversation
  ON ai_tool_calls (conversation_id, created_at);
-- The alert query: scope violations, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_errors
  ON ai_tool_calls (created_at DESC) WHERE error_code IS NOT NULL;

-- ── Query runs ──────────────────────────────────────────────────────────────
-- The handle behind an answer. Holds the SCOPED filters, so re-running is
-- guaranteed to reproduce what the caller was entitled to and nothing wider.
--
-- Deliberately stores no rows: the on-screen table and the CSV re-execute
-- under a fresh authorization check rather than serving a cached result. That
-- costs a second query and means the export re-states its own total, but it
-- keeps a teacher who lost a class between preview and download from
-- exporting stale rows.
CREATE TABLE IF NOT EXISTS ai_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,

  filters jsonb NOT NULL,
  field_keys text[] NOT NULL DEFAULT '{}',
  total integer NOT NULL DEFAULT 0,
  capped boolean NOT NULL DEFAULT false,

  -- Re-derived on every read; a mismatch is a 403, not a stale download.
  scope_hash text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Checked lazily at read. There is no cron anywhere in this repo, so
  -- nothing here may depend on a sweeper existing.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  exported_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_query_runs_conversation
  ON ai_query_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_query_runs_expiry
  ON ai_query_runs (expires_at);

-- Close the loop opened in migration 111: an exported sheet points back at the
-- question that produced it. Added here because the target table exists now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_events_ai_run_id_fkey'
  ) THEN
    ALTER TABLE export_events
      ADD CONSTRAINT export_events_ai_run_id_fkey
      FOREIGN KEY (ai_run_id) REFERENCES ai_query_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_conversations IS
  'RLS enabled with NO policies, intentionally: service-role access only. Any '
  'client credential reads this as empty. Do not add a policy without deciding '
  'what a non-admin should be able to learn about other people''s questions.';
COMMENT ON TABLE ai_messages IS
  'RLS enabled with NO policies, intentionally: service-role access only.';
COMMENT ON TABLE ai_tool_calls IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'args_raw vs args_scoped is the scope-widening signal; keep both.';
COMMENT ON TABLE ai_query_runs IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'Stores scoped filters, never rows — readers re-execute under a fresh '
  'authorization check.';
