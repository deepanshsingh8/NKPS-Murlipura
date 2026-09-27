-- migration-110-school-profile.sql
--
-- The school's own identity, moved out of TypeScript and into the database.
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
-- Filed under base/ rather than erp/ because the public website and the CMS
-- read it too; a website-only deployment still needs the school's name.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
-- Today the school's name, address, phones, affiliation number, leadership
-- and geo coordinates are a hardcoded object in
-- packages/shared/src/lib/constants.ts, and the website assistant's system
-- prompt hardcodes the staff roster on top of that. Two consequences:
--
--   1. The assistant's answers drift from the database every time someone
--      joins or leaves, silently, because nothing links the two.
--   2. A second school means editing TypeScript and redeploying.
--
-- This table fixes both for the surfaces that read it. It is deliberately NOT
-- a multi-tenancy migration: there is no school_id on any other table, and
-- adding one across 77 tables and 260 policies is its own project. What this
-- does is stop new work hardcoding the school, so that project gets smaller
-- rather than larger.
--
-- ── Single row, by construction ─────────────────────────────────────────────
-- `singleton` is a fixed-value column with a unique constraint, so a second
-- row is a database error rather than a support ticket about which row won.
-- When real multi-tenancy arrives, drop the constraint and the column: every
-- reader already goes through getSchoolProfile(), so the shape is ready.
--
-- ── AI columns ──────────────────────────────────────────────────────────────
-- ai_tone and ai_languages steer generated text (report-card remarks, parent
-- replies) per school rather than per deployment. ai_enabled is an off switch
-- a school can hold: it disables every assistant surface without a redeploy,
-- which is what a nervous principal asks for in week one.

CREATE TABLE IF NOT EXISTS school_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly one row. See the note above.
  singleton boolean NOT NULL DEFAULT true,

  -- Identity
  name text NOT NULL,
  short_name text,
  tagline text,
  description text,
  founded_year integer,
  motto text,

  -- Affiliation (CBSE and equivalents)
  board text,
  affiliation_number text,
  school_code text,
  udise_code text,

  -- Contact
  address_line1 text,
  city text,
  state text,
  pin_code text,
  phones text[] NOT NULL DEFAULT '{}',
  emails text[] NOT NULL DEFAULT '{}',
  website_url text,
  office_hours text,

  -- Geo, for transport and map surfaces. Nullable: a school that has not set
  -- a pin should read as "unknown", never as (0, 0) off the coast of Africa.
  latitude numeric(10, 7),
  longitude numeric(10, 7),

  -- Social
  social jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Assistant configuration
  ai_enabled boolean NOT NULL DEFAULT false,
  ai_tone text NOT NULL DEFAULT 'warm',
  ai_languages text[] NOT NULL DEFAULT ARRAY['en'],
  ai_disclaimer text,

  -- WhatsApp Business (Meta Cloud API). Ids, not secrets — the access token
  -- stays in the environment, never in a table an admin screen can read.
  whatsapp_phone_number_id text,
  whatsapp_waba_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT school_profile_singleton_true CHECK (singleton = true),
  CONSTRAINT school_profile_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT school_profile_ai_tone_known CHECK (ai_tone IN ('warm', 'formal', 'neutral')),
  CONSTRAINT school_profile_languages_not_empty CHECK (cardinality(ai_languages) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_profile_one_row
  ON school_profile (singleton);

DROP TRIGGER IF EXISTS set_updated_at_school_profile ON school_profile;
CREATE TRIGGER set_updated_at_school_profile
  BEFORE UPDATE ON school_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Readable by everyone including anonymous visitors: the public website and
-- the visitor-facing assistant both render from this row, and every column
-- here is already published on the school's own website or its CBSE
-- disclosure page. Nothing private belongs in this table — note the WhatsApp
-- access token is deliberately absent.
--
-- Writes are admin-only.
ALTER TABLE school_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read school profile" ON school_profile;
CREATE POLICY "Anyone can read school profile"
  ON school_profile FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage school profile" ON school_profile;
CREATE POLICY "Admins manage school profile"
  ON school_profile FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Murlipura: seeded from THIS repo's packages/shared/src/lib/constants.ts
-- SCHOOL (upstream's seed is the Rajawas campus). Mirrors it so
-- nothing visible changes when readers switch over. ai_enabled stays false:
-- the assistant surfaces are turned on deliberately, not by running a
-- migration.
INSERT INTO school_profile (
  name, short_name, tagline, description, founded_year,
  board, affiliation_number,
  address_line1, city, state, pin_code,
  phones, emails, office_hours,
  latitude, longitude,
  social, ai_enabled, ai_tone, ai_languages
)
SELECT
  'NK Public School, Murlipura',
  'NKPS Murlipura',
  'A Relentless Quest for Excellence',
  'NK Public School Murlipura, the founding campus of the NKPS group, has been nurturing young minds in Jaipur since 1985. We offer holistic education from Nursery to Class XII with Science and Commerce streams at the senior-secondary level.',
  1985,
  'RBSE',
  NULL,
  'Arya Nagar, Murlipura',
  'Jaipur',
  'Rajasthan',
  '302039',
  ARRAY['+91-9785500042', '+91-9785500061'],
  ARRAY['nkpsem@gmail.com', 'nkpsjaipur@gmail.com'],
  'Mon–Sat, 9:00 AM – 3:00 PM',
  26.9774,
  75.7884,
  '{}'::jsonb,
  false,
  'warm',
  ARRAY['en', 'hi']
WHERE NOT EXISTS (SELECT 1 FROM school_profile);
