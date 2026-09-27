-- Migration 122 — recompute classes.sort_order for the A–Z section range.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The section picker offered only A, B and C, and sort_order was computed as
--
--     classIndex * 10 + sectionIndex
--
-- A multiplier of 10 only holds while there are fewer than ten sections. XI and
-- XII now want the letter to carry the stream — S for Science, C for Commerce,
-- H for Humanities — so the picker offers all 26, and with 26 the old formula
-- collides: Nursery-Z would score 25 and LKG-A 10, putting Nursery-Z after LKG.
-- The app now multiplies by 100.
--
-- Existing rows still hold the old ×10 values. Left alone they would interleave
-- wrongly with every newly saved class, on the 27 screens that order by this
-- column — every exam screen, the timetable, fees, reports, the roster.
--
-- Two other things this corrects:
--   * Classes created by the fees and results importers were all written with
--     sort_order = 0, so they sorted to the very top in a jumble.
--   * A section outside the known list scored -1, sorting a class BEFORE its
--     own A. Unknowns now sort last instead.
--
-- Nothing in the UI ever sets this column by hand — there is no reorder or drag
-- control anywhere — so recomputing it cannot destroy an arrangement somebody
-- made.
--
-- The two arrays below MUST match CLASS_ORDER and CLASS_SECTIONS in
-- packages/shared/src/lib/constants.ts. They are the same ordering, expressed
-- once for the app and once for this backfill.
--
-- Pure recomputation. SAFE TO RE-RUN.

BEGIN;

SET LOCAL search_path = public;

UPDATE public.classes SET sort_order =
  -- array_position is 1-based; -1 brings it back to the 0-based index the
  -- application uses. 98 is the bounded "unknown" slot, so an unrecognised
  -- name or section sorts last rather than first.
  COALESCE(
    array_position(
      ARRAY['Nursery','LKG','UKG','I','II','III','IV','V',
            'VI','VII','VIII','IX','X','XI','XII'],
      trim(name)
    ) - 1,
    98
  ) * 100
  + COALESCE(
    array_position(
      ARRAY['A','B','C','D','E','F','G','H','I','J','K','L','M',
            'N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
      upper(trim(section))
    ) - 1,
    98
  );

COMMIT;
