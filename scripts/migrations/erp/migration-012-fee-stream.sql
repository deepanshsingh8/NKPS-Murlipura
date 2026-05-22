-- Migration 012: Stream-aware fee structures
-- Allows differentiating fees across streams (e.g. Science vs Humanities in XI/XII).
-- NULL means the fee applies to every stream in the class.

ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS stream_id uuid REFERENCES streams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fee_structures_stream_id ON fee_structures(stream_id);
