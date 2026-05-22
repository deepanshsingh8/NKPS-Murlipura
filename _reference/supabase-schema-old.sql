-- NK Public School - Supabase Database Schema
-- Run this in the Supabase SQL Editor to set up your database

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Gallery Images table
create table if not exists gallery_images (
  id uuid default uuid_generate_v4() primary key,
  src text not null,
  alt text not null,
  category text not null check (category in ('academics', 'sports', 'cultural', 'campus', 'events')),
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Transfer Certificates table
create table if not exists transfer_certificates (
  id uuid default uuid_generate_v4() primary key,
  student_name text not null,
  file_url text not null,
  academic_year text not null,
  upload_date date default current_date,
  created_at timestamptz default now()
);

-- Contact Submissions table
create table if not exists contact_submissions (
  id uuid default uuid_generate_v4() primary key,
  full_name text not null,
  email text not null,
  phone text not null,
  subject text not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- Row Level Security Policies

-- Gallery: public read, authenticated write
alter table gallery_images enable row level security;

create policy "Public can view gallery images"
  on gallery_images for select
  using (true);

create policy "Authenticated users can insert gallery images"
  on gallery_images for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can update gallery images"
  on gallery_images for update
  using (auth.role() = 'authenticated');

create policy "Authenticated users can delete gallery images"
  on gallery_images for delete
  using (auth.role() = 'authenticated');

-- Transfer Certificates: public read, authenticated write
alter table transfer_certificates enable row level security;

create policy "Public can view transfer certificates"
  on transfer_certificates for select
  using (true);

create policy "Authenticated users can insert transfer certificates"
  on transfer_certificates for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can delete transfer certificates"
  on transfer_certificates for delete
  using (auth.role() = 'authenticated');

-- Contact Submissions: authenticated read/write (submitted via service role key)
alter table contact_submissions enable row level security;

create policy "Authenticated users can view contact submissions"
  on contact_submissions for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can update contact submissions"
  on contact_submissions for update
  using (auth.role() = 'authenticated');

create policy "Service role can insert contact submissions"
  on contact_submissions for insert
  with check (true);

-- Storage Buckets
-- Note: Create these in the Supabase Dashboard > Storage:
-- 1. Bucket: "gallery" (Public)
-- 2. Bucket: "transfer-certificates" (Public)
-- 3. Bucket: "avatars" (Public)
--
-- Storage Policies (set in Dashboard > Storage > Policies):
-- gallery bucket:
--   - SELECT: Allow public access
--   - INSERT: Allow authenticated users
--   - DELETE: Allow authenticated users
--
-- transfer-certificates bucket:
--   - SELECT: Allow public access
--   - INSERT: Allow authenticated users
--   - DELETE: Allow authenticated users
--
-- avatars bucket:
--   - SELECT: Allow public access
--   - INSERT/UPDATE/DELETE: Managed via service role (API route)

-- =============================================================
-- ERP System Tables
-- =============================================================

-- 1. Profiles
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  role text not null default 'student' check (role in ('admin', 'editor', 'teacher', 'student')),
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  is_active boolean default true,
  student_id uuid references students(id) on delete set null, -- links auth user to students record
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Helper: current user's role (defined after profiles exists; used by RLS policies below)
create or replace function public.get_user_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Academic Years
create table if not exists academic_years (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_current boolean default false,
  created_at timestamptz default now()
);

-- 3. Classes
create table if not exists classes (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  section text not null,
  academic_year_id uuid references academic_years(id) not null,
  class_teacher_id uuid references profiles(id),
  sort_order integer default 0,
  unique(name, section, academic_year_id)
);

-- 4. Subjects
create table if not exists subjects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  code text,
  is_active boolean default true,
  is_elective boolean default false,
  created_at timestamptz default now()
);

-- 5. Class Subjects (join table)
create table if not exists class_subjects (
  id uuid default gen_random_uuid() primary key,
  class_id uuid references classes(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete cascade not null,
  teacher_id uuid references profiles(id),
  unique(class_id, subject_id)
);

-- 6. Student Enrollments
-- NOTE: student_id references students(id), NOT profiles(id)
-- See migration-001-student-fk.sql for the FK switch
create table if not exists student_enrollments (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  class_id uuid references classes(id) on delete cascade not null,
  stream_id uuid references streams(id) on delete set null,
  roll_number integer,
  enrollment_date date default current_date,
  status text not null default 'active' check (status in ('active', 'passed', 'failed', 'terminated', 'exited')),
  unique(student_id, class_id)
);

-- 7. Attendance
create table if not exists attendance (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  class_id uuid references classes(id) on delete cascade not null,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'holiday')),
  marked_by uuid references profiles(id) not null,
  remarks text,
  created_at timestamptz default now(),
  unique(student_id, class_id, date)
);

