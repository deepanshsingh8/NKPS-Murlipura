-- _enable-ai-assistant.sql
--
-- Run AFTER _apply-ai-feature-migrations.sql. Turns the assistant on.
--
-- This is a separate file on purpose. The migrations are structural and safe
-- to apply at any time; this one changes behaviour for real users, so it
-- should be a decision someone makes rather than a side effect of migrating.
--
-- Until this runs, every AI route returns 503 AI_DISABLED. That is also the
-- off switch: set it back to false to make the whole feature dark immediately,
-- without a redeploy.

UPDATE school_profile SET ai_enabled = true;

-- Optional: the assistant's tone in generated text (report-card remarks, parent
-- replies). 'warm' is the default; 'formal' or 'neutral' also valid.
-- UPDATE school_profile SET ai_tone = 'warm';

-- Optional: drop 'hi' if you want English-only replies to parents.
-- UPDATE school_profile SET ai_languages = ARRAY['en','hi'];

SELECT
  name,
  ai_enabled,
  ai_tone,
  ai_languages,
  CASE WHEN ai_enabled THEN 'Assistant is LIVE' ELSE 'Assistant is off' END AS status
FROM school_profile;
