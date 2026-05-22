-- Migration 006: Streams, Stream-Subject mappings, and Student-Subject linking
-- Purpose: Add academic stream support for higher classes (XI/XII) and smart
-- student-teacher assignment via resolved student_subjects table.

-- =============================================================
-- 1. Streams (Science, Commerce, Humanities)
-- =============================================================
create table if not exists streams (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  code text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

alter table streams enable row level security;

create policy "Public can read streams"
  on streams for select using (true);

create policy "Admins can insert streams"
  on streams for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update streams"
  on streams for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete streams"
  on streams for delete
  using (public.get_user_role() = 'admin');

-- =============================================================
-- 2. Stream Subjects (which subjects belong to which stream)
-- =============================================================
create table if not exists stream_subjects (
  id uuid default gen_random_uuid() primary key,
  stream_id uuid references streams(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete cascade not null,
  is_mandatory boolean default true,
  sort_order integer default 0,
  unique(stream_id, subject_id)
);

alter table stream_subjects enable row level security;

create policy "Public can read stream_subjects"
  on stream_subjects for select using (true);

create policy "Admins can insert stream_subjects"
  on stream_subjects for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update stream_subjects"
  on stream_subjects for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete stream_subjects"
  on stream_subjects for delete
  using (public.get_user_role() = 'admin');

-- =============================================================
-- 3. Student Subjects (resolved student-to-class_subject link)
-- References class_subjects(id) so teacher changes auto-propagate.
-- =============================================================
create table if not exists student_subjects (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  class_subject_id uuid references class_subjects(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(student_id, class_subject_id)
);

alter table student_subjects enable row level security;

create policy "Public can read student_subjects"
  on student_subjects for select using (true);

create policy "Admins can insert student_subjects"
  on student_subjects for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update student_subjects"
  on student_subjects for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete student_subjects"
  on student_subjects for delete
  using (public.get_user_role() = 'admin');

create policy "Teachers can read student_subjects for their classes"
  on student_subjects for select
  using (
    public.get_user_role() = 'teacher'
    and class_subject_id in (
      select id from class_subjects where teacher_id = auth.uid()
    )
  );

-- =============================================================
-- 4. Column additions
-- =============================================================

-- Stream assignment on student enrollment (nullable for lower classes)
alter table student_enrollments
  add column if not exists stream_id uuid references streams(id) on delete set null;

-- Mark subjects as elective-type
alter table subjects
  add column if not exists is_elective boolean default false;

-- =============================================================
-- 5. Indexes
-- =============================================================
create index if not exists idx_stream_subjects_stream on stream_subjects(stream_id);
create index if not exists idx_stream_subjects_subject on stream_subjects(subject_id);
create index if not exists idx_student_subjects_student on student_subjects(student_id);
create index if not exists idx_student_subjects_class_subject on student_subjects(class_subject_id);
create index if not exists idx_student_enrollments_stream on student_enrollments(stream_id);

-- =============================================================
-- 6. Seed default streams
-- =============================================================
insert into streams (name, code, sort_order) values
  ('Science', 'SCI', 1),
  ('Commerce', 'COM', 2),
  ('Humanities', 'HUM', 3)
on conflict do nothing;