-- 8. Exam Types
create table if not exists exam_types (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  academic_year_id uuid references academic_years(id) not null,
  max_marks integer not null default 100,
  weightage numeric(5,2),
  sort_order integer default 0,
  unique(name, academic_year_id)
);

-- 9. Results
create table if not exists results (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  class_id uuid references classes(id) on delete cascade not null,
  subject_id uuid references subjects(id) on delete cascade not null,
  exam_type_id uuid references exam_types(id) on delete cascade not null,
  marks_obtained numeric(5,2) not null,
  max_marks numeric(5,2) not null default 100,
  grade text,
  remarks text,
  entered_by uuid references profiles(id) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(student_id, subject_id, exam_type_id)
);

-- 10. Fee Structures
create table if not exists fee_structures (
  id uuid default gen_random_uuid() primary key,
  academic_year_id uuid references academic_years(id) not null,
  class_name text not null,
  fee_type text not null,
  amount numeric(10,2) not null,
  due_date date,
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annual', 'one_time')),
  created_at timestamptz default now()
);

-- 11. Fee Payments
create table if not exists fee_payments (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade not null,
  fee_structure_id uuid references fee_structures(id) not null,
  amount_paid numeric(10,2) not null,
  payment_date date default current_date,
  payment_method text check (payment_method in ('cash', 'online', 'cheque', 'bank_transfer')),
  receipt_number text unique,
  month text,
  status text not null default 'paid' check (status in ('paid', 'partial', 'pending', 'refunded')),
  recorded_by uuid references profiles(id) not null,
  remarks text,
  created_at timestamptz default now()
);

-- 12. Timetable Periods
create table if not exists timetable_periods (
  id uuid default gen_random_uuid() primary key,
  class_id uuid references classes(id) on delete cascade not null,
  subject_id uuid references subjects(id),
  teacher_id uuid references profiles(id),
  day_of_week integer not null check (day_of_week between 0 and 6),
  period_number integer not null,
  start_time time not null,
  end_time time not null,
  room text,
  unique(class_id, day_of_week, period_number)
);

-- 13. Calendar Events
create table if not exists calendar_events (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  event_type text not null check (event_type in ('exam', 'holiday', 'event', 'pta_meeting', 'other')),
  start_date date not null,
  end_date date,
  class_id uuid references classes(id),
  created_by uuid references profiles(id) not null,
  created_at timestamptz default now()
);

-- =============================================================
-- ERP Row Level Security
-- =============================================================

-- Profiles
alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Admins can read all profiles"
  on profiles for select
  using (public.get_user_role() = 'admin');

create policy "Teachers can read student profiles in their classes"
  on profiles for select
  using (
    public.get_user_role() = 'teacher'
    and (
      role = 'student'
      and id in (
        select se.student_id from student_enrollments se
        join classes c on c.id = se.class_id
        where c.class_teacher_id = auth.uid()
      )
    )
  );

create policy "Users can update own profile"
  on profiles for update
  using (id = auth.uid());

create policy "Admins can insert profiles"
  on profiles for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update any profile"
  on profiles for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete profiles"
  on profiles for delete
  using (public.get_user_role() = 'admin');

-- Academic Years
alter table academic_years enable row level security;

create policy "Public can read academic years"
  on academic_years for select
  using (true);

create policy "Admins can insert academic years"
  on academic_years for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update academic years"
  on academic_years for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete academic years"
  on academic_years for delete
  using (public.get_user_role() = 'admin');

-- Classes
alter table classes enable row level security;

create policy "Public can read classes"
  on classes for select
  using (true);

