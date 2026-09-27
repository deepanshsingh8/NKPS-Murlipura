-- migration-113-whatsapp.sql
--
-- The WhatsApp channel: phone enrolment, sessions, message log, and a rate
-- limiter that survives more than one server process.
--
-- Part of the reserved 110-113 block for the assistant work. See
-- migration-110-school-profile.sql for why this feature does not use
-- sequential numbering.
--
-- ── A phone number is not a session ─────────────────────────────────────────
-- Webhook signature verification authenticates the PROVIDER, not the parent.
-- SIM swaps happen, handsets are shared within a family, numbers get recycled
-- by carriers. So a number is not accepted as identity on sight: it has to be
-- enrolled once, either by a code sent over the existing Exotel channel or
-- from inside the authenticated portal.
--
-- ── Why not just match parents.phone ────────────────────────────────────────
-- Because `ensureParentRecord` writes `opts.phone || ""` into a NOT NULL
-- column, so that table contains empty strings. A normalisation miss that
-- produced '' would match a pile of unrelated parents at once. This uses its
-- own table with an index that cannot contain a blank.

-- ── Enrolled numbers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parent_phone_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,

  -- E.164, always. Normalised by normalizeIndianMobile() before it gets here.
  phone_e164 text NOT NULL,

  verified_at timestamptz,
  revoked_at timestamptz,
  -- How the number came to be trusted, for the audit trail.
  verified_via text CHECK (verified_via IN ('otp', 'portal', 'admin')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT parent_phone_links_e164 CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

-- One live claim per number. Partial so a revoked link does not block a
-- family that legitimately inherits a recycled number later.
CREATE UNIQUE INDEX IF NOT EXISTS parent_phone_links_active
  ON parent_phone_links (phone_e164)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parent_phone_links_parent
  ON parent_phone_links (parent_id) WHERE revoked_at IS NULL;

-- ── Verification codes ──────────────────────────────────────────────────────
-- Codes are stored HASHED. A leaked table should not hand someone a working
-- second factor, and we never need the plaintext back — only to compare.
CREATE TABLE IF NOT EXISTS parent_phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  parent_id uuid REFERENCES parents(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_phone_otps_lookup
  ON parent_phone_otps (phone_e164, created_at DESC);

-- ── Sessions ────────────────────────────────────────────────────────────────
-- A rolling window of trust after enrolment, checked at read. There is no cron
-- anywhere in this repo, so nothing may depend on a sweeper deleting these.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_sessions_active
  ON whatsapp_sessions (phone_e164)
  WHERE revoked_at IS NULL;

-- ── Message log ─────────────────────────────────────────────────────────────
-- No raw phone numbers, following the call_logs precedent: the relationship is
-- what matters operationally, and storing the number again just widens what a
-- leak costs. `phone_last4` is enough for a human to reconcile "was that me?"
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  phone_last4 text,

  wa_message_id text,
  -- Which billing category this message falls in. Service messages became
  -- billable on 2026-10-01, so this is a cost column, not trivia.
  category text CHECK (category IN ('service', 'utility', 'marketing', 'authentication')),
  template_name text,

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_code text,

  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_parent
  ON whatsapp_messages (parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id
  ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ── Rate limiting that actually holds ───────────────────────────────────────
-- The in-memory rateLimit() helper is per-process: on a multi-instance deploy
-- the effective limit is max x instances, and it resets on every deploy. That
-- is fine as politeness on an authenticated screen. It is useless as a control
-- on a public, unauthenticated ingress that costs money per message, so this
-- channel gets a counter the database owns.
CREATE TABLE IF NOT EXISTS ai_rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_rate_limits_window
  ON ai_rate_limits (window_start);

/**
 * Atomically bump a counter and report whether the caller is still under the
 * limit. One statement, so two concurrent messages cannot both read 4 and both
 * write 5.
 */
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_bucket text,
  p_window_seconds integer,
  p_max integer
) RETURNS boolean AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO ai_rate_limits (bucket, window_start, count)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = ai_rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_updated_at_parent_phone_links ON parent_phone_links;
CREATE TRIGGER set_updated_at_parent_phone_links
  BEFORE UPDATE ON parent_phone_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_whatsapp_messages ON whatsapp_messages;
CREATE TRIGGER set_updated_at_whatsapp_messages
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Enabled with NO policies on every table here, intentionally: all five are
-- service-role only. The webhook has no user session at all, and nothing a
-- browser holds should be able to read another family's enrolment or messages.
--
-- The explicit comments matter. An unpolicied table under RLS reads as empty
-- rather than erroring, so without them the next person cannot tell "locked
-- down deliberately" from "someone forgot" — which is how bus_stops came to
-- silently understate transport fees.
ALTER TABLE parent_phone_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_phone_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE parent_phone_links IS
  'RLS enabled with NO policies, intentionally: service-role only.';
COMMENT ON TABLE parent_phone_otps IS
  'RLS enabled with NO policies, intentionally: service-role only. Codes are '
  'stored hashed; the plaintext is never persisted.';
COMMENT ON TABLE whatsapp_sessions IS
  'RLS enabled with NO policies, intentionally: service-role only.';
COMMENT ON TABLE whatsapp_messages IS
  'RLS enabled with NO policies, intentionally: service-role only. Stores '
  'phone_last4 only, never the full number — see call_logs for the precedent.';
COMMENT ON TABLE ai_rate_limits IS
  'RLS enabled with NO policies, intentionally: service-role only.';
