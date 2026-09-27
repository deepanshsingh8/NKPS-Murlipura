-- migration-114-ai-chat-history.sql
--
-- Turns the Ask audit trail into a resumable chat.
--
-- ── This migration reverses a deliberate decision made in 112 ───────────────
-- 112 wrote: "The assistant's data-bearing output is NOT kept here — follow
-- ai_query_runs instead." That was the right call for an audit table. It is
-- the wrong call for a chat, because a conversation you cannot read back is
-- not a conversation — reopening one would show your questions above blank
-- bubbles.
--
-- So ai_messages stops being pure metadata and starts holding student facts:
-- names, counts, fee figures, and — when the caller unlocked sensitive
-- columns — quoted contact details. Three consequences worth naming out loud,
-- because a migration that quietly widens a blast radius is how these things
-- go wrong:
--
--   1. A service-role key leak now yields readable student information from
--      this table, not just counts.
--   2. Erasure and DSAR handling gains a location it did not have.
--   3. The derived text would otherwise outlive its source — ai_query_runs
--      expires in hours while a reply would live forever.
--
-- (3) is answered by redaction on delete: removing a chat NULLs the words and
-- stamps redacted_at, while ai_tool_calls and ai_query_runs are left intact.
-- What an auditor needs — did the assistant read something it should not
-- have? — lives in those two tables, and a user deleting a chat does not get
-- to erase that. The COMMENT rewrite at the bottom records the new deal.

-- ── Conversations: listable, titled, renameable, hideable ───────────────────
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS title text,

  -- 'auto' means machine-written and safe to overwrite; 'user' means a human
  -- named it and the titler must never clobber it. A nullable flag rather
  -- than a boolean because a pre-114 row is neither.
  ADD COLUMN IF NOT EXISTS title_source text
    CHECK (title_source IN ('auto', 'user')),

  -- Soft delete. A hard DELETE cascades ai_messages AND ai_tool_calls, which
  -- would let anyone erase the record of what the assistant read simply by
  -- tidying their chat list. The audit outlives the conversation.
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- The sidebar query, exactly: mine, this surface, not deleted, newest first.
-- 112's index is on (actor_id, started_at DESC) — the wrong column for a list
-- that reorders every time a reply lands.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor_recent
  ON ai_conversations (actor_id, feature, last_at DESC)
  WHERE deleted_at IS NULL;

-- ── Messages: the reply text, per-turn failure, and redaction ───────────────
ALTER TABLE ai_messages
  -- Why a turn ended badly. ai_conversations.status carried this when a
  -- conversation was a single turn; it no longer is, and one aborted turn
  -- must not make the whole chat read as aborted.
  ADD COLUMN IF NOT EXISTS error_code text,

  -- Set when content was blanked by a delete. Distinguishes "the words are
  -- gone" from "the assistant produced no text", which is a real state on the
  -- Stop and budget-exhausted paths.
  ADD COLUMN IF NOT EXISTS redacted_at timestamptz;

-- ── Query runs: which answer owns them, and what to call them ───────────────
ALTER TABLE ai_query_runs
  -- The attribution key. Without it a reopened chat cannot put a result chip
  -- under the answer it belongs to. executeRunStudentReport already receives
  -- this value; it was simply never persisted.
  ADD COLUMN IF NOT EXISTS message_seq integer,

  -- The model's stated intent, denormalised off ai_tool_calls.args_raw.
  -- Reading it back from there is ambiguous: two parallel run_student_report
  -- calls in one round share (conversation_id, message_seq), and nothing
  -- links a tool-call row to the run row it produced.
  ADD COLUMN IF NOT EXISTS purpose text;

-- Two hours is shorter than a school working day, so "open the chat I was on
-- this morning" found every result already expired. A day covers the real
-- unit of work. Anything older goes through the explicit re-run path, which
-- mints a fresh row under a fresh authorization check — the handle stays
-- short-lived, only the window widens.
ALTER TABLE ai_query_runs
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

CREATE INDEX IF NOT EXISTS idx_ai_query_runs_message
  ON ai_query_runs (conversation_id, message_seq)
  WHERE conversation_id IS NOT NULL;

-- ── Backfill: the user never typed this ─────────────────────────────────────
-- Pre-114 user rows were stored with the server's injected context block glued
-- to the front, so the audit trail attributes to the human a sentence the
-- server wrote. Anchored and role-gated so it cannot touch anything else; a
-- question that genuinely began "Current session: ..." is not a real risk, and
-- the replacement is idempotent either way.
UPDATE ai_messages
   SET content = regexp_replace(content, '^Current session: [^\n]*\.\n\n', '')
 WHERE role = 'user'
   AND content LIKE 'Current session: %';

-- ── Room for a fourth surface: the in-app guide ─────────────────────────────
-- ai_conversations.feature is CHECKed to ('ask','remarks','parent'). A global
-- "how do I do this?" assistant is a fourth, and widening the constraint here
-- costs one statement now versus a whole migration later.
--
-- It is a genuinely different surface, not a variant of 'ask': it answers
-- questions about the SOFTWARE, reads no student data at all, and is therefore
-- available to every signed-in user rather than to holders of a data grant.
-- Giving it its own value keeps the two apart in the audit trail and in the
-- chat sidebar, which filters on feature precisely so one surface's history
-- never shows up in another's.
ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_feature_check;
ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_feature_check
  CHECK (feature IN ('ask', 'remarks', 'parent', 'guide'));

-- ── RLS is unchanged ────────────────────────────────────────────────────────
-- Still enabled with zero policies on all four tables. Reading your own chat
-- history goes through an API route on the service-role client that filters by
-- actor_id, NOT through a policy: ai_conversations is shared across features
-- and channels, so "rows where actor_id = auth.uid()" would also hand a
-- teacher their remark-drafting runs and a parent their WhatsApp session.

COMMENT ON TABLE ai_messages IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'CHANGED IN 114: assistant content IS stored, because a chat you cannot '
  'read back is not a chat. This table therefore holds an unstructured '
  'partial copy of student facts — names, counts, and, where the caller '
  'unlocked sensitive columns, quoted contact details. Treat it as student '
  'data for retention, DSAR and breach purposes. Deleting a conversation '
  'NULLs content and stamps redacted_at; the audit skeleton (seq, tokens, '
  'tool calls, query runs) survives, the words do not.';

COMMENT ON TABLE ai_conversations IS
  'RLS enabled with NO policies, intentionally: service-role access only. Any '
  'client credential reads this as empty. Do not add a policy without deciding '
  'what a non-admin should be able to learn about other people''s questions. '
  'Deletion is SOFT (deleted_at): a hard delete would cascade ai_messages and '
  'ai_tool_calls, letting anyone erase the record of what the assistant read '
  'by tidying their chat list.';
