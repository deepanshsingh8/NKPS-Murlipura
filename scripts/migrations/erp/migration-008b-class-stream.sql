-- Migration 008: Add stream_id to classes table
-- Purpose: For XI/XII classes, stream (Science/Commerce/Humanities) is part of the class definition
-- e.g., XII-A Science, XII-A Commerce, XII-A Arts are separate classes

-- Add stream_id column to classes
alter table classes
  add column if not exists stream_id uuid references streams(id) on delete set null;

-- Drop old unique constraint and create new one that includes stream_id
alter table classes drop constraint if exists classes_name_section_academic_year_id_key;
create unique index if not exists classes_name_section_stream_year_unique
  on classes (name, section, academic_year_id, coalesce(stream_id, '00000000-0000-0000-0000-000000000000'));

-- Index for stream lookups
create index if not exists idx_classes_stream on classes(stream_id);