create policy "Admins can insert classes"
  on classes for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update classes"
  on classes for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete classes"
  on classes for delete
  using (public.get_user_role() = 'admin');

-- Subjects
alter table subjects enable row level security;

create policy "Public can read subjects"
  on subjects for select
  using (true);

create policy "Admins can insert subjects"
  on subjects for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update subjects"
  on subjects for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete subjects"
  on subjects for delete
  using (public.get_user_role() = 'admin');

-- Class Subjects
alter table class_subjects enable row level security;

create policy "Public can read class subjects"
  on class_subjects for select
  using (true);

create policy "Admins can insert class subjects"
  on class_subjects for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update class subjects"
  on class_subjects for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete class subjects"
  on class_subjects for delete
  using (public.get_user_role() = 'admin');

-- Student Enrollments
alter table student_enrollments enable row level security;

create policy "Students can read own enrollment"
  on student_enrollments for select
  using (student_id = auth.uid());

create policy "Teachers can read enrollments for their classes"
  on student_enrollments for select
  using (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
      union
      select class_id from class_subjects where teacher_id = auth.uid()
    )
  );

create policy "Admins can read all enrollments"
  on student_enrollments for select
  using (public.get_user_role() = 'admin');

create policy "Admins can insert enrollments"
  on student_enrollments for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update enrollments"
  on student_enrollments for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete enrollments"
  on student_enrollments for delete
  using (public.get_user_role() = 'admin');

-- Attendance
alter table attendance enable row level security;

create policy "Students can read own attendance"
  on attendance for select
  using (student_id = auth.uid());

create policy "Teachers can read attendance for their classes"
  on attendance for select
  using (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
  );

create policy "Teachers can insert attendance for their classes"
  on attendance for insert
  with check (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
  );

create policy "Teachers can update attendance for their classes"
  on attendance for update
  using (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
  );

create policy "Admins have full access to attendance"
  on attendance for all
  using (public.get_user_role() = 'admin');

-- Exam Types
alter table exam_types enable row level security;

create policy "Public can read exam types"
  on exam_types for select
  using (true);

create policy "Admins can insert exam types"
  on exam_types for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update exam types"
  on exam_types for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete exam types"
  on exam_types for delete
  using (public.get_user_role() = 'admin');

-- Results
alter table results enable row level security;

create policy "Students can read own results"
  on results for select
  using (student_id = auth.uid());

create policy "Teachers can read results for their class/subject"
  on results for select
  using (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
  );

create policy "Teachers can insert results for their class/subject"
  on results for insert
  with check (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
    and subject_id in (
      select subject_id from class_subjects where teacher_id = auth.uid()
    )
  );

create policy "Teachers can update results for their class/subject"
  on results for update
  using (
    public.get_user_role() = 'teacher'
    and class_id in (
      select id from classes where class_teacher_id = auth.uid()
    )
    and subject_id in (
      select subject_id from class_subjects where teacher_id = auth.uid()
    )
  );

create policy "Admins have full access to results"
  on results for all
  using (public.get_user_role() = 'admin');

-- Fee Structures
alter table fee_structures enable row level security;

create policy "Public can read fee structures"
  on fee_structures for select
  using (true);

create policy "Admins can insert fee structures"
  on fee_structures for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update fee structures"
  on fee_structures for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete fee structures"
  on fee_structures for delete
  using (public.get_user_role() = 'admin');

-- Fee Payments
alter table fee_payments enable row level security;

create policy "Students can read own fee payments"
  on fee_payments for select
  using (student_id = auth.uid());

create policy "Admins have full access to fee payments"
  on fee_payments for all
  using (public.get_user_role() = 'admin');

-- Timetable Periods
alter table timetable_periods enable row level security;

create policy "Public can read timetable periods"
  on timetable_periods for select
  using (true);

create policy "Admins can insert timetable periods"
  on timetable_periods for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update timetable periods"
  on timetable_periods for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete timetable periods"
  on timetable_periods for delete
  using (public.get_user_role() = 'admin');

-- Calendar Events
alter table calendar_events enable row level security;

create policy "Public can read calendar events"
  on calendar_events for select
  using (true);

create policy "Admins can insert calendar events"
  on calendar_events for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update calendar events"
  on calendar_events for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete calendar events"
  on calendar_events for delete
  using (public.get_user_role() = 'admin');

