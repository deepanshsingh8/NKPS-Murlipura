-- Migration 036: Clean up the .99-style upper bounds on the default scholastic
-- grade bands seeded by migration 015. With the runtime grade resolver (H12)
-- sorting bands by `min_pct DESC` and picking the first whose `min_pct ≤ pct`,
-- max_pct is informational. Keeping the seed at exact integer thresholds makes
-- band edits in the admin UI predictable.
--
-- Idempotent: only touches rows whose max_pct is still at the original .99
-- value (so admins who manually edited their bands aren't overwritten).
--
-- Plan: bump max_pct of A→B+/B/C/D/F by 0.01 only when the row is still the
-- factory default (label + min_pct + max_pct match exactly). UPDATE … WHERE …
-- guards make this re-runnable.

UPDATE grade_bands SET max_pct = 90.00
  WHERE label = 'A'  AND min_pct = 80.00 AND max_pct = 89.99;
UPDATE grade_bands SET max_pct = 80.00
  WHERE label = 'B+' AND min_pct = 70.00 AND max_pct = 79.99;
UPDATE grade_bands SET max_pct = 70.00
  WHERE label = 'B'  AND min_pct = 60.00 AND max_pct = 69.99;
UPDATE grade_bands SET max_pct = 60.00
  WHERE label = 'C'  AND min_pct = 50.00 AND max_pct = 59.99;
UPDATE grade_bands SET max_pct = 50.00
  WHERE label = 'D'  AND min_pct = 40.00 AND max_pct = 49.99;
UPDATE grade_bands SET max_pct = 40.00
  WHERE label = 'F'  AND min_pct =  0.00 AND max_pct = 39.99;