-- =============================================================
-- Site Media Management (admin-managed website images)
-- =============================================================

create table if not exists site_media (
  id uuid default uuid_generate_v4() primary key,
  slot text not null unique,
  page text not null,
  section text not null,
  label text not null,
  current_url text not null,
  default_url text not null,
  alt_text text not null default '',
  sort_order integer default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table site_media enable row level security;

create policy "Public can read site_media"
  on site_media for select
  using (true);

create policy "Authenticated users can update site_media"
  on site_media for update
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert site_media"
  on site_media for insert
  with check (auth.role() = 'authenticated');

-- Storage Bucket: "site-media" (Public)
-- Policies:
--   - SELECT: Allow public access
--   - INSERT: Allow authenticated users
--   - DELETE: Allow authenticated users

-- =============================================================
-- Section Cards (dynamic content cards for website sections)
-- =============================================================

create table if not exists section_cards (
  id uuid default uuid_generate_v4() primary key,
  section text not null check (section in ('hero_slider', 'testimonials', 'latest_updates', 'facilities_preview', 'leadership', 'legacy_timeline', 'why_choose_us', 'activities', 'annual_events', 'campus_facilities')),
  title text,
  subtitle text,
  description text,
  quote text,
  name text,
  role text,
  initials text,
  date text,
  cta_text text,
  cta_link text,
  icon text,
  link text,
  image_url text,
  designation text,
  message text,
  year text,
  season text,
  sort_order integer default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table section_cards enable row level security;

create policy "Public can read section_cards"
  on section_cards for select
  using (true);

create policy "Authenticated users can insert section_cards"
  on section_cards for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can update section_cards"
  on section_cards for update
  using (auth.role() = 'authenticated');

create policy "Authenticated users can delete section_cards"
  on section_cards for delete
  using (auth.role() = 'authenticated');

-- =============================================================
-- Students Table (standalone student records, no auth required)
-- =============================================================

create table if not exists students (
  id uuid default gen_random_uuid() primary key,
  admission_no text not null unique,
  full_name text not null,
  father_name text,
  mother_name text,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'other')),
  address text,
  phone text,
  email text,
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  category text,
  aadhar_number text,
  previous_school text,
  admission_date date default current_date,
  is_active boolean default true,
  is_alumni boolean default false,
  alumni_passing_year text,
  alumni_academic_year_id uuid references academic_years(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table students enable row level security;

create policy "Admins can read all students"
  on students for select
  using (public.get_user_role() = 'admin');

create policy "Teachers can read students in their classes"
  on students for select
  using (
    public.get_user_role() = 'teacher'
    and id in (
      select se.student_id from student_enrollments se
      join classes c on c.id = se.class_id
      where c.class_teacher_id = auth.uid()
    )
  );

create policy "Admins can insert students"
  on students for insert
  with check (public.get_user_role() = 'admin');

create policy "Admins can update students"
  on students for update
  using (public.get_user_role() = 'admin');

create policy "Admins can delete students"
  on students for delete
  using (public.get_user_role() = 'admin');

-- =============================================================
-- FK Migration: student_enrollments, attendance, results, fee_payments
-- All now reference students(id) instead of profiles(id).
-- See scripts/migration-001-student-fk.sql for the migration to run
-- on existing databases.
-- =============================================================

-- =============================================================
-- Registration Requests (self-registration with admin approval)
-- =============================================================

create table if not exists registration_requests (
  id uuid default gen_random_uuid() primary key,
  full_name text not null,
  email text not null,
  phone text,
  role text not null check (role in ('teacher', 'student')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- =============================================================
-- Mandatory Public Disclosure
-- =============================================================

-- 1. Disclosure Items (text key-value fields for sections A, C-text, D, E)
create table if not exists disclosure_items (
  id uuid default uuid_generate_v4() primary key,
  section text not null check (section in ('general', 'result_academics', 'staff', 'infrastructure')),
  field_key text not null unique,
  label text not null,
  value text not null default '',
  sort_order integer default 0,
  updated_at timestamptz default now()
);

alter table disclosure_items enable row level security;

create policy "Public can read disclosure_items"
  on disclosure_items for select using (true);

create policy "Authenticated users can update disclosure_items"
  on disclosure_items for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert disclosure_items"
  on disclosure_items for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can delete disclosure_items"
  on disclosure_items for delete using (auth.role() = 'authenticated');

-- 2. Disclosure Documents (section B — uploadable PDFs)
create table if not exists disclosure_documents (
  id uuid default uuid_generate_v4() primary key,
  doc_key text not null unique,
  label text not null,
  file_url text,
  file_name text,
  sort_order integer default 0,
  updated_at timestamptz default now()
);

alter table disclosure_documents enable row level security;

create policy "Public can read disclosure_documents"
  on disclosure_documents for select using (true);

create policy "Authenticated users can update disclosure_documents"
  on disclosure_documents for update using (auth.role() = 'authenticated');

create policy "Authenticated users can insert disclosure_documents"
  on disclosure_documents for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can delete disclosure_documents"
  on disclosure_documents for delete using (auth.role() = 'authenticated');

-- 3. Disclosure Board Results (section C — structured board exam data)
create table if not exists disclosure_board_results (
  id uuid default uuid_generate_v4() primary key,
  exam_class text not null check (exam_class in ('X', 'XII')),
  academic_year text not null,
  registered integer not null default 0,
  passed integer not null default 0,
  pass_percentage numeric(5,2) not null default 0,
  remarks text,
  sort_order integer default 0,
  updated_at timestamptz default now(),
  unique(exam_class, academic_year)
);

alter table disclosure_board_results enable row level security;

create policy "Public can read disclosure_board_results"
  on disclosure_board_results for select using (true);

create policy "Authenticated users can insert disclosure_board_results"
  on disclosure_board_results for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update disclosure_board_results"
  on disclosure_board_results for update using (auth.role() = 'authenticated');

create policy "Authenticated users can delete disclosure_board_results"
  on disclosure_board_results for delete using (auth.role() = 'authenticated');

-- Seed: Section A — General Information
insert into disclosure_items (section, field_key, label, value, sort_order) values
  ('general', 'school_name', 'Name of the School', 'NK Public School', 0),
  ('general', 'affiliation_no', 'Affiliation No.', '1730446', 1),
  ('general', 'school_code', 'School Code', '14399', 2),
  ('general', 'address', 'Complete Address with Pin Code', 'Grand Sikar Road, Rajawas, Jaipur, Rajasthan – 302013', 3),
  ('general', 'principal_name', 'Principal Name & Qualification', 'Mrs. Prema Kavia', 4),
  ('general', 'school_email', 'School Email ID', 'nkps.rajawas@gmail.com', 5),
  ('general', 'contact_details', 'Contact Details (Landline/Mobile)', '+91-9785500046, +91-9785500048', 6)
on conflict (field_key) do nothing;

-- Seed: Section C — Result & Academics (text fields)
insert into disclosure_items (section, field_key, label, value, sort_order) values
  ('result_academics', 'fee_structure', 'Fee Structure of the School', '', 0),
  ('result_academics', 'academic_calendar', 'Annual Academic Calendar', '', 1),
  ('result_academics', 'smc_list', 'List of School Management Committee (SMC)', '', 2),
  ('result_academics', 'pta_members', 'List of Parents Teachers Association (PTA) Members', '', 3)
on conflict (field_key) do nothing;

-- Seed: Section D — Staff (Teaching)
insert into disclosure_items (section, field_key, label, value, sort_order) values
  ('staff', 'principal', 'Principal', 'Mrs. Prema Kavia', 0),
  ('staff', 'total_teachers', 'Total No. of Teachers (PGT / TGT / PRT)', '100+ (PGT: 25+, TGT: 35+, PRT: 40+)', 1),
  ('staff', 'teacher_section_ratio', 'Teacher-Section Ratio', '1:1.5', 2),
  ('staff', 'special_educator', 'Details of Special Educator', '', 3),
  ('staff', 'counsellor', 'Details of Counsellor and Wellness Teacher', '', 4)
on conflict (field_key) do nothing;

-- Seed: Section E — School Infrastructure
insert into disclosure_items (section, field_key, label, value, sort_order) values
  ('infrastructure', 'campus_area', 'Total Campus Area (in sq. mtrs.)', '20,000 sq. mtrs.', 0),
  ('infrastructure', 'classrooms', 'Number and Size of Classrooms', '60+ Classrooms', 1),
  ('infrastructure', 'labs', 'Number and Size of Laboratories (incl. Computer Labs)', '5 Labs (Physics, Chemistry, Biology, Computer, Math)', 2),
  ('infrastructure', 'internet', 'Internet Facility', 'Yes', 3),
  ('infrastructure', 'girls_toilets', 'Number of Girls'' Toilets', '', 4),
  ('infrastructure', 'boys_toilets', 'Number of Boys'' Toilets', '', 5),
  ('infrastructure', 'youtube_link', 'Link of YouTube Video of School Inspection', '', 6)
on conflict (field_key) do nothing;

-- Seed: Section B — Documents
insert into disclosure_documents (doc_key, label, sort_order) values
  ('affiliation_letter', 'Copies of Affiliation/Upgradation Letter and Recent Extension of Affiliation', 0),
  ('society_registration', 'Copies of Societies/Trust/Company Registration/Renewal Certificate', 1),
  ('noc', 'Copy of No Objection Certificate (NOC) Issued by the State Govt/UT', 2),
  ('rte_recognition', 'Copy of Recognition Certificate under RTE Act, 2009, and Its Renewal', 3),
  ('building_safety', 'Copy of Valid Building Safety Certificate (as per National Building Code)', 4),
  ('fire_safety', 'Copy of Valid Fire Safety Certificate Issued by the Competent Authority', 5),
  ('deo_certificate', 'Copy of DEO Certificate Submitted for Affiliation/Self-Certification by School', 6),
  ('water_health_sanitation', 'Copy of Valid Water, Health and Sanitation Certificates', 7)
on conflict (doc_key) do nothing;

-- Storage Bucket: "disclosure-documents" (Public)
-- Create in Supabase Dashboard > Storage
-- Policies:
--   - SELECT: Allow public access
--   - INSERT: Allow authenticated users
--   - DELETE: Allow authenticated users

-- Allow only one pending registration per email (rejected users can re-register)
create unique index idx_registration_requests_pending_email
  on registration_requests(email) where status = 'pending';

-- Index for admin queries
create index idx_registration_requests_status
  on registration_requests(status, created_at desc);

alter table registration_requests enable row level security;

-- Anyone can submit a registration (public insert)
create policy "Anyone can submit registration"
  on registration_requests for insert
  with check (true);

-- Only admins can read registrations
create policy "Admins can read all registrations"
  on registration_requests for select
  using (public.get_user_role() = 'admin');

-- Only admins can update registrations (approve/reject)
create policy "Admins can update registrations"
  on registration_requests for update
  using (public.get_user_role() = 'admin');

-- Only admins can delete registrations
create policy "Admins can delete registrations"
  on registration_requests for delete
  using (public.get_user_role() = 'admin');

-- =============================================================
-- Streams (academic streams for XI/XII: Science, Commerce, Humanities)
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
-- Stream Subjects (which subjects belong to which stream)
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
-- Student Subjects (resolved student-to-class_subject link)
-- References class_subjects(id) so teacher changes auto-propagate
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
-- Staff Members (website faculty + non-teaching staff)
-- =============================================================

create table if not exists staff_members (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  subject text not null,
  category text not null check (category in ('management', 'admin', 'pgt', 'tgt', 'prt', 'motherTeachers', 'additionalStaff', 'busDriver', 'peon')),
  photo_url text,
  email text,
  phone text,
  date_of_birth date,
  address text,
  qualifications text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table staff_members enable row level security;

create policy "Public can view staff members"
  on staff_members for select
  using (true);

create policy "Authenticated users can insert staff members"
  on staff_members for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can update staff members"
  on staff_members for update
  using (auth.role() = 'authenticated');

create policy "Authenticated users can delete staff members"
  on staff_members for delete
  using (auth.role() = 'authenticated');

-- Storage Bucket: "staff-photos" (Public)
-- Create in Supabase Dashboard > Storage
-- Policies:
--   - SELECT: Allow public access
--   - INSERT: Allow authenticated users
--   - UPDATE: Allow authenticated users
--   - DELETE: Allow authenticated users
