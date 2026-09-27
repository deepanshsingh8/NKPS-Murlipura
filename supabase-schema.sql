-- =============================================================================
-- NK Public School — Complete Database Schema v2 (ERP + CMS)
-- Run this in the Supabase SQL Editor on a FRESH project to set up everything.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CMS Tables (copied verbatim from the legacy schema)
-- ─────────────────────────────────────────────────────────────────────────────

-- Gallery Images
CREATE TABLE IF NOT EXISTS gallery_images (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  src text NOT NULL,
  alt text NOT NULL,
  category text NOT NULL CHECK (category IN ('academics', 'sports', 'cultural', 'campus', 'events')),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Transfer Certificates
CREATE TABLE IF NOT EXISTS transfer_certificates (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  student_name text NOT NULL,
  admission_no text,
  student_dob date,
  file_url text NOT NULL,
  academic_year text NOT NULL,
  upload_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now(),
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  tc_number text,
  issue_date date,
  last_attended_date date,
  reason_for_leaving text,
  conduct text,
  class_last_attended text,
  remarks text,
  is_generated boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tc_admission_no ON transfer_certificates(admission_no);
CREATE INDEX IF NOT EXISTS idx_tc_student_name ON transfer_certificates(student_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_tc_number ON transfer_certificates(tc_number) WHERE tc_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_student_id ON transfer_certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_tc_admission_dob
  ON transfer_certificates(admission_no, student_dob)
  WHERE student_dob IS NOT NULL AND admission_no IS NOT NULL;

-- Contact Submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Site Media
CREATE TABLE IF NOT EXISTS site_media (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  slot text NOT NULL UNIQUE,
  page text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  current_url text NOT NULL,
  default_url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Section Cards
CREATE TABLE IF NOT EXISTS section_cards (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  section text NOT NULL CHECK (section IN ('hero_slider', 'testimonials', 'facilities_preview', 'leadership', 'legacy_timeline', 'why_choose_us', 'activities', 'annual_events', 'campus_facilities', 'accolades', 'alumni', 'student_achievements', 'sports_indoor', 'sports_outdoor')),
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
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  default_snapshot jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS section_cards_section_active_idx
  ON section_cards (section)
  WHERE is_active = true;

-- Staff Members (website faculty + non-teaching staff)
CREATE TABLE IF NOT EXISTS staff_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  subject text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'management', 'admin', 'pgt', 'tgt', 'prt',
    'motherTeachers', 'prePrimaryCoordinator', 'primaryCoordinator',
    'middleCoordinator', 'seniorCoordinator',
    'additionalStaff', 'busDriver', 'peon'
  )),
  photo_url text,
  email text,
  phone text,
  date_of_birth date,
  address text,
  qualifications text,
  license_number text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(name, category)
);

-- Disclosure Items (text key-value for sections A, C-text, D, E)
CREATE TABLE IF NOT EXISTS disclosure_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  section text NOT NULL CHECK (section IN ('general', 'result_academics', 'staff', 'infrastructure')),
  field_key text NOT NULL UNIQUE,
  label text NOT NULL,
  value text NOT NULL DEFAULT '',
  sort_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Disclosure Documents (section B — uploadable PDFs)
CREATE TABLE IF NOT EXISTS disclosure_documents (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  doc_key text NOT NULL UNIQUE,
  label text NOT NULL,
  file_url text,
  file_name text,
  sort_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- Disclosure Board Results (section C — structured board exam data)
CREATE TABLE IF NOT EXISTS disclosure_board_results (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  exam_class text NOT NULL CHECK (exam_class IN ('X', 'XII')),
  academic_year text NOT NULL,
  registered integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  pass_percentage numeric(5,2) NOT NULL DEFAULT 0,
  remarks text,
  sort_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(exam_class, academic_year)
);

-- Gallery Events (event-based photo categorization)
CREATE TABLE IF NOT EXISTS gallery_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  academic_year text,
  cover_image_url text,
  is_public boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add gallery_event_id FK on gallery_images (nullable; existing images won't be linked)
ALTER TABLE gallery_images
  ADD COLUMN IF NOT EXISTS gallery_event_id uuid REFERENCES gallery_events(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ERP Tables (in FK-dependency order)
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Academic Years (referenced by many tables)
CREATE TABLE academic_years (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_current boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 2b. Streams
CREATE TABLE streams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2c. Teachers (must exist before profiles and classes)
CREATE TABLE teachers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text,
  phone text,
  date_of_joining date,
  date_of_birth date,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  qualifications text,
  specialization text,
  address text,
  aadhar_number text,
  photo_url text,
  is_active boolean DEFAULT true,
  staff_member_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2d. Students
CREATE TABLE students (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admission_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  father_name text,
  mother_name text,
  date_of_birth date,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  address text,
  phone text,
  email text,
  blood_group text CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  category text,
  aadhar_number text,
  religion text,
  nationality text DEFAULT 'Indian',
  photo_url text,
  previous_school text,
  admission_date date DEFAULT CURRENT_DATE,
  admission_class text,
  is_active boolean DEFAULT true,
  is_alumni boolean DEFAULT false,
  alumni_passing_year text,
  alumni_academic_year_id uuid REFERENCES academic_years(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2e. Parents
CREATE TABLE parents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text UNIQUE,
  phone text NOT NULL,
  alternate_phone text,
  occupation text,
  address text,
  relationship text NOT NULL DEFAULT 'father'
    CHECK (relationship IN ('father', 'mother', 'guardian')),
  aadhar_number text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2f. Profiles (auth-user linking — references teachers, students, parents)
CREATE TABLE profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role text NOT NULL DEFAULT 'student'
    CHECK (role IN ('admin', 'staff', 'teacher', 'student', 'parent')),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  avatar_url text,
  is_active boolean DEFAULT true,
  must_change_password boolean DEFAULT false,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2g. Subjects
CREATE TABLE subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text,
  nickname text,
  category text CHECK (category IN ('languages', 'academic', 'co_curricular')),
  is_active boolean DEFAULT true,
  is_elective boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subjects_category ON subjects(category);

-- 2h. Classes (references academic_years, teachers, streams)
CREATE TABLE classes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  section text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) NOT NULL,
  class_teacher_id uuid REFERENCES teachers(id),
  stream_id uuid REFERENCES streams(id) ON DELETE SET NULL,
  sort_order integer DEFAULT 0,
  room text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX classes_name_section_stream_year_unique
  ON classes (name, section, academic_year_id, COALESCE(stream_id, '00000000-0000-0000-0000-000000000000'));

-- 2i. Stream Subjects
-- requirement_type is the authoritative compulsory/elective tag per stream;
-- is_mandatory is preserved as legacy mirror (true ↔ 'compulsory').
CREATE TABLE stream_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id uuid REFERENCES streams(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  is_mandatory boolean DEFAULT true,
  requirement_type text CHECK (requirement_type IN ('compulsory', 'elective')),
  sort_order integer DEFAULT 0,
  UNIQUE(stream_id, subject_id)
);

-- 2j. Class Subjects
CREATE TABLE class_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  teacher_id uuid REFERENCES teachers(id),
  UNIQUE(class_id, subject_id)
);

-- 2k. Student Subjects (resolved student ↔ class_subject link; references
-- class_subjects so teacher reassignments auto-propagate to students).
CREATE TABLE IF NOT EXISTS student_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  class_subject_id uuid REFERENCES class_subjects(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_subject_id)
);

CREATE INDEX IF NOT EXISTS idx_student_subjects_student ON student_subjects(student_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_class_subject ON student_subjects(class_subject_id);

ALTER TABLE student_subjects ENABLE ROW LEVEL SECURITY;

-- migration-098: authenticated-only. Keyed on student_id, so anon read
-- allowed enumeration of every student UUID and their subject choices.
CREATE POLICY "Authenticated can read student_subjects"
  ON student_subjects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert student_subjects"
  ON student_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update student_subjects"
  ON student_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete student_subjects"
  ON student_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can read student_subjects for their classes"
  ON student_subjects FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_subject_id IN (
      SELECT id FROM class_subjects WHERE teacher_id = auth.uid()
    )
  );

-- 2l. Student Parents (many-to-many)
CREATE TABLE student_parents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  parent_id uuid REFERENCES parents(id) ON DELETE CASCADE NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('father', 'mother', 'guardian')),
  is_primary_contact boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(student_id, parent_id)
);

-- 2l. Student Enrollments
CREATE TABLE student_enrollments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) NOT NULL,
  stream_id uuid REFERENCES streams(id) ON DELETE SET NULL,
  roll_number integer,
  enrollment_date date DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'passed', 'failed', 'terminated', 'exited')),
  has_transport boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_id)
);

-- 2m. Attendance
CREATE TABLE attendance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day')),
  marked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  remarks text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_id, date)
);

-- 2n. Exam Types
CREATE TABLE exam_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) NOT NULL,
  max_marks integer NOT NULL DEFAULT 100,
  weightage numeric(5,2),
  sort_order integer DEFAULT 0,
  kind text NOT NULL DEFAULT 'term_exam' CHECK (kind IN ('term_exam', 'class_test', 'practical')),
  upper_header text,
  class_level text NOT NULL DEFAULT 'all'
    CHECK (class_level IN ('all', 'nursery_ukg', 'i_v', 'vi_viii', 'ix_x', 'xi_xii')),
  UNIQUE(name, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_types_year_level
  ON exam_types(academic_year_id, class_level);

-- 2o. Results
CREATE TABLE results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE CASCADE NOT NULL,
  marks_obtained numeric(5,2) NOT NULL,
  max_marks numeric(5,2) NOT NULL DEFAULT 100,
  grade text,
  remarks text,
  entered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_published boolean DEFAULT false,
  source text NOT NULL DEFAULT 'erp_native'
    CHECK (source IN ('erp_native', 'historical_import')),
  import_batch_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, subject_id, exam_type_id),
  CONSTRAINT results_marks_in_range CHECK (marks_obtained >= 0 AND marks_obtained <= max_marks)
);
CREATE INDEX IF NOT EXISTS results_import_batch_idx
  ON results(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- 2p. Fee Structures
CREATE TABLE fee_structures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id uuid REFERENCES academic_years(id) NOT NULL,
  class_name text NOT NULL,
  class_level text NOT NULL DEFAULT 'all'
    CHECK (class_level IN ('all', 'nursery_ukg', 'i_v', 'vi_viii', 'ix_x', 'xi_xii')),
  stream_id uuid REFERENCES streams(id) ON DELETE SET NULL,
  fee_type text NOT NULL,
  amount numeric(10,2) NOT NULL,
  due_date date,
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly', 'quarterly', 'annual', 'one_time')),
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2q. Payment Orders (must be before fee_payments)
CREATE TABLE payment_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  fee_structure_id uuid REFERENCES fee_structures(id) NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  gateway text NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'manual')),
  gateway_order_id text UNIQUE,
  gateway_payment_id text,
  gateway_signature text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'attempted', 'paid', 'failed', 'refunded', 'expired')),
  month text,
  notes jsonb DEFAULT '{}',
  callback_url text,
  webhook_verified boolean DEFAULT false,
  ip_address inet,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- 2r. Fee Payments
CREATE TABLE fee_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  fee_structure_id uuid REFERENCES fee_structures(id) NOT NULL,
  amount_paid numeric(10,2) NOT NULL,
  payment_date date DEFAULT CURRENT_DATE,
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash', 'online', 'cheque', 'bank_transfer', 'upi', 'gateway')),
  receipt_number text UNIQUE,
  month text,
  academic_year_id uuid REFERENCES academic_years(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'partial', 'failed', 'refunded')),
  payment_order_id uuid REFERENCES payment_orders(id) ON DELETE SET NULL,
  gateway_payment_id text,
  gateway_receipt text,
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  remarks text,
  source text NOT NULL DEFAULT 'erp_native'
    CHECK (source IN ('erp_native', 'historical_import')),
  import_batch_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_payments_import_batch_idx
  ON fee_payments(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- 2s. Timetable Periods
CREATE TABLE timetable_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  -- CASCADE matches every other FK into subjects(id). Left as the default
  -- NO ACTION it blocked subject deletion outright (migration 088). Break
  -- periods carry subject_id NULL and are unaffected.
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES teachers(id),
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  period_number integer NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text,
  is_break boolean DEFAULT false,
  -- migration 119 — parallel teaching groups within one cell. group_no 0 is the
  -- primary group (everything that existed before), 1..n are the extra tracks
  -- that make a Games period or an XI/XII optional slot. is_shared marks a
  -- combined activity running across several classes at once.
  group_no smallint NOT NULL DEFAULT 0,
  group_label text,
  is_shared boolean NOT NULL DEFAULT false,
  UNIQUE(class_id, day_of_week, period_number, group_no)
);

-- Still exactly one PRIMARY group per cell, so every reader that assumes a cell
-- has one main row keeps that guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS timetable_periods_primary_group_uniq
  ON timetable_periods(class_id, day_of_week, period_number)
  WHERE group_no = 0;

-- 2t. Calendar Events
CREATE TABLE calendar_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  event_type text NOT NULL
    CHECK (event_type IN ('exam', 'holiday', 'event', 'pta_meeting', 'sports', 'cultural', 'other')),
  start_date date NOT NULL,
  end_date date,
  is_school_wide boolean DEFAULT true,
  class_id uuid REFERENCES classes(id),
  academic_year_id uuid REFERENCES academic_years(id),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_public boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2u. Registration Requests
CREATE TABLE registration_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  role text NOT NULL CHECK (role IN ('teacher', 'student', 'parent')),
  student_admission_no text,
  relationship text CHECK (relationship IN ('father', 'mother', 'guardian')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 2v. Notifications
CREATE TABLE notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'warning', 'success', 'fee_reminder', 'result_published', 'attendance_alert', 'announcement')),
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 2w. Fee Change Requests (approval workflow for editor-initiated changes
-- to recorded fee_payments — see migration-056-fee-change-requests.sql)
CREATE TABLE fee_change_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_table text NOT NULL
    CHECK (target_table IN ('fee_payments')),
  -- Migration 070: nullable for action='insert' (no target row yet).
  target_id uuid,
  action text NOT NULL
    CHECK (action IN ('insert', 'update', 'delete')),
  -- Migration 070: nullable for action='insert' (no prior row to snapshot).
  current_snapshot jsonb,
  proposed_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL
    CHECK (char_length(reason) >= 5),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  CONSTRAINT chk_reviewer_terminal CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled')
        AND reviewed_at IS NOT NULL)
  ),
  -- Migration 070: an INSERT has no target/snapshot; update/delete require both.
  CONSTRAINT chk_change_request_target CHECK (
    (action = 'insert'
      AND target_id IS NULL
      AND current_snapshot IS NULL)
    OR (action IN ('update', 'delete')
      AND target_id IS NOT NULL
      AND current_snapshot IS NOT NULL)
  )
);

-- 2x. Fee Change Audit Log (records every applied change — approved
-- request OR direct admin edit. source_request_id links the row back to
-- the originating request; nullable for direct admin edits.)
CREATE TABLE fee_change_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_table text NOT NULL,
  -- Migration 070: nullable for an applied INSERT (new id is in after_snapshot).
  target_id uuid,
  action text NOT NULL
    CHECK (action IN ('insert', 'update', 'delete')),
  -- Migration 070: nullable for an applied INSERT (no prior row).
  before_snapshot jsonb,
  after_snapshot jsonb,
  performed_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  performed_at timestamptz NOT NULL DEFAULT now(),
  source_request_id uuid REFERENCES fee_change_requests(id) ON DELETE SET NULL,
  notes text
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- CMS indexes
CREATE INDEX IF NOT EXISTS idx_gallery_images_event ON gallery_images(gallery_event_id);
CREATE INDEX IF NOT EXISTS idx_gallery_events_date ON gallery_events(event_date DESC);

-- Students
CREATE INDEX idx_students_admission_no ON students(admission_no);
CREATE INDEX idx_students_is_active ON students(is_active);
CREATE INDEX idx_students_alumni ON students(is_alumni) WHERE is_alumni = true;

-- Teachers
CREATE INDEX idx_teachers_employee_id ON teachers(employee_id);
CREATE INDEX idx_teachers_is_active ON teachers(is_active);
-- One teacher row per staff member (migration 083); guards promoteStaffToTeacher
-- against concurrent double-insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_staff_member_id_unique
  ON teachers(staff_member_id)
  WHERE staff_member_id IS NOT NULL;

-- Parents
CREATE INDEX idx_parents_email ON parents(email);
CREATE INDEX idx_parents_phone ON parents(phone);

-- Student Parents
CREATE INDEX idx_student_parents_student_id ON student_parents(student_id);
CREATE INDEX idx_student_parents_parent_id ON student_parents(parent_id);

-- Profiles
-- UNIQUE partial indexes (migration 068): enforce 1:1 between an auth account
-- and a domain record — one student/parent/teacher cannot be claimed twice.
CREATE UNIQUE INDEX idx_profiles_teacher_id ON profiles(teacher_id) WHERE teacher_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_student_id ON profiles(student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX idx_profiles_parent_id ON profiles(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_profiles_role ON profiles(role);

-- Classes
CREATE INDEX idx_classes_academic_year_id ON classes(academic_year_id);
CREATE INDEX idx_classes_class_teacher_id ON classes(class_teacher_id);
CREATE INDEX idx_classes_stream_id ON classes(stream_id);

-- Class Subjects
CREATE INDEX idx_class_subjects_class_id ON class_subjects(class_id);
CREATE INDEX idx_class_subjects_teacher_id ON class_subjects(teacher_id);

-- Student Enrollments
CREATE INDEX idx_enrollments_student_id ON student_enrollments(student_id);
CREATE INDEX idx_enrollments_class_id ON student_enrollments(class_id);
CREATE INDEX idx_enrollments_academic_year_id ON student_enrollments(academic_year_id);
CREATE INDEX idx_enrollments_status ON student_enrollments(status);
CREATE INDEX idx_enrollments_active ON student_enrollments(student_id, class_id, academic_year_id) WHERE status = 'active';

-- Attendance
CREATE INDEX idx_attendance_student_date ON attendance(student_id, date);
CREATE INDEX idx_attendance_class_date ON attendance(class_id, date);

-- Results
CREATE INDEX idx_results_student_id ON results(student_id);
CREATE INDEX idx_results_class_subject ON results(class_id, subject_id);
CREATE INDEX idx_results_exam_type_id ON results(exam_type_id);

-- Fee Structures
CREATE INDEX idx_fee_structures_academic_year_id ON fee_structures(academic_year_id);
CREATE INDEX idx_fee_structures_class_name ON fee_structures(class_name);
CREATE INDEX idx_fee_structures_stream_id ON fee_structures(stream_id);

-- Fee Payments
CREATE INDEX idx_fee_payments_student_id ON fee_payments(student_id);
CREATE INDEX idx_fee_payments_status ON fee_payments(status);
CREATE INDEX idx_fee_payments_payment_order_id ON fee_payments(payment_order_id) WHERE payment_order_id IS NOT NULL;

-- Payment Orders
CREATE INDEX idx_payment_orders_student_id ON payment_orders(student_id);
CREATE INDEX idx_payment_orders_status ON payment_orders(status);
CREATE INDEX idx_payment_orders_gateway_order_id ON payment_orders(gateway_order_id);

-- Notifications
CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id, created_at DESC) WHERE is_read = false;

-- Stream Subjects
CREATE INDEX idx_stream_subjects_stream_id ON stream_subjects(stream_id);
CREATE INDEX idx_stream_subjects_subject_id ON stream_subjects(subject_id);

-- Timetable
CREATE INDEX idx_timetable_class_day ON timetable_periods(class_id, day_of_week);
CREATE INDEX idx_timetable_teacher_id ON timetable_periods(teacher_id);
-- Migration 071: a teacher cannot be in two periods that OVERLAP IN TIME on the
-- same weekday. Classes are staggered, so this is a time-range exclusion rather
-- than a (teacher, day, period_number) unique index. Breaks/free rows exempt.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- start_time < end_time excludes degenerate rows: tsrange() errors when the
-- lower bound exceeds the upper, so a bad row (end <= start) would otherwise
-- break the constraint build. Such rows can't overlap anything anyway.
ALTER TABLE timetable_periods
  ADD CONSTRAINT timetable_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) WITH &&
  -- migration 119: is_shared exempts a combined activity, because a games coach
  -- genuinely is on the field for four classes at the same time.
  ) WHERE (
    teacher_id IS NOT NULL
    AND is_break IS NOT TRUE
    AND start_time < end_time
    AND is_shared IS NOT TRUE
  );

-- Calendar Events
CREATE INDEX idx_calendar_events_dates ON calendar_events(start_date, end_date);
CREATE INDEX idx_calendar_events_academic_year ON calendar_events(academic_year_id);

-- Registration Requests
CREATE UNIQUE INDEX idx_registration_requests_pending_email
  ON registration_requests(email) WHERE status = 'pending';
CREATE INDEX idx_registration_requests_status
  ON registration_requests(status, created_at DESC);

-- Fee Change Requests
CREATE UNIQUE INDEX idx_fee_change_requests_one_pending
  ON fee_change_requests (target_table, target_id)
  WHERE status = 'pending';
CREATE INDEX idx_fee_change_requests_status
  ON fee_change_requests (status, requested_at DESC);
CREATE INDEX idx_fee_change_requests_requester
  ON fee_change_requests (requested_by, requested_at DESC);
CREATE INDEX idx_fee_change_requests_target
  ON fee_change_requests (target_table, target_id);

-- Fee Change Audit Log
CREATE INDEX idx_fee_change_audit_target
  ON fee_change_audit_log (target_table, target_id, performed_at DESC);
CREATE INDEX idx_fee_change_audit_actor
  ON fee_change_audit_log (performed_by, performed_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper Functions + Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- Get current user's role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get entity IDs for current user
CREATE OR REPLACE FUNCTION public.get_my_student_id()
RETURNS UUID AS $$
  SELECT student_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_my_teacher_id()
RETURNS UUID AS $$
  SELECT teacher_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_my_parent_id()
RETURNS UUID AS $$
  SELECT parent_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_my_children_ids()
RETURNS SETOF UUID AS $$
  SELECT sp.student_id FROM student_parents sp
  WHERE sp.parent_id = public.get_my_parent_id();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_my_class_ids()
RETURNS SETOF UUID AS $$
  SELECT id FROM classes WHERE class_teacher_id = public.get_my_teacher_id()
  UNION
  SELECT class_id FROM class_subjects WHERE teacher_id = public.get_my_teacher_id();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Per-feature editor capability check (used by RLS policies that need feature-scoped gating).
CREATE OR REPLACE FUNCTION public.has_editor_feature(p_feature text)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.editor_permissions
    WHERE editor_id = auth.uid() AND feature_key = p_feature
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id, new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    -- Role is NEVER taken from client metadata (would allow self-registration
    -- as admin if public signup is enabled). Admin-creation paths set the real
    -- role afterward via the service-role client. (migration 061)
    'student'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Guard: a regular authenticated user (parent/student/teacher editing their own
-- profile row) must not change privileged columns. Service role and admins
-- bypass. Prevents the self-promote-to-admin escalation. (migration 061)
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_cols()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.role                  IS DISTINCT FROM OLD.role
     OR NEW.is_active             IS DISTINCT FROM OLD.is_active
     OR NEW.must_change_password  IS DISTINCT FROM OLD.must_change_password
     OR NEW.teacher_id            IS DISTINCT FROM OLD.teacher_id
     OR NEW.student_id            IS DISTINCT FROM OLD.student_id
     OR NEW.parent_id             IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'Not allowed to modify privileged profile columns';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enforce role ↔ link consistency (migration 068). Composes with the guard
-- above: that one decides WHO may change role/link columns; this one decides
-- WHAT combinations are valid once changed. Applies to everyone incl. the
-- service role — a server path that sets role='parent' without a parent_id
-- should fail loudly. role='student' may keep a NULL student_id (self-claim).
CREATE OR REPLACE FUNCTION public.enforce_profile_role_link()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role       IS NOT DISTINCT FROM OLD.role
     AND NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.parent_id  IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'teacher' AND NEW.teacher_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=teacher requires teacher_id (use the linking service)', NEW.id;
  END IF;
  IF NEW.role = 'parent' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'profile %: role=parent requires parent_id (use the linking service)', NEW.id;
  END IF;
  IF NEW.student_id IS NOT NULL AND NEW.role <> 'student' THEN
    RAISE EXCEPTION 'profile %: student_id set but role=% (must be student)', NEW.id, NEW.role;
  END IF;
  IF NEW.parent_id IS NOT NULL AND NEW.role <> 'parent' THEN
    RAISE EXCEPTION 'profile %: parent_id set but role=% (must be parent)', NEW.id, NEW.role;
  END IF;
  IF NEW.teacher_id IS NOT NULL AND NEW.role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'profile %: teacher_id set but role=% (must be teacher or admin)', NEW.id, NEW.role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atomic per-student finalize: unpublish any active prior + insert new
-- version in a single transaction. Used by /api/erp/results/finalize-marksheet.
-- See migration 032 for full context.
CREATE OR REPLACE FUNCTION public.finalize_marksheet_one(
  p_student_id uuid,
  p_class_id uuid,
  p_exam_type_id uuid,
  p_snapshot jsonb,
  p_schema_version text,
  p_published_by uuid,
  p_unpublish_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_id uuid;
  v_latest_version int;
  v_new_id uuid;
  v_new_version int;
BEGIN
  SELECT COALESCE(MAX(version), 0) INTO v_latest_version
  FROM marksheet_publications
  WHERE student_id = p_student_id AND exam_type_id = p_exam_type_id;
  v_new_version := v_latest_version + 1;

  SELECT id INTO v_active_id
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND exam_type_id = p_exam_type_id
    AND unpublished_at IS NULL
  LIMIT 1;

  IF v_active_id IS NOT NULL THEN
    UPDATE marksheet_publications
    SET unpublished_at = now(),
        unpublish_reason = p_unpublish_reason,
        unpublished_by = p_published_by
    WHERE id = v_active_id;
  END IF;

  INSERT INTO marksheet_publications (
    student_id, class_id, exam_type_id, version, snapshot, schema_version, published_by
  ) VALUES (
    p_student_id, p_class_id, p_exam_type_id, v_new_version,
    p_snapshot, p_schema_version, p_published_by
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'new_id', v_new_id,
    'version', v_new_version,
    'refinalized', v_active_id IS NOT NULL
  );
END;
$$;

-- Year-final variant of finalize_marksheet_one (migration 033). Same shape,
-- but keyed on academic_year_id and forces kind='year_final'.
CREATE OR REPLACE FUNCTION public.finalize_year_final_one(
  p_student_id uuid,
  p_class_id uuid,
  p_academic_year_id uuid,
  p_snapshot jsonb,
  p_schema_version text,
  p_published_by uuid,
  p_unpublish_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_id uuid;
  v_latest_version int;
  v_new_id uuid;
  v_new_version int;
BEGIN
  SELECT COALESCE(MAX(version), 0) INTO v_latest_version
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND academic_year_id = p_academic_year_id
    AND kind = 'year_final';
  v_new_version := v_latest_version + 1;

  SELECT id INTO v_active_id
  FROM marksheet_publications
  WHERE student_id = p_student_id
    AND academic_year_id = p_academic_year_id
    AND kind = 'year_final'
    AND unpublished_at IS NULL
  LIMIT 1;

  IF v_active_id IS NOT NULL THEN
    UPDATE marksheet_publications
    SET unpublished_at = now(),
        unpublish_reason = p_unpublish_reason,
        unpublished_by = p_published_by
    WHERE id = v_active_id;
  END IF;

  INSERT INTO marksheet_publications (
    student_id, class_id, exam_type_id, academic_year_id, kind,
    version, snapshot, schema_version, published_by
  ) VALUES (
    p_student_id, p_class_id, NULL, p_academic_year_id, 'year_final',
    v_new_version, p_snapshot, p_schema_version, p_published_by
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'new_id', v_new_id,
    'version', v_new_version,
    'refinalized', v_active_id IS NOT NULL
  );
END;
$$;

-- Apply set_updated_at trigger to all tables with updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_parents_updated_at
  BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_student_enrollments_updated_at
  BEFORE UPDATE ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_results_updated_at
  BEFORE UPDATE ON results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_fee_structures_updated_at
  BEFORE UPDATE ON fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_fee_payments_updated_at
  BEFORE UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Phase 4+ tables added via migration 031. Wrapped in DO so re-running is
-- idempotent: drop-if-exists, then recreate.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'gallery_events',
    'section_cards',
    'staff_members',
    'grade_scales',
    'class_exam_configs',
    'pdf_header_configs',
    'pdf_footer_configs',
    'non_scholastic_subjects',
    'non_scholastic_sub_subjects',
    'exam_schedules',
    'admit_card_templates',
    'result_masters',
    'class_tests',
    'student_remarks',
    'articles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'set_updated_at_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'set_updated_at_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- Money / max-marks CHECK constraints (migration 031). DROP IF EXISTS keeps
-- this idempotent across re-runs.
ALTER TABLE exam_types
  DROP CONSTRAINT IF EXISTS exam_types_max_marks_positive;
ALTER TABLE exam_types
  ADD CONSTRAINT exam_types_max_marks_positive CHECK (max_marks > 0);

ALTER TABLE fee_structures
  DROP CONSTRAINT IF EXISTS fee_structures_amount_positive;
ALTER TABLE fee_structures
  ADD CONSTRAINT fee_structures_amount_positive CHECK (amount > 0);

ALTER TABLE fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_amount_positive;
-- Migration 040 — relaxed for waiver rows where amount_paid is intentionally 0.
ALTER TABLE fee_payments
  ADD CONSTRAINT fee_payments_amount_positive CHECK (
    (payment_method = 'waiver' AND amount_paid = 0)
    OR amount_paid > 0
  );

ALTER TABLE payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_amount_positive;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_amount_positive CHECK (amount > 0);

-- Audit / filter indexes (migration 031).
CREATE INDEX IF NOT EXISTS idx_results_entered_by ON results(entered_by);
CREATE INDEX IF NOT EXISTS idx_class_test_results_entered_by ON class_test_results(entered_by);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_assessments_entered_by ON non_scholastic_assessments(entered_by);
CREATE INDEX IF NOT EXISTS idx_student_remarks_author_id ON student_remarks(author_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_created_by ON class_tests(created_by);
CREATE INDEX IF NOT EXISTS idx_results_is_published ON results(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_class_tests_is_published ON class_tests(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_payment_orders_expires_at ON payment_orders(expires_at);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security — CMS Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Gallery Images: public read, authenticated write
ALTER TABLE gallery_images ENABLE ROW LEVEL SECURITY;

-- Public SELECT limited to non-private images (migration 060): standalone
-- images, or images whose linked gallery_event is public. Admin/editor views
-- use the service-role client and bypass RLS.
CREATE POLICY "Public can view public gallery images"
  ON gallery_images FOR SELECT
  USING (
    gallery_event_id IS NULL
    OR EXISTS (
      SELECT 1 FROM gallery_events e
      WHERE e.id = gallery_images.gallery_event_id AND e.is_public = true
    )
  );

CREATE POLICY "Staff can insert gallery images"
  ON gallery_images FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update gallery images"
  ON gallery_images FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete gallery images"
  ON gallery_images FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Transfer Certificates: authenticated-only reads, server-mediated public
-- lookup. Public anonymous SELECTs return zero rows. Public users find
-- their TC via `/api/transfer-certificates/lookup`, which uses the service
-- role on the server after an exact (admission_no, dob) match.
ALTER TABLE transfer_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view transfer certificates"
  ON transfer_certificates FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can insert transfer certificates"
  ON transfer_certificates FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete transfer certificates"
  ON transfer_certificates FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Contact Submissions: authenticated read/write (submitted via service role key)
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view contact submissions"
  ON contact_submissions FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update contact submissions"
  ON contact_submissions FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Service role can insert contact submissions"
  ON contact_submissions FOR INSERT
  WITH CHECK (true);

-- Site Media
ALTER TABLE site_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read site_media"
  ON site_media FOR SELECT
  USING (true);

CREATE POLICY "Staff can update site_media"
  ON site_media FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can insert site_media"
  ON site_media FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

-- Section Cards
ALTER TABLE section_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read section_cards"
  ON section_cards FOR SELECT
  USING (true);

CREATE POLICY "Staff can insert section_cards"
  ON section_cards FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update section_cards"
  ON section_cards FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete section_cards"
  ON section_cards FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Staff Members
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;

-- migration-098: authenticated-only, for the same reason as `teachers`
-- (date_of_birth, address, phone, email, license_number). The public staff
-- directory reads the `public_staff_directory` view instead — defined at the
-- end of this file.
CREATE POLICY "Authenticated can read staff members"
  ON staff_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can insert staff members"
  ON staff_members FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update staff members"
  ON staff_members FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete staff members"
  ON staff_members FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Disclosure Items
ALTER TABLE disclosure_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read disclosure_items"
  ON disclosure_items FOR SELECT USING (true);

CREATE POLICY "Staff can update disclosure_items"
  ON disclosure_items FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can insert disclosure_items"
  ON disclosure_items FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_items"
  ON disclosure_items FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Disclosure Documents
ALTER TABLE disclosure_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read disclosure_documents"
  ON disclosure_documents FOR SELECT USING (true);

CREATE POLICY "Staff can update disclosure_documents"
  ON disclosure_documents FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can insert disclosure_documents"
  ON disclosure_documents FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_documents"
  ON disclosure_documents FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Disclosure Board Results
ALTER TABLE disclosure_board_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read disclosure_board_results"
  ON disclosure_board_results FOR SELECT USING (true);

CREATE POLICY "Staff can insert disclosure_board_results"
  ON disclosure_board_results FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can update disclosure_board_results"
  ON disclosure_board_results FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Staff can delete disclosure_board_results"
  ON disclosure_board_results FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'staff'));

-- Gallery Events
ALTER TABLE gallery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view gallery events"
  ON gallery_events FOR SELECT
  USING (is_public = true);

CREATE POLICY "Admins full access to gallery events"
  ON gallery_events FOR ALL
  USING (public.get_user_role() = 'admin');


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security — ERP Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Profiles ────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (public.get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Teachers can read student profiles in their classes"
  ON profiles FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND student_id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

-- Self-update is gated two ways (migration 061): column-level GRANT below
-- limits which columns the authenticated role may write, and the
-- guard_profile_privileged_cols trigger rejects privileged-column changes.
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE TRIGGER guard_profile_privileged_cols
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_cols();

-- Role↔link integrity (migration 068): fires on INSERT and on role/link changes.
CREATE TRIGGER enforce_profile_role_link
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_role_link();

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, avatar_url) ON public.profiles TO authenticated;

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete profiles"
  ON profiles FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Teachers ────────────────────────────────────────────────────────────────
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- migration-098: authenticated-only. This policy previously read
-- `USING (true)` with no TO clause, which includes anon — exposing
-- aadhar_number, date_of_birth, address, phone and email to the internet.
CREATE POLICY "Authenticated can read teachers"
  ON teachers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert teachers"
  ON teachers FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update teachers"
  ON teachers FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete teachers"
  ON teachers FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can update own record"
  ON teachers FOR UPDATE
  USING (id = public.get_my_teacher_id());

-- ── Students ────────────────────────────────────────────────────────────────
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all students"
  ON students FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can read students in their classes"
  ON students FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

CREATE POLICY "Teachers can update students in their classes"
  ON students FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

CREATE POLICY "Students can read own record"
  ON students FOR SELECT
  USING (id = public.get_my_student_id());

CREATE POLICY "Parents can read children records"
  ON students FOR SELECT
  USING (id IN (SELECT public.get_my_children_ids()));

CREATE POLICY "Admins can insert students"
  ON students FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update students"
  ON students FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete students"
  ON students FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Parents ─────────────────────────────────────────────────────────────────
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all parents"
  ON parents FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can insert parents"
  ON parents FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update parents"
  ON parents FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete parents"
  ON parents FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Parents can read own record"
  ON parents FOR SELECT
  USING (id = public.get_my_parent_id());

CREATE POLICY "Parents can update own record"
  ON parents FOR UPDATE
  USING (id = public.get_my_parent_id());

-- ── Student Parents ─────────────────────────────────────────────────────────
ALTER TABLE student_parents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to student_parents"
  ON student_parents FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Parents can read own links"
  ON student_parents FOR SELECT
  USING (parent_id = public.get_my_parent_id());

CREATE POLICY "Students can read own parent links"
  ON student_parents FOR SELECT
  USING (student_id = public.get_my_student_id());

-- ── Academic Years ──────────────────────────────────────────────────────────
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read academic years"
  ON academic_years FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert academic years"
  ON academic_years FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update academic years"
  ON academic_years FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete academic years"
  ON academic_years FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Subjects ────────────────────────────────────────────────────────────────
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read subjects"
  ON subjects FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert subjects"
  ON subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update subjects"
  ON subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete subjects"
  ON subjects FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Streams ─────────────────────────────────────────────────────────────────
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read streams"
  ON streams FOR SELECT USING (true);

CREATE POLICY "Admins can insert streams"
  ON streams FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update streams"
  ON streams FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete streams"
  ON streams FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Stream Subjects ─────────────────────────────────────────────────────────
ALTER TABLE stream_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read stream_subjects"
  ON stream_subjects FOR SELECT USING (true);

CREATE POLICY "Admins can insert stream_subjects"
  ON stream_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update stream_subjects"
  ON stream_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete stream_subjects"
  ON stream_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Classes ─────────────────────────────────────────────────────────────────
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read classes"
  ON classes FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert classes"
  ON classes FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update classes"
  ON classes FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete classes"
  ON classes FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Exam Types ──────────────────────────────────────────────────────────────
ALTER TABLE exam_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read exam types"
  ON exam_types FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert exam types"
  ON exam_types FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update exam types"
  ON exam_types FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete exam types"
  ON exam_types FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Class Subjects ──────────────────────────────────────────────────────────
ALTER TABLE class_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read class subjects"
  ON class_subjects FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert class subjects"
  ON class_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update class subjects"
  ON class_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete class subjects"
  ON class_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Student Enrollments ─────────────────────────────────────────────────────
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all enrollments"
  ON student_enrollments FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can insert enrollments"
  ON student_enrollments FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update enrollments"
  ON student_enrollments FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete enrollments"
  ON student_enrollments FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can read enrollments for their classes"
  ON student_enrollments FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Teachers can insert enrollments for their classes"
  ON student_enrollments FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Teachers can update enrollments for their classes"
  ON student_enrollments FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Students can read own enrollment"
  ON student_enrollments FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "Parents can read children enrollments"
  ON student_enrollments FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- ── Attendance ──────────────────────────────────────────────────────────────
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to attendance"
  ON attendance FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can read attendance for their classes"
  ON attendance FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Teachers can insert attendance for their classes"
  ON attendance FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Teachers can update attendance for their classes"
  ON attendance FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Students can read own attendance"
  ON attendance FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "Parents can read children attendance"
  ON attendance FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- ── Results ─────────────────────────────────────────────────────────────────
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to results"
  ON results FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can read results for their classes"
  ON results FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "Teachers can insert results for their class-subject combos"
  ON results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

CREATE POLICY "Teachers can update results for their class-subject combos"
  ON results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = results.class_id
         AND cs.subject_id = results.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

CREATE POLICY "Students can read own published results"
  ON results FOR SELECT
  USING (student_id = public.get_my_student_id() AND is_published = true);

CREATE POLICY "Parents can read children published results"
  ON results FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()) AND is_published = true);

-- ── Fee Structures ──────────────────────────────────────────────────────────
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read fee structures"
  ON fee_structures FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert fee structures"
  ON fee_structures FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update fee structures"
  ON fee_structures FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete fee structures"
  ON fee_structures FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Fee Payments ────────────────────────────────────────────────────────────
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to fee payments"
  ON fee_payments FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Students can read own fee payments"
  ON fee_payments FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "Parents can read children fee payments"
  ON fee_payments FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- ── Payment Orders ──────────────────────────────────────────────────────────
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to payment orders"
  ON payment_orders FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Parents can read own payment orders"
  ON payment_orders FOR SELECT
  USING (parent_id = public.get_my_parent_id());

CREATE POLICY "Parents can create payment orders for children"
  ON payment_orders FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "Students can read own payment orders"
  ON payment_orders FOR SELECT
  USING (student_id = public.get_my_student_id());

-- ── Timetable Periods ──────────────────────────────────────────────────────
ALTER TABLE timetable_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read timetable periods"
  ON timetable_periods FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert timetable periods"
  ON timetable_periods FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update timetable periods"
  ON timetable_periods FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete timetable periods"
  ON timetable_periods FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Calendar Events ─────────────────────────────────────────────────────────
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read calendar events"
  ON calendar_events FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert calendar events"
  ON calendar_events FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update calendar events"
  ON calendar_events FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete calendar events"
  ON calendar_events FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Registration Requests ───────────────────────────────────────────────────
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit registration"
  ON registration_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can read all registrations"
  ON registration_requests FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can update registrations"
  ON registration_requests FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete registrations"
  ON registration_requests FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ── Fee Change Requests ─────────────────────────────────────────────────────
-- Service-role API layer (verifyAdminOrEditorWithUser) is the real gate.
-- RLS only matters for the unlikely case where the anon/authed key
-- reaches these tables directly.
ALTER TABLE fee_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to fee_change_requests"
  ON fee_change_requests FOR ALL
  USING (public.get_user_role() = 'admin');

-- ── Fee Change Audit Log ────────────────────────────────────────────────────
ALTER TABLE fee_change_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins have full access to fee_change_audit_log"
  ON fee_change_audit_log FOR ALL
  USING (public.get_user_role() = 'admin');

-- ── Notifications ───────────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (recipient_id = auth.uid());

CREATE POLICY "Admins have full access to notifications"
  ON notifications FOR ALL
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Teachers can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (public.get_user_role() = 'teacher');


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed Data — Mandatory Public Disclosure
-- ─────────────────────────────────────────────────────────────────────────────

-- Section A — General Information
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('general', 'school_name', 'Name of the School', 'NK Public School', 0),
  ('general', 'affiliation_no', 'Affiliation No.', '1730446', 1),
  ('general', 'school_code', 'School Code', '14399', 2),
  ('general', 'address', 'Complete Address with Pin Code', 'Grand Sikar Road, Rajawas, Jaipur, Rajasthan – 302013', 3),
  ('general', 'principal_name', 'Principal Name & Qualification', 'Mrs. Prema Kavia', 4),
  ('general', 'school_email', 'School Email ID', 'nkps.rajawas@gmail.com', 5),
  ('general', 'contact_details', 'Contact Details (Landline/Mobile)', '+91-9785500046, +91-9785500048', 6)
ON CONFLICT (field_key) DO NOTHING;

-- Section C — Result & Academics (text fields)
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('result_academics', 'fee_structure', 'Fee Structure of the School', '', 0),
  ('result_academics', 'academic_calendar', 'Annual Academic Calendar', '', 1),
  ('result_academics', 'smc_list', 'List of School Management Committee (SMC)', '', 2),
  ('result_academics', 'pta_members', 'List of Parents Teachers Association (PTA) Members', '', 3)
ON CONFLICT (field_key) DO NOTHING;

-- Section D — Staff (Teaching)
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('staff', 'principal', 'Principal', 'Mrs. Prema Kavia', 0),
  ('staff', 'total_teachers', 'Total No. of Teachers (PGT / TGT / PRT)', '100+ (PGT: 25+, TGT: 35+, PRT: 40+)', 1),
  ('staff', 'teacher_section_ratio', 'Teacher-Section Ratio', '1:1.5', 2),
  ('staff', 'special_educator', 'Details of Special Educator', '', 3),
  ('staff', 'counsellor', 'Details of Counsellor and Wellness Teacher', '', 4)
ON CONFLICT (field_key) DO NOTHING;

-- Section E — School Infrastructure
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('infrastructure', 'campus_area', 'Total Campus Area (in sq. mtrs.)', '20,000 sq. mtrs.', 0),
  ('infrastructure', 'classrooms', 'Number and Size of Classrooms', '60+ Classrooms', 1),
  ('infrastructure', 'labs', 'Number and Size of Laboratories (incl. Computer Labs)', '5 Labs (Physics, Chemistry, Biology, Computer, Math)', 2),
  ('infrastructure', 'internet', 'Internet Facility', 'Yes', 3),
  ('infrastructure', 'girls_toilets', 'Number of Girls'' Toilets', '', 4),
  ('infrastructure', 'boys_toilets', 'Number of Boys'' Toilets', '', 5),
  ('infrastructure', 'youtube_link', 'Link of YouTube Video of School Inspection', '', 6)
ON CONFLICT (field_key) DO NOTHING;

-- Section B — Documents
INSERT INTO disclosure_documents (doc_key, label, sort_order) VALUES
  ('affiliation_letter', 'Copies of Affiliation/Upgradation Letter and Recent Extension of Affiliation', 0),
  ('society_registration', 'Copies of Societies/Trust/Company Registration/Renewal Certificate', 1),
  ('noc', 'Copy of No Objection Certificate (NOC) Issued by the State Govt/UT', 2),
  ('rte_recognition', 'Copy of Recognition Certificate under RTE Act, 2009, and Its Renewal', 3),
  ('building_safety', 'Copy of Valid Building Safety Certificate (as per National Building Code)', 4),
  ('fire_safety', 'Copy of Valid Fire Safety Certificate Issued by the Competent Authority', 5),
  ('deo_certificate', 'Copy of DEO Certificate Submitted for Affiliation/Self-Certification by School', 6),
  ('water_health_sanitation', 'Copy of Valid Water, Health and Sanitation Certificates', 7)
ON CONFLICT (doc_key) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Storage Buckets (create manually in Supabase Dashboard > Storage)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Bucket access model after migration 061:
--   gallery / site-media / staff-photos / avatars / disclosure-documents — PUBLIC
--     read; WRITES are service-role only (uploads go through admin-gated
--     signed-URL minting or the avatar API). Users may write only their own
--     avatars/<uid>.<ext> object.
--   transfer-certificates — PRIVATE (no public read). Downloads are served via
--     short-lived signed URLs from the TC lookup/download routes only.
--
-- The policies below are version-controlled (migration 061). When provisioning
-- a fresh project, do NOT also add the Dashboard "Allow authenticated users"
-- quick-policies — they would re-open writes (RLS policies are OR-combined).

DROP POLICY IF EXISTS "Service role manages content buckets" ON storage.objects;
CREATE POLICY "Service role manages content buckets"
  ON storage.objects FOR ALL
  TO service_role
  USING (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars',
                  'prospectus','holiday-homework')
  )
  WITH CHECK (
    bucket_id IN ('gallery','transfer-certificates','site-media',
                  'staff-photos','disclosure-documents','avatars',
                  'prospectus','holiday-homework')
  );

DROP POLICY IF EXISTS "Users manage own avatar object" ON storage.objects;
CREATE POLICY "Users manage own avatar object"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM auth.uid()::text
  );

DROP POLICY IF EXISTS "Public read of public content buckets" ON storage.objects;
CREATE POLICY "Public read of public content buckets"
  ON storage.objects FOR SELECT
  USING (
    bucket_id IN ('gallery','site-media','staff-photos','avatars',
                  'disclosure-documents','prospectus','holiday-homework')
  );

-- NOTE: the transfer-certificates bucket is flipped to private MANUALLY in
-- Supabase Studio (deliberate operational choice). The signed-URL TC routes work
-- regardless of the bucket's public flag, so this is intentionally not automated.

-- Enforce allowed MIME types + size caps at the storage layer (the signed-URL
-- flow lets the client choose content-type, so this is the real defense against
-- storing HTML/SVG under an image/pdf extension → stored XSS). (migration 061)
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'],
      file_size_limit = 5242880
  WHERE id IN ('gallery','site-media','avatars');
-- staff-photos also allows webp: the browser upload pipeline (compressImage)
-- re-encodes cropped JPEGs to webp before upload, so a jpeg/png-only allowlist
-- rejected every staff photo with "mime type image/webp is not supported".
-- (migration 079)
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'],
      file_size_limit = 2097152
  WHERE id = 'staff-photos';
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['application/pdf'],
      file_size_limit = 10485760
  WHERE id IN ('transfer-certificates','disclosure-documents');

-- Migration 901 — the prospectus and holiday-homework buckets were created by
-- hand (migrations 059/060) and missed migration 061 entirely, so they had no
-- MIME allowlist, no size cap and no version-controlled policies. Created here
-- so a fresh project doesn't depend on the manual Dashboard step.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('prospectus','prospectus', true, 10485760, ARRAY['application/pdf']),
  ('holiday-homework','holiday-homework', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Migration 076 — private bucket for transport change-request applications.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('transport-applications','transport-applications', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Service role manages transport applications" ON storage.objects;
CREATE POLICY "Service role manages transport applications"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'transport-applications')
  WITH CHECK (bucket_id = 'transport-applications');

-- ============================================
-- EDITOR PERMISSIONS (per-feature access for editor role)
-- ============================================

CREATE TABLE editor_permissions (
  editor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  granted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (editor_id, feature_key)
);

CREATE INDEX idx_editor_permissions_editor ON editor_permissions(editor_id);

ALTER TABLE editor_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read editor permissions"
  ON editor_permissions FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Editors can read their own permissions"
  ON editor_permissions FOR SELECT
  USING (editor_id = auth.uid());

CREATE POLICY "Admins can insert editor permissions"
  ON editor_permissions FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete editor permissions"
  ON editor_permissions FOR DELETE
  USING (public.get_user_role() = 'admin');

-- ============================================
-- TEMPORARY PASSWORD VAULT (migration 902)
-- ============================================
-- Holds the generated password of an account that has not yet set its own, so
-- an admin can read it back and pass it on when the welcome email doesn't
-- reach the user. Encrypted at rest by the application
-- (packages/shared/src/lib/temp-credentials.ts, AES-256-GCM) and deleted by the
-- trigger below the moment profiles.must_change_password becomes false.

CREATE TABLE IF NOT EXISTS user_temp_credentials (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  issued_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_revealed_at timestamptz,
  last_revealed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reveal_count integer NOT NULL DEFAULT 0
);

-- RLS on with NO policies: service-role only. Deliberate — "Admins can read all
-- profiles" also covers role='staff', so the ciphertext must not live on
-- profiles where a browser client could select it.
ALTER TABLE user_temp_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_temp_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON user_temp_credentials FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.drop_temp_credential_on_password_set()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.must_change_password IS DISTINCT FROM NEW.must_change_password
     AND NEW.must_change_password IS NOT TRUE THEN
    DELETE FROM public.user_temp_credentials WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS drop_temp_credential_on_password_set ON profiles;
CREATE TRIGGER drop_temp_credential_on_password_set
  AFTER UPDATE OF must_change_password ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.drop_temp_credential_on_password_set();

-- ============================================
-- ARTIFACTS (long-form news/announcements; surfaced on Latest Updates + own pages)
-- ============================================

CREATE TABLE IF NOT EXISTS articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  excerpt text,
  content text NOT NULL,
  cover_image_url text,
  author_name text,
  meta_description text,
  tags text[] DEFAULT '{}',
  is_published boolean DEFAULT false,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published articles"
  ON articles FOR SELECT
  USING (is_published = true);

CREATE POLICY "Authenticated can read all articles"
  ON articles FOR SELECT TO authenticated
  USING (true);

-- Writes are admin/staff only (migration 060). CMS writes go through the
-- service-role client, which bypasses RLS; this policy blocks parent/student/
-- teacher JWTs from mutating articles via the anon client.
CREATE POLICY "Staff can insert articles"
  ON articles FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can update articles"
  ON articles FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Staff can delete articles"
  ON articles FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
  );

-- ============================================
-- STUDENT REMARKS (class teacher's overall comment per student per exam,
-- shown at the bottom of the printed report card — distinct from the
-- per-subject results.remarks column)
-- ============================================

CREATE TABLE IF NOT EXISTS student_remarks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  remark text NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (student_id, exam_type_id)
);

CREATE INDEX IF NOT EXISTS idx_student_remarks_student ON student_remarks(student_id);
CREATE INDEX IF NOT EXISTS idx_student_remarks_exam ON student_remarks(exam_type_id);

ALTER TABLE student_remarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own remarks" ON student_remarks;
CREATE POLICY "Students read own remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT student_id FROM profiles WHERE id = auth.uid() AND student_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Parents read linked children remarks" ON student_remarks;
CREATE POLICY "Parents read linked children remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT sp.student_id
      FROM student_parents sp
      JOIN profiles p ON p.parent_id = sp.parent_id
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Teachers read all remarks" ON student_remarks;
CREATE POLICY "Teachers read all remarks"
  ON student_remarks FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin', 'staff'))
  );

DROP POLICY IF EXISTS "Teachers upsert remarks" ON student_remarks;
CREATE POLICY "Teachers upsert remarks"
  ON student_remarks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  );

DROP POLICY IF EXISTS "Teachers update remarks" ON student_remarks;
CREATE POLICY "Teachers update remarks"
  ON student_remarks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
  );

DROP POLICY IF EXISTS "Admins delete remarks" ON student_remarks;
CREATE POLICY "Admins delete remarks"
  ON student_remarks FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- GRADE MASTER (admin-defined grade scales, globally or per-class)
-- ============================================

CREATE TABLE IF NOT EXISTS grade_scales (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('scholastic', 'non_scholastic')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_grade_scales_one_default_per_scope
  ON grade_scales(scope)
  WHERE is_default = true;

CREATE TABLE IF NOT EXISTS grade_bands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  grade_scale_id uuid NOT NULL REFERENCES grade_scales(id) ON DELETE CASCADE,
  label text NOT NULL,
  min_pct numeric(5,2) NOT NULL CHECK (min_pct >= 0 AND min_pct <= 100),
  max_pct numeric(5,2) NOT NULL CHECK (max_pct >= 0 AND max_pct <= 100),
  remark text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT grade_bands_pct_range CHECK (min_pct <= max_pct)
);

CREATE INDEX IF NOT EXISTS idx_grade_bands_scale ON grade_bands(grade_scale_id);

CREATE TABLE IF NOT EXISTS class_grade_scales (
  class_id uuid PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  grade_scale_id uuid NOT NULL REFERENCES grade_scales(id) ON DELETE RESTRICT,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_grade_scales_scale ON class_grade_scales(grade_scale_id);

ALTER TABLE grade_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_grade_scales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read grade_scales" ON grade_scales;
CREATE POLICY "Authenticated can read grade_scales"
  ON grade_scales FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage grade_scales" ON grade_scales;
CREATE POLICY "Admins can manage grade_scales"
  ON grade_scales FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read grade_bands" ON grade_bands;
CREATE POLICY "Authenticated can read grade_bands"
  ON grade_bands FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage grade_bands" ON grade_bands;
CREATE POLICY "Admins can manage grade_bands"
  ON grade_bands FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read class_grade_scales" ON class_grade_scales;
CREATE POLICY "Authenticated can read class_grade_scales"
  ON class_grade_scales FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage class_grade_scales" ON class_grade_scales;
CREATE POLICY "Admins can manage class_grade_scales"
  ON class_grade_scales FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- CLASS EXAM CONFIGS (per-class weightage / applicability / max-marks override)
-- Final result composition reads from here; absence of a row = exam applies
-- to the class with the defaults defined on exam_types.
-- ============================================

CREATE TABLE IF NOT EXISTS class_exam_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  is_applicable boolean NOT NULL DEFAULT true,
  weightage numeric(5,2),
  max_marks_override numeric(5,2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_exam_configs_unique UNIQUE (class_id, exam_type_id),
  CONSTRAINT class_exam_configs_weightage_range
    CHECK (weightage IS NULL OR (weightage >= 0 AND weightage <= 100)),
  CONSTRAINT class_exam_configs_max_marks_positive
    CHECK (max_marks_override IS NULL OR max_marks_override > 0)
);

CREATE INDEX IF NOT EXISTS idx_class_exam_configs_class ON class_exam_configs(class_id);
CREATE INDEX IF NOT EXISTS idx_class_exam_configs_exam ON class_exam_configs(exam_type_id);

ALTER TABLE class_exam_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read class_exam_configs" ON class_exam_configs;
CREATE POLICY "Authenticated can read class_exam_configs"
  ON class_exam_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage class_exam_configs" ON class_exam_configs;
CREATE POLICY "Admins can manage class_exam_configs"
  ON class_exam_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- PDF TEMPLATE CONFIGS (per-template header/footer content for report cards,
-- admit cards, etc. — admin-editable; fallback to SCHOOL constants if a row
-- for the requested template_key is missing)
-- ============================================

CREATE TABLE IF NOT EXISTS pdf_header_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  school_name text NOT NULL,
  address_line text NOT NULL,
  affiliation text,
  affiliation_number text,
  logo_url text,
  motto text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pdf_footer_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key text NOT NULL UNIQUE,
  disclaimer_text text,
  show_signatures boolean NOT NULL DEFAULT true,
  signature_labels jsonb NOT NULL DEFAULT '["Class Teacher","Principal"]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pdf_header_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_footer_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read pdf_header_configs" ON pdf_header_configs;
CREATE POLICY "Authenticated can read pdf_header_configs"
  ON pdf_header_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage pdf_header_configs" ON pdf_header_configs;
CREATE POLICY "Admins can manage pdf_header_configs"
  ON pdf_header_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read pdf_footer_configs" ON pdf_footer_configs;
CREATE POLICY "Authenticated can read pdf_footer_configs"
  ON pdf_footer_configs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage pdf_footer_configs" ON pdf_footer_configs;
CREATE POLICY "Admins can manage pdf_footer_configs"
  ON pdf_footer_configs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- NON-SCHOLASTIC MASTERS (co-scholastic subject + sub-subject taxonomy)
-- Teachers grade students on these alongside academic subjects; entry grid
-- is built in Phase 2.
-- ============================================

CREATE TABLE IF NOT EXISTS non_scholastic_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS non_scholastic_sub_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_subject_id uuid NOT NULL REFERENCES non_scholastic_subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade_scale_id uuid REFERENCES grade_scales(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_sub_subjects_parent_name_unique UNIQUE (parent_subject_id, name)
);

CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subjects_parent
  ON non_scholastic_sub_subjects(parent_subject_id);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subjects_scale
  ON non_scholastic_sub_subjects(grade_scale_id);

ALTER TABLE non_scholastic_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_scholastic_sub_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_subjects" ON non_scholastic_subjects;
CREATE POLICY "Authenticated can read non_scholastic_subjects"
  ON non_scholastic_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_subjects" ON non_scholastic_subjects;
CREATE POLICY "Admins can manage non_scholastic_subjects"
  ON non_scholastic_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_sub_subjects" ON non_scholastic_sub_subjects;
CREATE POLICY "Authenticated can read non_scholastic_sub_subjects"
  ON non_scholastic_sub_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_sub_subjects" ON non_scholastic_sub_subjects;
CREATE POLICY "Admins can manage non_scholastic_sub_subjects"
  ON non_scholastic_sub_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- EXAM SCHEDULES (subject × class × date × time × room per exam type)
-- Distinct from timetable_periods which models regular daily class periods.
-- ============================================

CREATE TABLE IF NOT EXISTS exam_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- M15 (migration 046): exam_type_id flipped to SET NULL so deleting an
  -- exam_type doesn't silently revoke the published timetable.
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE SET NULL,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_date date NOT NULL,
  start_time time,
  end_time time,
  room text,
  invigilator_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT exam_schedules_unique UNIQUE (exam_type_id, class_id, subject_id),
  CONSTRAINT exam_schedules_time_order CHECK (
    start_time IS NULL OR end_time IS NULL OR start_time < end_time
  )
);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_class ON exam_schedules(exam_type_id, class_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_date ON exam_schedules(exam_date);

-- Migration 034: lock down the IST assumption on the time columns.
COMMENT ON COLUMN exam_schedules.start_time IS
  'Local clock time in Asia/Kolkata (IST, UTC+05:30). No timezone applied at read time — all consumers assume IST.';
COMMENT ON COLUMN exam_schedules.end_time IS
  'Local clock time in Asia/Kolkata (IST, UTC+05:30). See start_time.';
COMMENT ON COLUMN exam_schedules.exam_date IS
  'Calendar date in Asia/Kolkata. Stored as `date`, no timezone applied.';

ALTER TABLE exam_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read exam_schedules" ON exam_schedules;
CREATE POLICY "Authenticated can read exam_schedules"
  ON exam_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage exam_schedules" ON exam_schedules;
CREATE POLICY "Admins can manage exam_schedules"
  ON exam_schedules FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- ADMIT CARD TEMPLATES (reusable PDF layouts for admit card generation)
-- ============================================

CREATE TABLE IF NOT EXISTS admit_card_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  orientation text NOT NULL DEFAULT 'portrait'
    CHECK (orientation IN ('portrait', 'landscape')),
  background_image_url text,
  show_photo boolean NOT NULL DEFAULT true,
  show_admission_no boolean NOT NULL DEFAULT true,
  show_roll_no boolean NOT NULL DEFAULT true,
  show_class_section boolean NOT NULL DEFAULT true,
  show_father_name boolean NOT NULL DEFAULT true,
  show_mother_name boolean NOT NULL DEFAULT false,
  show_dob boolean NOT NULL DEFAULT true,
  show_phone boolean NOT NULL DEFAULT false,
  show_address boolean NOT NULL DEFAULT false,
  show_schedule boolean NOT NULL DEFAULT true,
  show_instructions boolean NOT NULL DEFAULT true,
  instructions_text text,
  signature_labels jsonb NOT NULL DEFAULT '["Principal","Exam Controller"]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admit_card_templates_one_default
  ON admit_card_templates(is_default)
  WHERE is_default = true;

ALTER TABLE admit_card_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read admit_card_templates" ON admit_card_templates;
CREATE POLICY "Authenticated can read admit_card_templates"
  ON admit_card_templates FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage admit_card_templates" ON admit_card_templates;
CREATE POLICY "Admins can manage admit_card_templates"
  ON admit_card_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- RESULT MASTER (Phase 3 — admin-configurable result rules per class+year)
-- ============================================

CREATE TABLE IF NOT EXISTS result_masters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

  -- Basic rules
  pass_mark_mode text NOT NULL DEFAULT 'percentage',
  pass_mark_value numeric(6,2) NOT NULL DEFAULT 33,
  pass_criteria_type text NOT NULL DEFAULT 'all_main_subjects',
  pass_criteria_config jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Display
  show_rank boolean NOT NULL DEFAULT false,
  show_extra_separately boolean NOT NULL DEFAULT true,
  include_non_scholastic boolean NOT NULL DEFAULT false,
  non_scholastic_placement text NOT NULL DEFAULT 'below',

  -- Grading override (NULL = use class_grade_scales or scope default)
  grade_scale_id uuid REFERENCES grade_scales(id) ON DELETE SET NULL,

  -- Grace marks (percentage points; applied before pass check; covers main + optional)
  grace_marks_per_subject_max numeric(5,2) NOT NULL DEFAULT 0,
  grace_marks_total_max numeric(5,2) NOT NULL DEFAULT 0,
  grace_marks_condition text NOT NULL DEFAULT 'failing_only',

  -- Rounding
  rounding_mode text NOT NULL DEFAULT 'none',
  rounding_precision integer NOT NULL DEFAULT 0,
  round_raw_marks boolean NOT NULL DEFAULT false,

  -- Best-of rules (NULL = use all exams of that kind)
  class_test_best_of integer,
  practical_best_of integer,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT result_masters_unique UNIQUE (class_id, academic_year_id),
  CONSTRAINT result_masters_pass_mark_mode_check
    CHECK (pass_mark_mode IN ('percentage', 'raw_marks')),
  CONSTRAINT result_masters_pass_mark_value_check
    CHECK (pass_mark_value >= 0),
  CONSTRAINT result_masters_non_scholastic_placement_check
    CHECK (non_scholastic_placement IN ('below', 'above', 'separate_page')),
  CONSTRAINT result_masters_grace_per_subject_range
    CHECK (grace_marks_per_subject_max >= 0 AND grace_marks_per_subject_max <= 100),
  CONSTRAINT result_masters_grace_total_range
    CHECK (grace_marks_total_max >= 0 AND grace_marks_total_max <= 100),
  CONSTRAINT result_masters_grace_condition_check
    CHECK (grace_marks_condition IN ('failing_only', 'any_subject')),
  CONSTRAINT result_masters_rounding_mode_check
    CHECK (rounding_mode IN ('none', 'half_up', 'half_down', 'ceil', 'floor')),
  CONSTRAINT result_masters_rounding_precision_check
    CHECK (rounding_precision BETWEEN 0 AND 2),
  CONSTRAINT result_masters_class_test_best_of_positive
    CHECK (class_test_best_of IS NULL OR class_test_best_of > 0),
  CONSTRAINT result_masters_practical_best_of_positive
    CHECK (practical_best_of IS NULL OR practical_best_of > 0)
);

CREATE INDEX IF NOT EXISTS idx_result_masters_class_year
  ON result_masters(class_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_result_masters_academic_year
  ON result_masters(academic_year_id);

CREATE TABLE IF NOT EXISTS result_master_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  result_master_id uuid NOT NULL REFERENCES result_masters(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'main',
  pass_mark_value_override numeric(6,2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT result_master_subjects_unique UNIQUE (result_master_id, subject_id),
  CONSTRAINT result_master_subjects_role_check
    CHECK (role IN ('main', 'optional')),
  CONSTRAINT result_master_subjects_override_nonneg
    CHECK (pass_mark_value_override IS NULL OR pass_mark_value_override >= 0)
);

CREATE INDEX IF NOT EXISTS idx_result_master_subjects_master
  ON result_master_subjects(result_master_id);
CREATE INDEX IF NOT EXISTS idx_result_master_subjects_subject
  ON result_master_subjects(subject_id);

ALTER TABLE result_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_master_subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read result_masters" ON result_masters;
CREATE POLICY "Authenticated can read result_masters"
  ON result_masters FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage result_masters" ON result_masters;
CREATE POLICY "Admins can manage result_masters"
  ON result_masters FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can read result_master_subjects" ON result_master_subjects;
CREATE POLICY "Authenticated can read result_master_subjects"
  ON result_master_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage result_master_subjects" ON result_master_subjects;
CREATE POLICY "Admins can manage result_master_subjects"
  ON result_master_subjects FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================
-- NON-SCHOLASTIC ASSESSMENTS (Phase 2 — migration-023)
-- Per-student grade for each non-scholastic sub-subject in a given exam.
-- ============================================

CREATE TABLE IF NOT EXISTS non_scholastic_assessments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  sub_subject_id uuid NOT NULL REFERENCES non_scholastic_sub_subjects(id) ON DELETE CASCADE,
  grade_label text NOT NULL,
  remarks text,
  entered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_assessments_unique
    UNIQUE (student_id, exam_type_id, sub_subject_id)
);

CREATE INDEX IF NOT EXISTS idx_nsa_student ON non_scholastic_assessments(student_id);
CREATE INDEX IF NOT EXISTS idx_nsa_exam ON non_scholastic_assessments(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_nsa_class_exam ON non_scholastic_assessments(class_id, exam_type_id);
CREATE INDEX IF NOT EXISTS idx_nsa_sub_subject ON non_scholastic_assessments(sub_subject_id);

ALTER TABLE non_scholastic_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to non_scholastic_assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Admins full access to non_scholastic_assessments"
  ON non_scholastic_assessments FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can read assessments for their classes"
  ON non_scholastic_assessments FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can insert assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can insert assessments for their classes"
  ON non_scholastic_assessments FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can update assessments for their classes"
  ON non_scholastic_assessments;
CREATE POLICY "Teachers can update assessments for their classes"
  ON non_scholastic_assessments FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Students can read own published assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Students can read own published assessments"
  ON non_scholastic_assessments FOR SELECT
  USING (
    student_id = public.get_my_student_id()
    AND is_published = true
  );

DROP POLICY IF EXISTS "Parents can read children published assessments"
  ON non_scholastic_assessments;
CREATE POLICY "Parents can read children published assessments"
  ON non_scholastic_assessments FOR SELECT
  USING (
    student_id IN (SELECT public.get_my_children_ids())
    AND is_published = true
  );

-- ============================================
-- CLASS TESTS (Phase 3 — migration-024)
-- Dedicated frequent-entry flow for class tests. Sibling of exam_types —
-- exam_types.kind='class_test' lightweight path continues to work for
-- schools that prefer that model.
-- ============================================

CREATE TABLE IF NOT EXISTS class_tests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  test_date date,
  max_marks numeric(5,2) NOT NULL DEFAULT 100,
  weightage numeric(5,2),
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_tests_max_marks_positive CHECK (max_marks > 0),
  CONSTRAINT class_tests_weightage_pct CHECK (
    weightage IS NULL OR (weightage >= 0 AND weightage <= 100)
  )
);

CREATE INDEX IF NOT EXISTS idx_class_tests_class_subject
  ON class_tests(class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_class
  ON class_tests(class_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_date
  ON class_tests(test_date);

CREATE TABLE IF NOT EXISTS class_test_results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  class_test_id uuid NOT NULL REFERENCES class_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks_obtained numeric(5,2) NOT NULL,
  max_marks numeric(5,2) NOT NULL,
  grade text,
  remarks text,
  entered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT class_test_results_unique UNIQUE (class_test_id, student_id),
  CONSTRAINT class_test_results_marks_in_range CHECK (
    marks_obtained >= 0 AND marks_obtained <= max_marks
  )
);

CREATE INDEX IF NOT EXISTS idx_class_test_results_test
  ON class_test_results(class_test_id);
CREATE INDEX IF NOT EXISTS idx_class_test_results_student
  ON class_test_results(student_id);

ALTER TABLE class_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to class_tests" ON class_tests;
CREATE POLICY "Admins full access to class_tests"
  ON class_tests FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read class_tests for their classes" ON class_tests;
CREATE POLICY "Teachers can read class_tests for their classes"
  ON class_tests FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

DROP POLICY IF EXISTS "Teachers can insert class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can insert class_tests for their class-subject combos"
  ON class_tests FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can update class_tests for their class-subject combos"
  ON class_tests FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can delete class_tests for their class-subject combos" ON class_tests;
CREATE POLICY "Teachers can delete class_tests for their class-subject combos"
  ON class_tests FOR DELETE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.class_subjects cs
       WHERE cs.class_id   = class_tests.class_id
         AND cs.subject_id = class_tests.subject_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Students can read own published class_tests" ON class_tests;
CREATE POLICY "Students can read own published class_tests"
  ON class_tests FOR SELECT
  USING (
    is_published = true
    AND class_id IN (
      SELECT class_id FROM student_enrollments
      WHERE student_id = public.get_my_student_id()
        AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Parents can read children published class_tests" ON class_tests;
CREATE POLICY "Parents can read children published class_tests"
  ON class_tests FOR SELECT
  USING (
    is_published = true
    AND class_id IN (
      SELECT class_id FROM student_enrollments
      WHERE student_id IN (SELECT public.get_my_children_ids())
        AND status = 'active'
    )
  );

ALTER TABLE class_test_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to class_test_results" ON class_test_results;
CREATE POLICY "Admins full access to class_test_results"
  ON class_test_results FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read class_test_results for their classes" ON class_test_results;
CREATE POLICY "Teachers can read class_test_results for their classes"
  ON class_test_results FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_test_id IN (
      SELECT id FROM class_tests
      WHERE class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers can insert class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can insert class_test_results for their class-subject combos"
  ON class_test_results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Teachers can update class_test_results for their class-subject combos" ON class_test_results;
CREATE POLICY "Teachers can update class_test_results for their class-subject combos"
  ON class_test_results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
        FROM public.class_tests ct
        JOIN public.class_subjects cs
          ON cs.class_id   = ct.class_id
         AND cs.subject_id = ct.subject_id
       WHERE ct.id = class_test_results.class_test_id
         AND cs.teacher_id = public.get_my_teacher_id()
    )
  );

DROP POLICY IF EXISTS "Students can read own published class_test_results" ON class_test_results;
CREATE POLICY "Students can read own published class_test_results"
  ON class_test_results FOR SELECT
  USING (
    student_id = public.get_my_student_id()
    AND class_test_id IN (SELECT id FROM class_tests WHERE is_published = true)
  );

DROP POLICY IF EXISTS "Parents can read children published class_test_results" ON class_test_results;
CREATE POLICY "Parents can read children published class_test_results"
  ON class_test_results FOR SELECT
  USING (
    student_id IN (SELECT public.get_my_children_ids())
    AND class_test_id IN (SELECT id FROM class_tests WHERE is_published = true)
  );

-- ============================================
-- PUBLISH WORKFLOW (Phase 5 — migration-025)
-- Two-stage publish: online is_published on `results` (stays editable) and
-- finalized PDF snapshots stored in `marksheet_publications`.
-- ============================================

-- `kind = 'per_exam'` (legacy default): one snapshot per exam_type_id,
-- academic_year_id is NULL.
-- `kind = 'year_final'` (migration 033): year-end aggregate; exam_type_id is
-- NULL, academic_year_id carries the year. CHECK enforces the relationship.
CREATE TABLE IF NOT EXISTS marksheet_publications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  -- Migration 041: RESTRICT (was CASCADE) — snapshots are audit-quality and
  -- must not be silently wiped when reference data is deleted.
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE RESTRICT,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'per_exam'
    CHECK (kind IN ('per_exam', 'year_final')),
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  schema_version text NOT NULL DEFAULT 'v1',
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  unpublished_at timestamptz,
  unpublish_reason text,
  unpublished_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT marksheet_publications_version_positive
    CHECK (version > 0),
  CONSTRAINT marksheet_publications_unpublish_consistent
    CHECK (
      (unpublished_at IS NULL AND unpublish_reason IS NULL)
      OR (unpublished_at IS NOT NULL)
    ),
  CONSTRAINT marksheet_publications_kind_consistent
    CHECK (
      (kind = 'per_exam'
        AND exam_type_id IS NOT NULL
        AND academic_year_id IS NULL)
      OR (kind = 'year_final'
        AND exam_type_id IS NULL
        AND academic_year_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_version_unique_per_exam
  ON marksheet_publications(student_id, exam_type_id, version)
  WHERE kind = 'per_exam';
CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_version_unique_year_final
  ON marksheet_publications(student_id, academic_year_id, version)
  WHERE kind = 'year_final';
CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_active_one_per_exam
  ON marksheet_publications(student_id, exam_type_id)
  WHERE kind = 'per_exam' AND unpublished_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marksheet_active_one_year_final
  ON marksheet_publications(student_id, academic_year_id)
  WHERE kind = 'year_final' AND unpublished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_marksheet_class_exam
  ON marksheet_publications(class_id, exam_type_id);
CREATE INDEX IF NOT EXISTS idx_marksheet_student
  ON marksheet_publications(student_id);
CREATE INDEX IF NOT EXISTS idx_marksheet_year_final_year
  ON marksheet_publications(academic_year_id, class_id)
  WHERE kind = 'year_final';

CREATE TABLE IF NOT EXISTS publish_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL CHECK (
    event_type IN (
      'publish_results',
      'unpublish_results',
      'finalize_marksheet',
      'unpublish_marksheet',
      're_finalize_marksheet',
      'finalize_year_final',
      'unpublish_year_final',
      're_finalize_year_final',
      'revert_alumni',
      'admin_audit'
    )
  ),
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  -- Migration 041: SET NULL (was CASCADE) — audit log entries should outlive
  -- the exam type they reference. The note text carries enough context to
  -- understand the event without the FK.
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE SET NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  acted_at timestamptz DEFAULT now(),
  note text
);

CREATE INDEX IF NOT EXISTS idx_publish_events_exam
  ON publish_events(exam_type_id, acted_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_events_student
  ON publish_events(student_id, acted_at DESC);

ALTER TABLE marksheet_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to marksheet_publications" ON marksheet_publications;
CREATE POLICY "Admins full access to marksheet_publications"
  ON marksheet_publications FOR ALL
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read marksheet_publications for their classes" ON marksheet_publications;
CREATE POLICY "Teachers can read marksheet_publications for their classes"
  ON marksheet_publications FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

ALTER TABLE publish_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read publish_events" ON publish_events;
CREATE POLICY "Admins read publish_events"
  ON publish_events FOR SELECT
  USING (public.get_user_role() = 'admin');


-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 025 — Roll Number dynamic reordering (mirrored from scripts/migration-025-roll-number-auto.sql)
-- ═══════════════════════════════════════════════════════════════════════════

-- Migration 025: Roll Number dynamic reordering.
--
-- Replaces the historical NULL-by-default `student_enrollments.roll_number`
-- with an auto-assigned system:
--   * Column `roll_number_manual` lets admins pin a row so auto-recompute
--     never touches it (conservative default for any row already set).
--   * Function `recompute_roll_numbers(class_id, sort_key)` assigns
--     sequential 1..N within the class (section is already baked into
--     `class_id` via UNIQUE(name, section, academic_year_id, stream_id)).
--   * Partial unique index enforces per-class uniqueness for active rows.
--   * Triggers on enrollment INSERT / DELETE, status UPDATE, and student
--     `full_name` UPDATE keep the numbering tight without manual intervention.
--
-- Sort key handling:
--   * `'name'`            → `students.full_name ASC` (alphabetical, default).
--   * `'admission_no'`    → `students.admission_no ASC`.
--   * `'previous_rank'`   → computed by the caller (see
--     `src/lib/final-result.ts::computeRanksForClass`) because rank depends
--     on Phase 4 result-master configuration that is awkward to re-derive in
--     plain SQL. The API route passes an ordered student id list to the
--     companion function `apply_roll_numbers(class_id, ordered_student_ids)`.
--
-- Idempotent: safe to re-run. Triggers and functions use CREATE OR REPLACE.
-- The backfill DO block at the bottom only touches classes that have active
-- enrollments, and the conservative "mark manual on drift" step runs before
-- the mass recompute so existing manual work is preserved.

-- ─── Diagnostic reference (read-only; commented for reference) ──────────────
-- Current roll_number distribution per class (uncomment to inspect):
-- SELECT c.name, c.section, count(*) AS active,
--        count(*) FILTER (WHERE se.roll_number IS NULL) AS null_roll
-- FROM student_enrollments se
-- JOIN classes c ON c.id = se.class_id
-- WHERE se.status = 'active'
-- GROUP BY c.id, c.name, c.section
-- ORDER BY c.sort_order;

-- ─── 1. Column + index ───────────────────────────────────────────────────────

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS roll_number_manual boolean NOT NULL DEFAULT false;

-- Partial unique: (class_id, roll_number) must be unique among active rows.
CREATE UNIQUE INDEX IF NOT EXISTS student_enrollments_class_rollno_active_unique
  ON student_enrollments (class_id, roll_number)
  WHERE status = 'active' AND roll_number IS NOT NULL;

-- ─── 2. Core recompute function ─────────────────────────────────────────────
-- Orders active enrollments for p_class_id by p_sort_key, then assigns
-- sequential numbers 1..N skipping rows with roll_number_manual=true (those
-- keep their current number; the running counter still increments over them
-- to prevent collisions with manual pins).
-- Two-phase update (null out first, then re-number) avoids transient unique
-- violations on the partial index when rows swap numbers.
-- Design choice: `previous_rank` sort is NOT implemented in this function —
-- see apply_roll_numbers() below. Keeps this function dependency-free on the
-- Phase 4 result engine.

CREATE OR REPLACE FUNCTION recompute_roll_numbers(
  p_class_id uuid,
  p_sort_key text DEFAULT 'name'
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter integer := 0;
  v_row RECORD;
  v_taken_manual int[] := ARRAY[]::int[];
  v_updated int := 0;
BEGIN
  IF p_sort_key NOT IN ('name', 'admission_no') THEN
    RAISE EXCEPTION 'recompute_roll_numbers: unsupported sort_key %, allowed: name, admission_no (previous_rank uses apply_roll_numbers)', p_sort_key;
  END IF;

  -- Collect manual pins so the sequential counter can skip those numbers.
  SELECT COALESCE(array_agg(roll_number ORDER BY roll_number), ARRAY[]::int[])
    INTO v_taken_manual
  FROM student_enrollments
  WHERE class_id = p_class_id
    AND status = 'active'
    AND roll_number_manual = true
    AND roll_number IS NOT NULL;

  -- Phase 1: null out all non-manual roll numbers so we can reassign cleanly.
  UPDATE student_enrollments
     SET roll_number = NULL
   WHERE class_id = p_class_id
     AND status = 'active'
     AND roll_number_manual = false;

  -- Phase 2: walk the ordered list and assign the next free number.
  FOR v_row IN
    SELECT se.id, s.full_name, s.admission_no
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = p_class_id
      AND se.status = 'active'
      AND se.roll_number_manual = false
    ORDER BY
      CASE WHEN p_sort_key = 'name'         THEN s.full_name    END ASC NULLS LAST,
      CASE WHEN p_sort_key = 'admission_no' THEN s.admission_no END ASC NULLS LAST,
      s.full_name ASC,
      se.id ASC
  LOOP
    v_counter := v_counter + 1;
    -- Skip any number a manual row already holds.
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_row.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

-- Companion function for `previous_rank` — accepts a caller-computed ordered
-- list of student_ids and applies 1..N to those rows' enrollments in that
-- class. Shares the manual-pin skip logic with recompute_roll_numbers.

CREATE OR REPLACE FUNCTION apply_roll_numbers(
  p_class_id uuid,
  p_ordered_student_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter integer := 0;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_taken_manual int[] := ARRAY[]::int[];
  v_updated int := 0;
BEGIN
  SELECT COALESCE(array_agg(roll_number ORDER BY roll_number), ARRAY[]::int[])
    INTO v_taken_manual
  FROM student_enrollments
  WHERE class_id = p_class_id
    AND status = 'active'
    AND roll_number_manual = true
    AND roll_number IS NOT NULL;

  UPDATE student_enrollments
     SET roll_number = NULL
   WHERE class_id = p_class_id
     AND status = 'active'
     AND roll_number_manual = false;

  -- Apply in caller-supplied order first.
  FOREACH v_student_id IN ARRAY p_ordered_student_ids
  LOOP
    SELECT id INTO v_enrollment_id
    FROM student_enrollments
    WHERE class_id = p_class_id
      AND student_id = v_student_id
      AND status = 'active'
      AND roll_number_manual = false
    LIMIT 1;

    IF v_enrollment_id IS NULL THEN
      CONTINUE;
    END IF;

    v_counter := v_counter + 1;
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_enrollment_id;
    v_updated := v_updated + 1;
  END LOOP;

  -- Any unranked active students (not in p_ordered_student_ids) get numbered
  -- next, alphabetically by full_name — keeps ordering deterministic.
  FOR v_enrollment_id IN
    SELECT se.id
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = p_class_id
      AND se.status = 'active'
      AND se.roll_number_manual = false
      AND se.roll_number IS NULL
    ORDER BY s.full_name ASC, se.id ASC
  LOOP
    v_counter := v_counter + 1;
    WHILE v_counter = ANY(v_taken_manual) LOOP
      v_counter := v_counter + 1;
    END LOOP;

    UPDATE student_enrollments
       SET roll_number = v_counter
     WHERE id = v_enrollment_id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

-- ─── 3. Trigger functions ───────────────────────────────────────────────────

-- INSERT: new enrollment → recompute that class alphabetically.
CREATE OR REPLACE FUNCTION trg_enrollment_insert_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM recompute_roll_numbers(NEW.class_id, 'name');
  END IF;
  RETURN NEW;
END;
$$;

-- DELETE: removed enrollment → recompute that class.
CREATE OR REPLACE FUNCTION trg_enrollment_delete_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' THEN
    PERFORM recompute_roll_numbers(OLD.class_id, 'name');
  END IF;
  RETURN OLD;
END;
$$;

-- UPDATE of status or class_id: recompute both the old and new class if
-- anything affecting roll-number membership changed.
CREATE OR REPLACE FUNCTION trg_enrollment_update_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.class_id IS DISTINCT FROM NEW.class_id THEN
    IF OLD.class_id IS NOT NULL THEN
      PERFORM recompute_roll_numbers(OLD.class_id, 'name');
    END IF;
    IF NEW.class_id IS NOT NULL AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      PERFORM recompute_roll_numbers(NEW.class_id, 'name');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- UPDATE of students.full_name: recompute every active class the student is
-- currently enrolled in.
CREATE OR REPLACE FUNCTION trg_student_name_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_class_id uuid;
BEGIN
  IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    FOR v_class_id IN
      SELECT DISTINCT class_id FROM student_enrollments
      WHERE student_id = NEW.id AND status = 'active'
    LOOP
      PERFORM recompute_roll_numbers(v_class_id, 'name');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Triggers ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS enrollment_after_insert_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_insert_recompute
  AFTER INSERT ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_enrollment_insert_recompute();

DROP TRIGGER IF EXISTS enrollment_after_delete_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_delete_recompute
  AFTER DELETE ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_enrollment_delete_recompute();

DROP TRIGGER IF EXISTS enrollment_after_update_recompute ON student_enrollments;
CREATE TRIGGER enrollment_after_update_recompute
  AFTER UPDATE OF status, class_id ON student_enrollments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.class_id IS DISTINCT FROM NEW.class_id)
  EXECUTE FUNCTION trg_enrollment_update_recompute();

DROP TRIGGER IF EXISTS student_after_name_update_recompute ON students;
CREATE TRIGGER student_after_name_update_recompute
  AFTER UPDATE OF full_name ON students
  FOR EACH ROW
  WHEN (OLD.full_name IS DISTINCT FROM NEW.full_name)
  EXECUTE FUNCTION trg_student_name_recompute();

-- ─── 5. Backfill (idempotent) ───────────────────────────────────────────────
-- Step A: For each class with active enrollments whose current roll-number
-- ordering diverges from alphabetical, mark every row in that class as manual.
-- Conservative: preserves pre-existing manual work (the old NULL-default
-- system allowed admins to hand-enter roll numbers; those numbers should
-- survive the automated migration).
-- Step B: Run recompute_roll_numbers() for every class with active
-- enrollments. Rows now flagged manual keep their numbers; NULL rows get
-- sequential numbers in whatever gaps remain.

DO $$
DECLARE
  v_class RECORD;
  v_alphabetical_order uuid[];
  v_current_order uuid[];
BEGIN
  FOR v_class IN
    SELECT DISTINCT c.id AS class_id
    FROM classes c
    JOIN student_enrollments se ON se.class_id = c.id
    WHERE se.status = 'active'
  LOOP
    -- Alphabetical order of student_ids, nulls last.
    SELECT COALESCE(array_agg(se.student_id ORDER BY s.full_name ASC, se.id ASC), ARRAY[]::uuid[])
      INTO v_alphabetical_order
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.class_id = v_class.class_id
      AND se.status = 'active'
      AND se.roll_number IS NOT NULL;

    -- Current order by existing roll_number.
    SELECT COALESCE(array_agg(se.student_id ORDER BY se.roll_number ASC), ARRAY[]::uuid[])
      INTO v_current_order
    FROM student_enrollments se
    WHERE se.class_id = v_class.class_id
      AND se.status = 'active'
      AND se.roll_number IS NOT NULL;

    -- If diverged (and non-empty), pin everyone in this class as manual.
    IF array_length(v_current_order, 1) IS NOT NULL
       AND v_current_order IS DISTINCT FROM v_alphabetical_order THEN
      UPDATE student_enrollments
         SET roll_number_manual = true
       WHERE class_id = v_class.class_id
         AND status = 'active'
         AND roll_number IS NOT NULL;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_class_id uuid;
BEGIN
  FOR v_class_id IN
    SELECT DISTINCT class_id
    FROM student_enrollments
    WHERE status = 'active'
  LOOP
    PERFORM recompute_roll_numbers(v_class_id, 'name');
  END LOOP;
END $$;
-- Migration 026: Parent-Teacher Meeting notes (Phase 6 Chunk B).
--
-- Two sibling tables:
--   1. `ptm_notes` — one row per (student, meeting_date). Records meeting
--      attendance plus teacher/parent remarks and action points. Teachers
--      create & edit; parents read their own children's notes.
--   2. `school_meeting_counts` — the "Total School Meetings" counter that
--      the legacy platform shows at the top of the PTM grid. Scoped by
--      (academic_year, optional exam_type, optional class) so a school can
--      track year-wide, per-exam, or per-class meeting tallies. Uniqueness
--      over nullable scope columns is enforced via a COALESCE'd unique
--      index (regular UNIQUE constraints can't express this in Postgres).
--
-- RLS in summary:
--   - admins: full access.
--   - teachers: read/write rows for students in their class scope
--     (`public.get_my_class_ids()`).
--   - parents: read-only for their own children (`get_my_children_ids()`).
--   - editors with `ptm_notes` feature key: enforced at the API layer via
--     verifyAdminOrEditor (matches the pattern used by Phase 2/3/5
--     features — SQL-level RLS doesn't know about editor_permissions).

-- =============================================================
-- ptm_notes
-- =============================================================

CREATE TABLE IF NOT EXISTS ptm_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE SET NULL,
  meeting_date date NOT NULL,
  attendance text NOT NULL,
  teacher_remarks text,
  parent_remarks text,
  action_points text,
  recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT ptm_notes_attendance_check
    CHECK (attendance IN ('present', 'absent')),
  CONSTRAINT ptm_notes_unique_per_date UNIQUE (student_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_ptm_notes_student ON ptm_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_ptm_notes_exam ON ptm_notes(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_ptm_notes_date ON ptm_notes(meeting_date DESC);

-- Trigger: refresh updated_at on update.
CREATE OR REPLACE FUNCTION public.ptm_notes_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ptm_notes_set_updated_at ON ptm_notes;
CREATE TRIGGER ptm_notes_set_updated_at
  BEFORE UPDATE ON ptm_notes
  FOR EACH ROW EXECUTE FUNCTION public.ptm_notes_touch_updated_at();

ALTER TABLE ptm_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage ptm_notes" ON ptm_notes;
CREATE POLICY "Admins manage ptm_notes"
  ON ptm_notes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers read ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers read ptm_notes for own classes"
  ON ptm_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers write ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers write ptm_notes for own classes"
  ON ptm_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers update ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers update ptm_notes for own classes"
  ON ptm_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Teachers delete ptm_notes for own classes" ON ptm_notes;
CREATE POLICY "Teachers delete ptm_notes for own classes"
  ON ptm_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = ptm_notes.student_id
        AND se.status = 'active'
        AND se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

DROP POLICY IF EXISTS "Parents read ptm_notes for own children" ON ptm_notes;
CREATE POLICY "Parents read ptm_notes for own children"
  ON ptm_notes FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- =============================================================
-- school_meeting_counts
-- =============================================================

CREATE TABLE IF NOT EXISTS school_meeting_counts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  exam_type_id uuid REFERENCES exam_types(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  total_meetings integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT school_meeting_counts_nonneg CHECK (total_meetings >= 0)
);

-- Uniqueness over nullable scope keys: treat NULL as a sentinel so
-- (year, NULL, NULL) and (year, exam_X, NULL) coexist but duplicates
-- within either slot are rejected.
CREATE UNIQUE INDEX IF NOT EXISTS school_meeting_counts_scope_unique
  ON school_meeting_counts(
    academic_year_id,
    COALESCE(exam_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_year
  ON school_meeting_counts(academic_year_id);

DROP TRIGGER IF EXISTS school_meeting_counts_set_updated_at ON school_meeting_counts;
CREATE TRIGGER school_meeting_counts_set_updated_at
  BEFORE UPDATE ON school_meeting_counts
  FOR EACH ROW EXECUTE FUNCTION public.ptm_notes_touch_updated_at();

ALTER TABLE school_meeting_counts ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user — the counter is displayed on teacher
-- and parent screens alike and has no PII.
DROP POLICY IF EXISTS "Authenticated read school_meeting_counts" ON school_meeting_counts;
CREATE POLICY "Authenticated read school_meeting_counts"
  ON school_meeting_counts FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage school_meeting_counts" ON school_meeting_counts;
CREATE POLICY "Admins manage school_meeting_counts"
  ON school_meeting_counts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers manage school_meeting_counts for own classes" ON school_meeting_counts;
CREATE POLICY "Teachers manage school_meeting_counts for own classes"
  ON school_meeting_counts FOR ALL
  USING (
    -- Year-wide / school-wide rows (class_id NULL) allowed for any teacher
    -- since they reflect institution-level meeting totals.
    class_id IS NULL
    OR class_id IN (SELECT public.get_my_class_ids())
  )
  WITH CHECK (
    class_id IS NULL
    OR class_id IN (SELECT public.get_my_class_ids())
  );
-- Migration 027: PTM Format templates (Phase 6 Chunk C).
--
-- Admin-configurable template for the printable handout given to parents
-- BEFORE a parent-teacher meeting. Separate from `ptm_notes` (which stores
-- post-meeting records) — this is the pre-meeting artifact with:
--   - student header (name, roll, admission no, father/mother, photo)
--   - subject-wise performance snapshot from `results` for a chosen exam
--   - blank space for teacher's face-to-face remarks
--   - parent signature line
--
-- Model mirrors `admit_card_templates` — a thin row of boolean toggles +
-- text knobs, one row per template, with an `is_default` flag so a
-- one-click "generate for class X using the default template" flow works
-- without forcing the admin to pick a template every time. Multiple
-- templates coexist (e.g. one for primary and one for senior) and the
-- default can be toggled via a partial unique index.

CREATE TABLE IF NOT EXISTS ptm_formats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  intro_text text,
  closing_text text,

  show_student_details boolean NOT NULL DEFAULT true,
  show_photo boolean NOT NULL DEFAULT false,
  show_father_name boolean NOT NULL DEFAULT true,
  show_mother_name boolean NOT NULL DEFAULT true,
  show_performance_snapshot boolean NOT NULL DEFAULT true,
  show_teacher_remarks_section boolean NOT NULL DEFAULT true,
  teacher_remarks_lines integer NOT NULL DEFAULT 6,
  show_parent_signature boolean NOT NULL DEFAULT true,

  signature_labels jsonb NOT NULL DEFAULT '["Class Teacher","Parent Signature"]'::jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT ptm_formats_remarks_lines_positive
    CHECK (teacher_remarks_lines >= 0 AND teacher_remarks_lines <= 20)
);

-- Only one default row can be active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ptm_formats_single_default
  ON ptm_formats(is_default)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.ptm_formats_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ptm_formats_set_updated_at ON ptm_formats;
CREATE TRIGGER ptm_formats_set_updated_at
  BEFORE UPDATE ON ptm_formats
  FOR EACH ROW EXECUTE FUNCTION public.ptm_formats_touch_updated_at();

ALTER TABLE ptm_formats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read ptm_formats" ON ptm_formats;
CREATE POLICY "Authenticated read ptm_formats"
  ON ptm_formats FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage ptm_formats" ON ptm_formats;
CREATE POLICY "Admins manage ptm_formats"
  ON ptm_formats FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Seed one default template so the "Download" flow works out of the box
-- before an admin ever opens the Settings page.
INSERT INTO ptm_formats (name, is_default, intro_text, closing_text)
VALUES (
  'Default PTM Format',
  true,
  'Dear Parent, this handout summarises your child''s recent performance. Please bring it to the upcoming parent-teacher meeting for reference and signature.',
  'Thank you for your continued support. We look forward to discussing your child''s progress.'
)
ON CONFLICT (name) DO NOTHING;
-- Migration 028: Supplementary Exam workflow (Phase 8).
--
-- Schools allow students who fail one or two subjects in a main exam to
-- retest those subjects only. Pass criteria for supplementary is usually
-- "minimum X marks in original" (eligibility) and "pass in retest"
-- (qualification). Legacy platform stores these as
--   MinForSupplementary=25, SupplementarySubs=2
-- per Result Master configuration.
--
-- The retest is recorded against the *same* parent_exam_type_id (it's not
-- a new exam type — the supplementary marks substitute into the original
-- exam's slot for purposes of final-result recompute).
--
-- supplementary_pass_action controls how the substitution flows into the
-- final result:
--   - 'cap_at_pass_mark': substitute = pass_mark (most schools — discourages
--     the "save your scores" gaming pattern). Default.
--   - 'use_retest_marks': substitute = actual retest marks_obtained.

-- =============================================================
-- Result Masters: supplementary settings columns
-- =============================================================
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS min_for_supplementary numeric(6,2);
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS max_supplementary_subjects integer NOT NULL DEFAULT 2;
ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS supplementary_pass_action text
    NOT NULL DEFAULT 'cap_at_pass_mark';

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_supp_threshold_nonneg;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_supp_threshold_nonneg
  CHECK (min_for_supplementary IS NULL OR min_for_supplementary >= 0);

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_max_supp_subs_nonneg;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_max_supp_subs_nonneg
  CHECK (max_supplementary_subjects >= 0);

ALTER TABLE result_masters
  DROP CONSTRAINT IF EXISTS result_masters_supp_pass_action_check;
ALTER TABLE result_masters
  ADD CONSTRAINT result_masters_supp_pass_action_check
  CHECK (supplementary_pass_action IN ('cap_at_pass_mark', 'use_retest_marks'));

-- =============================================================
-- supplementary_attempts
-- =============================================================
CREATE TABLE IF NOT EXISTS supplementary_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- M15 (migration 046): flipped to SET NULL so an exam_type cleanup
  -- doesn't destroy the audit trail of supplementary attempts.
  parent_exam_type_id uuid REFERENCES exam_types(id) ON DELETE SET NULL,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  retest_date date,
  marks_obtained numeric(6,2) NOT NULL,
  max_marks numeric(6,2) NOT NULL,
  passed boolean NOT NULL,
  entered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT supplementary_attempts_unique
    UNIQUE (student_id, parent_exam_type_id, subject_id),
  CONSTRAINT supplementary_attempts_marks_range
    CHECK (marks_obtained >= 0 AND marks_obtained <= max_marks),
  CONSTRAINT supplementary_attempts_max_positive
    CHECK (max_marks > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_student
  ON supplementary_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_exam_subject
  ON supplementary_attempts(parent_exam_type_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_class
  ON supplementary_attempts(class_id);

CREATE OR REPLACE FUNCTION public.supplementary_attempts_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplementary_attempts_set_updated_at ON supplementary_attempts;
CREATE TRIGGER supplementary_attempts_set_updated_at
  BEFORE UPDATE ON supplementary_attempts
  FOR EACH ROW EXECUTE FUNCTION public.supplementary_attempts_touch_updated_at();

ALTER TABLE supplementary_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage supplementary_attempts" ON supplementary_attempts;
CREATE POLICY "Admins manage supplementary_attempts"
  ON supplementary_attempts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers read supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers read supplementary_attempts for own classes"
  ON supplementary_attempts FOR SELECT
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers write supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers write supplementary_attempts for own classes"
  ON supplementary_attempts FOR INSERT
  WITH CHECK (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers update supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers update supplementary_attempts for own classes"
  ON supplementary_attempts FOR UPDATE
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Teachers delete supplementary_attempts for own classes" ON supplementary_attempts;
CREATE POLICY "Teachers delete supplementary_attempts for own classes"
  ON supplementary_attempts FOR DELETE
  USING (class_id IN (SELECT public.get_my_class_ids()));

DROP POLICY IF EXISTS "Parents read supplementary_attempts for own children" ON supplementary_attempts;
CREATE POLICY "Parents read supplementary_attempts for own children"
  ON supplementary_attempts FOR SELECT
  USING (student_id IN (SELECT public.get_my_children_ids()));

-- ============================================
-- TEACHER ABSENCES + SUBSTITUTIONS (migration 094)
-- (mirrored from scripts/migrations/erp/migration-094-teacher-substitutions.sql)
-- ============================================
-- Planning layer on top of timetable_periods. teacher_absences records who
-- is absent on which date (with optional half_day flag). substitutions
-- records the per-period substitute assignments (one row per affected
-- period once an admin assigns a substitute; absence of a row = unassigned).
-- Substitute-availability is computed by the API via time-range overlap on
-- timetable_periods.start_time/end_time, since classes can run staggered
-- schedules (period_number alone is not a reliable shared time key).

CREATE TABLE IF NOT EXISTS teacher_absences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  absence_date date NOT NULL,
  half_day text NOT NULL DEFAULT 'full'
    CHECK (half_day IN ('full', 'first_half', 'second_half')),
  reason text,
  marked_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_date
  ON teacher_absences(absence_date);

CREATE INDEX IF NOT EXISTS idx_teacher_absences_teacher
  ON teacher_absences(teacher_id);

CREATE TABLE IF NOT EXISTS substitutions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  absence_id uuid NOT NULL REFERENCES teacher_absences(id) ON DELETE CASCADE,
  timetable_period_id uuid NOT NULL REFERENCES timetable_periods(id) ON DELETE CASCADE,
  substitute_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  note text,
  assigned_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (absence_id, timetable_period_id)
);

CREATE INDEX IF NOT EXISTS idx_substitutions_absence
  ON substitutions(absence_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_substitute_teacher
  ON substitutions(substitute_teacher_id);

CREATE INDEX IF NOT EXISTS idx_substitutions_period
  ON substitutions(timetable_period_id);

CREATE OR REPLACE FUNCTION public.teacher_absences_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_absences_set_updated_at ON teacher_absences;
CREATE TRIGGER teacher_absences_set_updated_at
  BEFORE UPDATE ON teacher_absences
  FOR EACH ROW EXECUTE FUNCTION public.teacher_absences_touch_updated_at();

CREATE OR REPLACE FUNCTION public.substitutions_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS substitutions_set_updated_at ON substitutions;
CREATE TRIGGER substitutions_set_updated_at
  BEFORE UPDATE ON substitutions
  FOR EACH ROW EXECUTE FUNCTION public.substitutions_touch_updated_at();

ALTER TABLE teacher_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage teacher_absences" ON teacher_absences;
CREATE POLICY "Admins manage teacher_absences"
  ON teacher_absences FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

ALTER TABLE substitutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage substitutions" ON substitutions;
CREATE POLICY "Admins manage substitutions"
  ON substitutions FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 034 — exam_schedules timezone documentation
-- ═══════════════════════════════════════════════════════════════════════════
-- (Already applied inline above next to the exam_schedules table.)

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 035 — publish_events admin audit event types
-- ═══════════════════════════════════════════════════════════════════════════
-- (CHECK constraint above already includes the new values.)

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 036 — Clean integer thresholds on default scholastic grade bands
-- (mirrored from scripts/migration-036-grade-bands-clean-bounds.sql)
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 037 — Division labels on the year-end report card
-- (mirrored from scripts/migration-037-result-master-division.sql)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS show_division boolean NOT NULL DEFAULT true;

ALTER TABLE result_masters
  ADD COLUMN IF NOT EXISTS division_scheme text NOT NULL DEFAULT 'cbse';

ALTER TABLE result_masters DROP CONSTRAINT IF EXISTS result_masters_division_scheme_check;
ALTER TABLE result_masters ADD CONSTRAINT result_masters_division_scheme_check
  CHECK (division_scheme IN ('cbse'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 038 — Per-class scoping for non-scholastic sub-subjects
-- (mirrored from scripts/migration-038-non-scholastic-sub-subject-classes.sql)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS non_scholastic_sub_subject_classes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sub_subject_id uuid NOT NULL
    REFERENCES non_scholastic_sub_subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL
    REFERENCES classes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT non_scholastic_sub_subject_classes_unique
    UNIQUE (sub_subject_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subject_classes_sub
  ON non_scholastic_sub_subject_classes(sub_subject_id);
CREATE INDEX IF NOT EXISTS idx_non_scholastic_sub_subject_classes_class
  ON non_scholastic_sub_subject_classes(class_id);

ALTER TABLE non_scholastic_sub_subject_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes;
CREATE POLICY "Authenticated can read non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes;
CREATE POLICY "Admins can manage non_scholastic_sub_subject_classes"
  ON non_scholastic_sub_subject_classes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 039 — Fee lifecycle (waiver / refund / partial / late fee)
-- (mirrored from scripts/migration-039-fee-lifecycle.sql)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS late_fee_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_fixed_amount numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_percent_range;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_percent_range
  CHECK (late_fee_percent >= 0 AND late_fee_percent <= 100);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_fixed_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_fixed_nonneg
  CHECK (late_fee_fixed_amount >= 0);

-- Per-day late fee + optional cap (migration 080). late_fee_fixed_amount above
-- is retained for historical rows but superseded by late_fee_per_day.
ALTER TABLE fee_structures
  ADD COLUMN IF NOT EXISTS late_fee_per_day numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_max numeric(10,2);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_per_day_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_per_day_nonneg
  CHECK (late_fee_per_day >= 0);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_late_fee_max_nonneg;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_late_fee_max_nonneg
  CHECK (late_fee_max IS NULL OR late_fee_max >= 0);

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS waiver_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waiver_reason text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_waiver_amount_nonneg;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_waiver_amount_nonneg
  CHECK (waiver_amount >= 0);

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_refund_consistent;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_refund_consistent
  CHECK (
    (status = 'refunded' AND refund_amount IS NOT NULL AND refund_amount > 0)
    OR (status <> 'refunded' AND refunded_at IS NULL AND refund_amount IS NULL)
  );

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_payment_method_check;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_payment_method_check
  CHECK (
    payment_method IN (
      'cash', 'online', 'cheque', 'bank_transfer', 'upi', 'gateway', 'waiver',
      -- migration-054: the historical Day Book import records payments whose
      -- original tender type the previous software never stored. Omitted from
      -- this mirror until now, so a school provisioned from this file (rather
      -- than by replaying migrations) failed every historical import on this
      -- CHECK. Existing deployments already have it via migration 054.
      'historical_unknown'
    )
  );

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_waiver_consistent;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_waiver_consistent
  CHECK (
    (payment_method = 'waiver'
      AND amount_paid = 0
      AND waiver_amount > 0
      AND waiver_reason IS NOT NULL
      AND length(waiver_reason) > 0)
    OR payment_method <> 'waiver'
  );

CREATE INDEX IF NOT EXISTS idx_fee_payments_refund_status
  ON fee_payments(status)
  WHERE status = 'refunded';

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 040 — Allow waiver rows (amount_paid = 0) past the
-- fee_payments_amount_positive check. Already applied inline above next to
-- the original constraint definition, repeated here so a fresh schema
-- install is guaranteed to be in the relaxed state regardless of statement
-- ordering.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_amount_positive;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_amount_positive CHECK (
  (payment_method = 'waiver' AND amount_paid = 0)
  OR amount_paid > 0
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 041 — marksheet_publications RESTRICT instead of CASCADE on
-- exam_type_id and academic_year_id. Already applied inline above.
-- publish_events.exam_type_id flipped to SET NULL for the same reason.
-- ═══════════════════════════════════════════════════════════════════════════

-- (No-op for fresh installs — schema above already declares the corrected
-- ON DELETE rules. Migration file ships the explicit DROP/ADD CONSTRAINT
-- pair for upgraded deployments.)

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 043 — DB hygiene round 2 (mirrored from
-- scripts/migration-043-db-hygiene-2.sql)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count int;
  v_keep uuid;
BEGIN
  SELECT COUNT(*) INTO v_count FROM academic_years WHERE is_current = true;
  IF v_count > 1 THEN
    SELECT id INTO v_keep
    FROM academic_years
    WHERE is_current = true
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1;
    UPDATE academic_years SET is_current = false
    WHERE is_current = true AND id <> v_keep;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current
  ON academic_years(is_current)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_attendance_marked_by ON attendance(marked_by);
CREATE INDEX IF NOT EXISTS idx_fee_payments_recorded_by ON fee_payments(recorded_by);
CREATE INDEX IF NOT EXISTS idx_fee_payments_fee_structure_id ON fee_payments(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_refunded_by ON fee_payments(refunded_by);
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON calendar_events(created_by);
CREATE INDEX IF NOT EXISTS idx_calendar_events_class_id ON calendar_events(class_id);
CREATE INDEX IF NOT EXISTS idx_registration_requests_reviewed_by ON registration_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_marksheet_publications_published_by ON marksheet_publications(published_by);
CREATE INDEX IF NOT EXISTS idx_marksheet_publications_unpublished_by ON marksheet_publications(unpublished_by);
CREATE INDEX IF NOT EXISTS idx_publish_events_actor_id ON publish_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_publish_events_class_id ON publish_events(class_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_fee_structure_id ON payment_orders(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_parent_id ON payment_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_editor_permissions_granted_by ON editor_permissions(granted_by);
CREATE INDEX IF NOT EXISTS idx_substitutions_assigned_by ON substitutions(assigned_by);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_invigilator_teacher_id ON exam_schedules(invigilator_teacher_id);
CREATE INDEX IF NOT EXISTS idx_results_subject_id ON results(subject_id);
CREATE INDEX IF NOT EXISTS idx_ptm_notes_recorded_by ON ptm_notes(recorded_by);
CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_exam_type_id ON school_meeting_counts(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_school_meeting_counts_class_id ON school_meeting_counts(class_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_subject_id ON supplementary_attempts(subject_id);
CREATE INDEX IF NOT EXISTS idx_supplementary_attempts_entered_by ON supplementary_attempts(entered_by);

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 044 — Payment-method specific details on fee_payments
-- (mirrored from scripts/migration-044-payment-method-details.sql)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS cheque_number    text,
  ADD COLUMN IF NOT EXISTS cheque_date      date,
  ADD COLUMN IF NOT EXISTS bank_name        text,
  ADD COLUMN IF NOT EXISTS payer_name       text,
  ADD COLUMN IF NOT EXISTS transaction_ref  text,
  ADD COLUMN IF NOT EXISTS payment_provider text;

COMMENT ON COLUMN fee_payments.cheque_number IS
  'Cheque instrument number. Required when payment_method=cheque (enforced in API).';
COMMENT ON COLUMN fee_payments.cheque_date IS
  'Date written on the cheque (often differs from payment_date).';
COMMENT ON COLUMN fee_payments.bank_name IS
  'Drawee bank for cheques; originating bank for bank_transfer.';
COMMENT ON COLUMN fee_payments.payer_name IS
  'Name on the instrument or transfer; defaults to student/father if blank.';
COMMENT ON COLUMN fee_payments.transaction_ref IS
  'UTR / NEFT ref / UPI txn id / gateway-side reference for manual online entries.';
COMMENT ON COLUMN fee_payments.payment_provider IS
  'Free-text label for the channel (PhonePe, GPay, Paytm, Razorpay, etc.).';

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 046 — Audit-log FKs flipped to SET NULL (mirrored from
-- scripts/migration-046-audit-fk-set-null.sql). Defensive re-statement so a
-- fresh DB built from this file doesn't need to apply the migration on top.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE supplementary_attempts
  ALTER COLUMN parent_exam_type_id DROP NOT NULL;
ALTER TABLE supplementary_attempts
  DROP CONSTRAINT IF EXISTS supplementary_attempts_parent_exam_type_id_fkey;
ALTER TABLE supplementary_attempts
  ADD CONSTRAINT supplementary_attempts_parent_exam_type_id_fkey
  FOREIGN KEY (parent_exam_type_id) REFERENCES exam_types(id) ON DELETE SET NULL;

ALTER TABLE exam_schedules
  ALTER COLUMN exam_type_id DROP NOT NULL;
ALTER TABLE exam_schedules
  DROP CONSTRAINT IF EXISTS exam_schedules_exam_type_id_fkey;
ALTER TABLE exam_schedules
  ADD CONSTRAINT exam_schedules_exam_type_id_fkey
  FOREIGN KEY (exam_type_id) REFERENCES exam_types(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 045 — updated_at triggers sweep (mirrored from
-- scripts/migration-045-updated-at-triggers-sweep.sql)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'gallery_images',
    'transfer_certificates',
    'disclosure_items',
    'disclosure_documents',
    'disclosure_board_results',
    'site_media',
    'result_master_subjects',
    'class_test_results',
    'non_scholastic_assessments',
    'non_scholastic_sub_subject_classes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'set_updated_at_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'set_updated_at_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 048 — backfill fee_payments.academic_year_id from fee_structures
-- (mirrored from scripts/migration-048-fee-payments-backfill-academic-year.sql)
-- The dues compute filters fee_payments.academic_year_id directly; the POST
-- handlers now also populate it on insert. This statement repairs rows that
-- were inserted before the fix.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE fee_payments fp
SET academic_year_id = fs.academic_year_id
FROM fee_structures fs
WHERE fp.fee_structure_id = fs.id
  AND fp.academic_year_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 049 — School-specific feature requirements
-- (mirrored from scripts/migration-049-school-features.sql)
-- Adds:
--   §4 stream_subjects.requirement_type   (compulsory | elective)
--   §5 student_elective_picks            (per-student E5/E6 picks)
--      elective_slot_options              (admin-editable per-slot subject lists)
--   §6 Mathematics — Standard / Advanced  (seeded as new subjects)
--   §7 Backfill any 'Arts' stream rows to 'Humanities'
--   §8 subjects.category                  (languages | academic | co_curricular)
--   §9 subjects.nickname
--   §2 §3 timetable_templates + timetable_template_periods
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS elective_slot_options (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 9),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  label text,
  applies_to_classes text[] DEFAULT ARRAY['XI','XII']::text[],
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(slot, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_elective_slot_options_slot ON elective_slot_options(slot);

ALTER TABLE elective_slot_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read elective_slot_options"
  ON elective_slot_options FOR SELECT USING (true);

CREATE POLICY "Admins manage elective_slot_options"
  ON elective_slot_options FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- §5 Per-student elective picks.
--
-- CORRECTION: this comment used to claim "the legacy student_subjects table was
-- removed by the ERP redesign". That is false and was actively misleading —
-- student_subjects is alive (see §2k above) and is the ONLY table every report
-- and export reads to answer "what does this student study":
-- lib/student-roster.ts, lib/report-query.ts, api/students/[id]/export.
--
-- The two tables are not alternatives, they are intent and materialization:
--   student_elective_picks  — the choice, carrying `slot`, which
--                             student_subjects cannot express, plus the
--                             UNIQUE(student_id, slot) rule that stops two
--                             picks landing in one slot.
--   student_subjects        — the resolved subject list, keyed by
--                             class_subject_id so reporting can join through
--                             to the class and teacher.
--
-- api/electives/students now writes BOTH in step. Before that it wrote only
-- the pick, so an in-app elective was invisible to every report and export,
-- and filtering a report by an elective silently excluded every student who
-- had chosen it.
CREATE TABLE IF NOT EXISTS student_elective_picks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 9),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_student_elective_picks_student ON student_elective_picks(student_id);
CREATE INDEX IF NOT EXISTS idx_student_elective_picks_subject ON student_elective_picks(subject_id);

ALTER TABLE student_elective_picks ENABLE ROW LEVEL SECURITY;

-- migration-098: authenticated-only. Keyed on student_id, so anon read
-- allowed enumeration of every student UUID and their subject choices.
CREATE POLICY "Authenticated can read student_elective_picks"
  ON student_elective_picks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage student_elective_picks"
  ON student_elective_picks FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE TABLE IF NOT EXISTS timetable_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  description text,
  teaching_period_count integer NOT NULL CHECK (teaching_period_count > 0),
  is_active boolean DEFAULT true,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timetable_template_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid REFERENCES timetable_templates(id) ON DELETE CASCADE NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('teaching', 'lunch', 'break')),
  label text,
  start_time time NOT NULL,
  end_time time NOT NULL,
  UNIQUE(template_id, position),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_template_periods_template
  ON timetable_template_periods(template_id, position);

ALTER TABLE timetable_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_template_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read timetable_templates"
  ON timetable_templates FOR SELECT USING (true);
CREATE POLICY "Admins manage timetable_templates"
  ON timetable_templates FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Public can read timetable_template_periods"
  ON timetable_template_periods FOR SELECT USING (true);
CREATE POLICY "Admins manage timetable_template_periods"
  ON timetable_template_periods FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_timetable_templates_updated_at ON timetable_templates;
    CREATE TRIGGER trg_timetable_templates_updated_at
      BEFORE UPDATE ON timetable_templates
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Backfill stream_subjects.requirement_type from is_mandatory
UPDATE stream_subjects
   SET requirement_type = CASE WHEN is_mandatory THEN 'compulsory' ELSE 'elective' END
 WHERE requirement_type IS NULL;

-- Backfill 'Arts' → 'Humanities' (defensive; seed already uses Humanities)
UPDATE streams
   SET name = 'Humanities', code = COALESCE(code, 'HUM')
 WHERE LOWER(name) = 'arts';

-- Seed Math — Standard / Advanced
INSERT INTO subjects (name, code, nickname, category, is_elective, is_active) VALUES
  ('Mathematics — Standard', '241', 'Math (Std)', 'academic', false, true),
  ('Mathematics — Advanced', '041', 'Math (Adv)', 'academic', false, true)
ON CONFLICT DO NOTHING;

-- Seed the four built-in timetable templates with 20-minute lunch
DO $$
DECLARE v_template_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timetable_templates WHERE code = 'A1') THEN
    INSERT INTO timetable_templates (name, code, description, teaching_period_count, is_system)
    VALUES ('A.1 Regular', 'A1', 'Standard school day — 8 teaching periods with a 20-minute lunch break.', 8, true)
    RETURNING id INTO v_template_id;
    INSERT INTO timetable_template_periods (template_id, position, kind, label, start_time, end_time) VALUES
      (v_template_id, 1, 'teaching', 'Period 1', '08:00', '08:40'),
      (v_template_id, 2, 'teaching', 'Period 2', '08:40', '09:20'),
      (v_template_id, 3, 'teaching', 'Period 3', '09:20', '10:00'),
      (v_template_id, 4, 'teaching', 'Period 4', '10:00', '10:40'),
      (v_template_id, 5, 'lunch',    'Lunch',    '10:40', '11:00'),
      (v_template_id, 6, 'teaching', 'Period 5', '11:00', '11:40'),
      (v_template_id, 7, 'teaching', 'Period 6', '11:40', '12:20'),
      (v_template_id, 8, 'teaching', 'Period 7', '12:20', '13:00'),
      (v_template_id, 9, 'teaching', 'Period 8', '13:00', '13:40');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM timetable_templates WHERE code = 'A2') THEN
    INSERT INTO timetable_templates (name, code, description, teaching_period_count, is_system)
    VALUES ('A.2 Special day', 'A2', 'Half/event day — 6 teaching periods with a 20-minute lunch break.', 6, true)
    RETURNING id INTO v_template_id;
    INSERT INTO timetable_template_periods (template_id, position, kind, label, start_time, end_time) VALUES
      (v_template_id, 1, 'teaching', 'Period 1', '08:00', '08:40'),
      (v_template_id, 2, 'teaching', 'Period 2', '08:40', '09:20'),
      (v_template_id, 3, 'teaching', 'Period 3', '09:20', '10:00'),
      (v_template_id, 4, 'lunch',    'Lunch',    '10:00', '10:20'),
      (v_template_id, 5, 'teaching', 'Period 4', '10:20', '11:00'),
      (v_template_id, 6, 'teaching', 'Period 5', '11:00', '11:40'),
      (v_template_id, 7, 'teaching', 'Period 6', '11:40', '12:20');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM timetable_templates WHERE code = 'A3') THEN
    INSERT INTO timetable_templates (name, code, description, teaching_period_count, is_system)
    VALUES ('A.3 Online — main school', 'A3', 'Online classes I–XII: 5 teaching periods with a 20-minute lunch break.', 5, true)
    RETURNING id INTO v_template_id;
    INSERT INTO timetable_template_periods (template_id, position, kind, label, start_time, end_time) VALUES
      (v_template_id, 1, 'teaching', 'Period 1', '09:00', '09:40'),
      (v_template_id, 2, 'teaching', 'Period 2', '09:40', '10:20'),
      (v_template_id, 3, 'teaching', 'Period 3', '10:20', '11:00'),
      (v_template_id, 4, 'lunch',    'Lunch',    '11:00', '11:20'),
      (v_template_id, 5, 'teaching', 'Period 4', '11:20', '12:00'),
      (v_template_id, 6, 'teaching', 'Period 5', '12:00', '12:40');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM timetable_templates WHERE code = 'A4') THEN
    INSERT INTO timetable_templates (name, code, description, teaching_period_count, is_system)
    VALUES ('A.4 Online — pre-primary', 'A4', 'Online pre-primary: 4 teaching periods with a 20-minute lunch break.', 4, true)
    RETURNING id INTO v_template_id;
    INSERT INTO timetable_template_periods (template_id, position, kind, label, start_time, end_time) VALUES
      (v_template_id, 1, 'teaching', 'Period 1', '09:30', '10:00'),
      (v_template_id, 2, 'teaching', 'Period 2', '10:00', '10:30'),
      (v_template_id, 3, 'lunch',    'Lunch',    '10:30', '10:50'),
      (v_template_id, 4, 'teaching', 'Period 3', '10:50', '11:20'),
      (v_template_id, 5, 'teaching', 'Period 4', '11:20', '11:50');
  END IF;
END $$;

-- Seed default elective slot options (5 = IP/PE, 6 = Hindustani Music/Painting)
DO $$
DECLARE
  v_subject_id uuid;
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('Informatics Practices',     '065', 'IP',          'academic',     5, 1),
      ('Physical Education',        '048', 'PE',          'co_curricular',5, 2),
      ('Hindustani Music (Vocal)',  '034', 'Hind. Music', 'co_curricular',6, 1),
      ('Painting',                  '049', 'Painting',    'co_curricular',6, 2)
    ) AS t(subj_name, subj_code, subj_nick, subj_cat, slot, sort)
  LOOP
    SELECT id INTO v_subject_id FROM subjects WHERE LOWER(name) = LOWER(rec.subj_name) LIMIT 1;
    IF v_subject_id IS NULL THEN
      INSERT INTO subjects (name, code, nickname, category, is_elective, is_active)
      VALUES (rec.subj_name, rec.subj_code, rec.subj_nick, rec.subj_cat, true, true)
      RETURNING id INTO v_subject_id;
    END IF;
    INSERT INTO elective_slot_options (slot, subject_id, label, sort_order)
    VALUES (rec.slot, v_subject_id, 'Elective ' || rec.slot, rec.sort)
    ON CONFLICT (slot, subject_id) DO NOTHING;
  END LOOP;
END $$;

-- Best-effort subject category backfill (admin can edit)
UPDATE subjects SET category = 'languages'
 WHERE category IS NULL
   AND LOWER(name) ~ '(english|hindi|sanskrit|french|german|spanish|urdu|punjabi)';

UPDATE subjects SET category = 'co_curricular'
 WHERE category IS NULL
   AND LOWER(name) ~ '(physical education|art|painting|music|dance|drama|sports|gk|general knowledge|moral|library|computer activity)';

UPDATE subjects SET category = 'academic' WHERE category IS NULL;

-- =============================================================================
-- Default section_cards seed (mirrors migration 051)
-- These rows are protected: is_default=true. The CMS hides delete and exposes
-- a "Reset text to default" action backed by default_snapshot.
-- =============================================================================

INSERT INTO section_cards (section, quote, name, role, initials, sort_order, is_active, is_default, default_snapshot)
SELECT 'testimonials',
  'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
  'Mrs. Sharma', 'Parent of Class VIII student', 'S', 0, true, true,
  jsonb_build_object(
    'quote', 'NK Public School has provided my child with an excellent foundation in academics and extracurricular activities. The teachers are dedicated and the facilities are top-notch.',
    'name', 'Mrs. Sharma', 'role', 'Parent of Class VIII student', 'initials', 'S')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='testimonials');

INSERT INTO section_cards (section, quote, name, role, initials, sort_order, is_active, is_default, default_snapshot)
SELECT 'testimonials',
  'The school''s focus on discipline and holistic development has truly shaped my son''s character. We are grateful for the nurturing environment.',
  'Mr. Patel', 'Parent of Class X student', 'P', 1, true, true,
  jsonb_build_object(
    'quote', 'The school''s focus on discipline and holistic development has truly shaped my son''s character. We are grateful for the nurturing environment.',
    'name', 'Mr. Patel', 'role', 'Parent of Class X student', 'initials', 'P')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='testimonials');

INSERT INTO section_cards (section, quote, name, role, initials, sort_order, is_active, is_default, default_snapshot)
SELECT 'testimonials',
  'From sports to arts, the school ensures every child discovers their talent. The COVID-19 response was also commendable — classes never stopped.',
  'Mrs. Gupta', 'Parent of Class V student', 'G', 2, true, true,
  jsonb_build_object(
    'quote', 'From sports to arts, the school ensures every child discovers their talent. The COVID-19 response was also commendable — classes never stopped.',
    'name', 'Mrs. Gupta', 'role', 'Parent of Class V student', 'initials', 'G')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='testimonials');

INSERT INTO section_cards (section, name, designation, message, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'leadership', 'Dr. N.C. Lunayach', 'Managing Director',
  'Education is the foundation of a brighter future. We strive to provide an environment where every child discovers their potential and grows into responsible citizens.',
  COALESCE((SELECT current_url FROM site_media WHERE slot='leadership_managing_director'), '/images/staff/managing-director.jpg'),
  0, true, true,
  jsonb_build_object(
    'name','Dr. N.C. Lunayach','designation','Managing Director',
    'message','Education is the foundation of a brighter future. We strive to provide an environment where every child discovers their potential and grows into responsible citizens.',
    'image_url','/images/staff/managing-director.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='leadership');

INSERT INTO section_cards (section, name, designation, message, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'leadership', 'Mr. Kuldeep Singh', 'Director',
  'Our institution stands on the pillars of discipline, knowledge and progressive growth. We are committed to creating a world-class educational experience for all students.',
  COALESCE((SELECT current_url FROM site_media WHERE slot='leadership_director'), '/images/staff/director.jpg'),
  1, true, true,
  jsonb_build_object(
    'name','Mr. Kuldeep Singh','designation','Director',
    'message','Our institution stands on the pillars of discipline, knowledge and progressive growth. We are committed to creating a world-class educational experience for all students.',
    'image_url','/images/staff/director.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='leadership');

INSERT INTO section_cards (section, name, designation, message, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'leadership', 'Mrs. Prema Kavia', 'Principal',
  'At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
  COALESCE((SELECT current_url FROM site_media WHERE slot='leadership_principal'), '/images/staff/principal.jpg'),
  2, true, true,
  jsonb_build_object(
    'name','Mrs. Prema Kavia','designation','Principal',
    'message','At NK Public School, we believe every child is unique. Our dedicated faculty ensures holistic development through academic excellence and co-curricular activities.',
    'image_url','/images/staff/principal.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='leadership');

DELETE FROM site_media WHERE slot IN ('leadership_managing_director','leadership_director','leadership_principal');

-- =============================================================================
-- Phase 2 default section_cards seed (mirrors migrations 052–058)
-- =============================================================================

-- 053: hero_slider
INSERT INTO section_cards (section, title, subtitle, cta_text, cta_link, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'hero_slider', E'Best CBSE School\nin Jaipur', 'Empowering young minds with holistic education since 1985',
  'Explore Admissions', '/admissions',
  COALESCE((SELECT current_url FROM site_media WHERE slot='hero_slide_1'), '/images/hero/campus-1.jpg'),
  0, true, true,
  jsonb_build_object('title', E'Best CBSE School\nin Jaipur',
    'subtitle','Empowering young minds with holistic education since 1985',
    'cta_text','Explore Admissions','cta_link','/admissions','image_url','/images/hero/campus-1.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='hero_slider');

INSERT INTO section_cards (section, title, subtitle, cta_text, cta_link, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'hero_slider', E'Excellence in\nCBSE Education', 'CBSE affiliated institution nurturing 20,000+ students across Jaipur',
  'Learn More', '/about',
  COALESCE((SELECT current_url FROM site_media WHERE slot='hero_slide_2'), '/images/hero/campus-2.avif'),
  1, true, true,
  jsonb_build_object('title', E'Excellence in\nCBSE Education',
    'subtitle','CBSE affiliated institution nurturing 20,000+ students across Jaipur',
    'cta_text','Learn More','cta_link','/about','image_url','/images/hero/campus-2.avif')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='hero_slider');

INSERT INTO section_cards (section, title, subtitle, cta_text, cta_link, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'hero_slider', E'Leaders Are\nMade Here', 'Building character through discipline, education and human values',
  'Discover More', '/academics',
  COALESCE((SELECT current_url FROM site_media WHERE slot='hero_slide_3'), '/images/news/n5.jpg'),
  2, true, true,
  jsonb_build_object('title', E'Leaders Are\nMade Here',
    'subtitle','Building character through discipline, education and human values',
    'cta_text','Discover More','cta_link','/academics','image_url','/images/news/n5.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='hero_slider');

DELETE FROM site_media WHERE slot IN ('hero_slide_1','hero_slide_2','hero_slide_3');

-- 054: facilities_preview
INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'facilities_preview', 'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_preview_1'), '/images/news/n1.jpg'),
  0, true, true,
  jsonb_build_object('title','Smart Classrooms',
    'description','Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon','Monitor','image_url','/images/news/n1.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='facilities_preview');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'facilities_preview', 'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_preview_2'), '/images/news/n2.jpg'),
  1, true, true,
  jsonb_build_object('title','Science Laboratories',
    'description','Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon','FlaskConical','image_url','/images/news/n2.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='facilities_preview');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'facilities_preview', 'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_preview_3'), '/images/news/n4.jpg'),
  2, true, true,
  jsonb_build_object('title','Computer Lab',
    'description','Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon','Laptop','image_url','/images/news/n4.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='facilities_preview');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'facilities_preview', 'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_preview_4'), '/images/news/n6.jpg'),
  3, true, true,
  jsonb_build_object('title','Library',
    'description','A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon','BookOpen','image_url','/images/news/n6.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='facilities_preview');

DELETE FROM site_media WHERE slot IN ('facilities_preview_1','facilities_preview_2','facilities_preview_3','facilities_preview_4');

-- 055: why_choose_us
INSERT INTO section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
SELECT 'why_choose_us', 'Experienced Faculty',
  'Our faculty brings years of experience in delivering quality education across all subjects.',
  'Award', 0, true, true,
  jsonb_build_object('title','Experienced Faculty',
    'description','Our faculty brings years of experience in delivering quality education across all subjects.',
    'icon','Award')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='why_choose_us');

INSERT INTO section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
SELECT 'why_choose_us', 'Holistic Curriculum',
  'Balanced approach combining academics with sports, arts, and character development.',
  'BookOpen', 1, true, true,
  jsonb_build_object('title','Holistic Curriculum',
    'description','Balanced approach combining academics with sports, arts, and character development.',
    'icon','BookOpen')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='why_choose_us');

INSERT INTO section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
SELECT 'why_choose_us', 'Smart Classrooms',
  'Equipped with modern teaching technologies for interactive and engaging learning.',
  'Monitor', 2, true, true,
  jsonb_build_object('title','Smart Classrooms',
    'description','Equipped with modern teaching technologies for interactive and engaging learning.',
    'icon','Monitor')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='why_choose_us');

INSERT INTO section_cards (section, title, description, icon, sort_order, is_active, is_default, default_snapshot)
SELECT 'why_choose_us', '100% Board Results',
  'We are proud of our consistent academic performance in CBSE board examinations.',
  'Trophy', 3, true, true,
  jsonb_build_object('title','100% Board Results',
    'description','We are proud of our consistent academic performance in CBSE board examinations.',
    'icon','Trophy')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='why_choose_us');

-- 056: legacy_timeline
INSERT INTO section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'legacy_timeline', '1985', 'Foundation',
  'NK Public School established by Late Shri R.K. Choudhary with just 10 students.',
  0, true, true,
  jsonb_build_object('year','1985','title','Foundation',
    'description','NK Public School established by Late Shri R.K. Choudhary with just 10 students.')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='legacy_timeline');

INSERT INTO section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'legacy_timeline', '1990', 'CBSE Affiliation',
  'Received affiliation from CBSE, marking a new chapter in academic excellence.',
  1, true, true,
  jsonb_build_object('year','1990','title','CBSE Affiliation',
    'description','Received affiliation from CBSE, marking a new chapter in academic excellence.')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='legacy_timeline');

INSERT INTO section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'legacy_timeline', '2000', 'Campus Expansion',
  'New buildings, laboratories, and sports facilities added to serve growing student body.',
  2, true, true,
  jsonb_build_object('year','2000','title','Campus Expansion',
    'description','New buildings, laboratories, and sports facilities added to serve growing student body.')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='legacy_timeline');

INSERT INTO section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'legacy_timeline', '2010', 'Digital Era',
  'Smart classrooms and computer labs introduced for technology-integrated learning.',
  3, true, true,
  jsonb_build_object('year','2010','title','Digital Era',
    'description','Smart classrooms and computer labs introduced for technology-integrated learning.')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='legacy_timeline');

INSERT INTO section_cards (section, year, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'legacy_timeline', '2024', '20000+ Students',
  'Grown into one of Jaipur''s leading institutions with 6 educational institutes.',
  4, true, true,
  jsonb_build_object('year','2024','title','20000+ Students',
    'description','Grown into one of Jaipur''s leading institutions with 6 educational institutes.')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='legacy_timeline');

-- 057: activities + annual_events
INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Music & Dance', 'Express creativity through classical and contemporary performances',
  'Music', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_music_dance'), '/images/gallery/st1.jpg'),
  0, true, true,
  jsonb_build_object('title','Music & Dance','description','Express creativity through classical and contemporary performances',
    'icon','Music','image_url','/images/gallery/st1.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Art & Craft', 'Develop artistic skills through painting, sculpture and design',
  'Palette', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_art_craft'), '/images/gallery/st2.jpg'),
  1, true, true,
  jsonb_build_object('title','Art & Craft','description','Develop artistic skills through painting, sculpture and design',
    'icon','Palette','image_url','/images/gallery/st2.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Debate & Elocution', 'Build confidence and critical thinking through public speaking',
  'MessageSquare', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_debate'), '/images/gallery/st3.jpg'),
  2, true, true,
  jsonb_build_object('title','Debate & Elocution','description','Build confidence and critical thinking through public speaking',
    'icon','MessageSquare','image_url','/images/gallery/st3.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Quiz Competitions', 'Sharpen knowledge and analytical skills in academic quizzes',
  'Brain', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_quiz'), '/images/gallery/st4.jpg'),
  3, true, true,
  jsonb_build_object('title','Quiz Competitions','description','Sharpen knowledge and analytical skills in academic quizzes',
    'icon','Brain','image_url','/images/gallery/st4.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Literary Club', 'Nurture love for reading and creative writing',
  'BookOpen', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_literary'), '/images/gallery/st5.jpg'),
  4, true, true,
  jsonb_build_object('title','Literary Club','description','Nurture love for reading and creative writing',
    'icon','BookOpen','image_url','/images/gallery/st5.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'activities', 'Science Club', 'Hands-on experiments and innovation projects',
  'Cpu', COALESCE((SELECT current_url FROM site_media WHERE slot='student_life_science'), '/images/gallery/st6.jpg'),
  5, true, true,
  jsonb_build_object('title','Science Club','description','Hands-on experiments and innovation projects',
    'icon','Cpu','image_url','/images/gallery/st6.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='activities');

INSERT INTO section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'annual_events', 'Winter', 'Annual Day',
  'A grand celebration of talent, culture and achievement featuring performances by students from all grades',
  0, true, true,
  jsonb_build_object('season','Winter','title','Annual Day',
    'description','A grand celebration of talent, culture and achievement featuring performances by students from all grades')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='annual_events');

INSERT INTO section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'annual_events', 'Monsoon', 'Sports Day (Chakravyuh)',
  'Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness',
  1, true, true,
  jsonb_build_object('season','Monsoon','title','Sports Day (Chakravyuh)',
    'description','Inter-house athletic competitions and team sports fostering sportsmanship and physical fitness')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='annual_events');

INSERT INTO section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'annual_events', 'Spring', 'Republic & Independence Day',
  'Patriotic celebrations with cultural programmes, flag hoisting and community participation',
  2, true, true,
  jsonb_build_object('season','Spring','title','Republic & Independence Day',
    'description','Patriotic celebrations with cultural programmes, flag hoisting and community participation')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='annual_events');

INSERT INTO section_cards (section, season, title, description, sort_order, is_active, is_default, default_snapshot)
SELECT 'annual_events', 'Autumn', 'Science Exhibition',
  'Student-led innovations and project displays showcasing creativity and scientific temper',
  3, true, true,
  jsonb_build_object('season','Autumn','title','Science Exhibition',
    'description','Student-led innovations and project displays showcasing creativity and scientific temper')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='annual_events');

DELETE FROM site_media WHERE slot IN ('student_life_music_dance','student_life_art_craft','student_life_debate','student_life_quiz','student_life_literary','student_life_science');

-- 058: campus_facilities (8 cards). First 4 read from facilities_preview cards
-- (set by 054), then fall back to the original slot if 054 hasn't run yet.
INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Smart Classrooms',
  'Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
  'Monitor',
  COALESCE(
    (SELECT image_url FROM section_cards WHERE section='facilities_preview'),
    (SELECT current_url FROM site_media WHERE slot='facilities_preview_1'),
    '/images/news/n1.jpg'),
  0, true, true,
  jsonb_build_object('title','Smart Classrooms',
    'description','Technology-enabled classrooms with projectors and digital learning aids for an interactive educational experience.',
    'icon','Monitor','image_url','/images/news/n1.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Science Laboratories',
  'Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
  'FlaskConical',
  COALESCE(
    (SELECT image_url FROM section_cards WHERE section='facilities_preview'),
    (SELECT current_url FROM site_media WHERE slot='facilities_preview_2'),
    '/images/news/n2.jpg'),
  1, true, true,
  jsonb_build_object('title','Science Laboratories',
    'description','Well-equipped Physics, Chemistry and Biology labs providing hands-on learning opportunities for students.',
    'icon','FlaskConical','image_url','/images/news/n2.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Computer Lab',
  'Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
  'Laptop',
  COALESCE(
    (SELECT image_url FROM section_cards WHERE section='facilities_preview'),
    (SELECT current_url FROM site_media WHERE slot='facilities_preview_3'),
    '/images/news/n4.jpg'),
  2, true, true,
  jsonb_build_object('title','Computer Lab',
    'description','Modern computer lab with high-speed internet and latest software for digital literacy and programming skills.',
    'icon','Laptop','image_url','/images/news/n4.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Library',
  'A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
  'BookOpen',
  COALESCE(
    (SELECT image_url FROM section_cards WHERE section='facilities_preview'),
    (SELECT current_url FROM site_media WHERE slot='facilities_preview_4'),
    '/images/news/n6.jpg'),
  3, true, true,
  jsonb_build_object('title','Library',
    'description','A vast collection of over 10,000 books, periodicals and digital resources fostering a love for reading.',
    'icon','BookOpen','image_url','/images/news/n6.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Sports Grounds',
  'Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
  'Trophy', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_sports'), '/images/news/n7.jpg'),
  4, true, true,
  jsonb_build_object('title','Sports Grounds',
    'description','Expansive playgrounds with facilities for cricket, football, basketball, athletics and more.',
    'icon','Trophy','image_url','/images/news/n7.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Auditorium',
  'State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
  'Theater', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_auditorium'), '/images/news/n3.jpg'),
  5, true, true,
  jsonb_build_object('title','Auditorium',
    'description','State-of-the-art auditorium for cultural events, annual functions and academic seminars.',
    'icon','Theater','image_url','/images/news/n3.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Indoor Games',
  'Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
  'Gamepad2', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_indoor_games'), '/images/news/n5.jpg'),
  6, true, true,
  jsonb_build_object('title','Indoor Games',
    'description','Dedicated spaces for table tennis, chess, carrom and other indoor recreational activities.',
    'icon','Gamepad2','image_url','/images/news/n5.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

INSERT INTO section_cards (section, title, description, icon, image_url, sort_order, is_active, is_default, default_snapshot)
SELECT 'campus_facilities', 'Transport',
  'Safe and reliable school bus transport covering major routes across Jaipur city.',
  'Bus', COALESCE((SELECT current_url FROM site_media WHERE slot='facilities_transport'), '/images/gallery/g10.jpg'),
  7, true, true,
  jsonb_build_object('title','Transport',
    'description','Safe and reliable school bus transport covering major routes across Jaipur city.',
    'icon','Bus','image_url','/images/gallery/g10.jpg')
WHERE NOT EXISTS (SELECT 1 FROM section_cards WHERE section='campus_facilities');

DELETE FROM site_media WHERE slot IN ('facilities_sports','facilities_auditorium','facilities_indoor_games','facilities_transport');

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 074: Stop-based transport (fleet, routes, drivers, change workflow)
-- Replaces the distance/slab model (migrations 050/053/055/063). The fee
-- attaches to a bus STOP; every student boarding there pays that stop's flat
-- monthly fee. Buses carry a driver (staff category busDriver) and serve a set
-- of stops (bus_route_stops). transport_change_requests is the office/parent
-- amendment workflow. Seed of the 188 stops + 2025-26 fees lives in migration 075.
-- ─────────────────────────────────────────────────────────────────────────────

-- Stable stop registry (name = identity; priced per year in bus_stop_fees).
CREATE TABLE IF NOT EXISTS bus_stops (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  area        text,
  lat         numeric(10,7),
  lng         numeric(10,7),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bus_stops_active ON bus_stops(is_active) WHERE is_active;

-- Per-academic-year flat fee for a stop (re-priced yearly; stop is stable).
CREATE TABLE IF NOT EXISTS bus_stop_fees (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_stop_id       uuid NOT NULL REFERENCES bus_stops(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  frequency         text NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly','quarterly','annual','one_time')),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (bus_stop_id, academic_year_id)
);
CREATE INDEX IF NOT EXISTS idx_bus_stop_fees_year ON bus_stop_fees(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_bus_stop_fees_stop ON bus_stop_fees(bus_stop_id);

-- Vehicle registry (source of the Bus No. dropdown). Driver = busDriver staff.
CREATE TABLE IF NOT EXISTS buses (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_number          text NOT NULL UNIQUE,
  registration_number text,
  capacity            integer CHECK (capacity IS NULL OR capacity > 0),
  driver_id           uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  conductor_id        uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buses_active ON buses(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_buses_driver ON buses(driver_id) WHERE driver_id IS NOT NULL;

-- Route: which stops each bus serves (narrows the bus picker per stop).
CREATE TABLE IF NOT EXISTS bus_route_stops (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bus_id       uuid NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  bus_stop_id  uuid NOT NULL REFERENCES bus_stops(id) ON DELETE CASCADE,
  sort_order   integer,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (bus_id, bus_stop_id)
);
CREATE INDEX IF NOT EXISTS idx_bus_route_stops_bus ON bus_route_stops(bus_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_stops_stop ON bus_route_stops(bus_stop_id);

-- Enrollment transport assignment: stop drives the fee; direction = one-side
-- facility (school-only) with a required custom amount.
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS bus_stop_id uuid REFERENCES bus_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bus_id uuid REFERENCES buses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transport_direction text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS transport_fee_override numeric(10,2);

ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS chk_transport_direction;
ALTER TABLE student_enrollments ADD CONSTRAINT chk_transport_direction
  CHECK (transport_direction IN ('both','pickup_only','drop_only'));

ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_bus_stop_required;
ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_bus_stop_required
  CHECK (has_transport = false OR bus_stop_id IS NOT NULL);

ALTER TABLE student_enrollments DROP CONSTRAINT IF EXISTS chk_one_side_fee_override;
ALTER TABLE student_enrollments ADD CONSTRAINT chk_one_side_fee_override
  CHECK (transport_direction = 'both' OR transport_fee_override IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_enrollments_bus_stop_id
  ON student_enrollments(bus_stop_id) WHERE bus_stop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_bus_id
  ON student_enrollments(bus_id) WHERE bus_id IS NOT NULL;

-- fee_payments: a transport receipt targets a bus_stop (XOR with fee_structure).
ALTER TABLE fee_payments ALTER COLUMN fee_structure_id DROP NOT NULL;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS bus_stop_id uuid REFERENCES bus_stops(id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_bus_stop_id
  ON fee_payments(bus_stop_id) WHERE bus_stop_id IS NOT NULL;
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_target_xor;
ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_target_xor
  CHECK (
    (fee_structure_id IS NOT NULL AND bus_stop_id IS NULL)
    OR (fee_structure_id IS NULL AND bus_stop_id IS NOT NULL)
  );

-- Amendment workflow (bus change / stop change / one-side / drop), office+parent.
CREATE TABLE IF NOT EXISTS transport_change_requests (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id   uuid NOT NULL REFERENCES student_enrollments(id) ON DELETE CASCADE,
  change_type     text NOT NULL
                  CHECK (change_type IN ('bus_change','stop_change','direction_change','drop','resume')),
  previous_bus_id  uuid REFERENCES buses(id) ON DELETE SET NULL,
  amended_bus_id   uuid REFERENCES buses(id) ON DELETE SET NULL,
  previous_stop_id uuid REFERENCES bus_stops(id) ON DELETE SET NULL,
  amended_stop_id  uuid REFERENCES bus_stops(id) ON DELETE SET NULL,
  direction       text CHECK (direction IS NULL OR direction IN ('both','pickup_only','drop_only')),
  effective_from  date NOT NULL,
  effective_to    date,
  reason_code     text NOT NULL
                  CHECK (reason_code IN (
                    'house_shifting','rented_house_change','bus_point_temporary_change',
                    'facility_dropped','one_side_facility','other')),
  reason_note     text,
  application_url text,
  source          text NOT NULL CHECK (source IN ('office','parent')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled','applied')),
  requested_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT chk_tcr_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_tcr_reason_note CHECK (
    reason_code <> 'other'
    OR (reason_note IS NOT NULL AND length(btrim(reason_note)) >= 3)),
  CONSTRAINT chk_tcr_direction_office CHECK (change_type <> 'direction_change' OR source = 'office')
);
CREATE INDEX IF NOT EXISTS idx_tcr_enrollment ON transport_change_requests(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_tcr_pending ON transport_change_requests(status) WHERE status = 'pending';

-- updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_bus_stops ON bus_stops;
CREATE TRIGGER set_updated_at_bus_stops BEFORE UPDATE ON bus_stops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_bus_stop_fees ON bus_stop_fees;
CREATE TRIGGER set_updated_at_bus_stop_fees BEFORE UPDATE ON bus_stop_fees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_buses ON buses;
CREATE TRIGGER set_updated_at_buses BEFORE UPDATE ON buses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_transport_change_requests ON transport_change_requests;
CREATE TRIGGER set_updated_at_transport_change_requests BEFORE UPDATE ON transport_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: fleet/stop tables public-read + admin-write; change requests admin-full
-- with parent/student read of their own child's rows.
ALTER TABLE bus_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_stop_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_change_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bus_stops','bus_stop_fees','buses','bus_route_stops'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Public can read %1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "Public can read %1$s" ON %1$s FOR SELECT USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins write %1$s" ON %1$s', t);
    EXECUTE format($p$CREATE POLICY "Admins write %1$s" ON %1$s FOR ALL
      USING (public.get_user_role() = 'admin')
      WITH CHECK (public.get_user_role() = 'admin')$p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Admins full access transport changes" ON transport_change_requests;
CREATE POLICY "Admins full access transport changes"
  ON transport_change_requests FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Parents read own child transport changes" ON transport_change_requests;
CREATE POLICY "Parents read own child transport changes"
  ON transport_change_requests FOR SELECT
  USING (enrollment_id IN (
    SELECT se.id FROM student_enrollments se
    WHERE se.student_id IN (SELECT public.get_my_children_ids())));

DROP POLICY IF EXISTS "Students read own transport changes" ON transport_change_requests;
CREATE POLICY "Students read own transport changes"
  ON transport_change_requests FOR SELECT
  USING (enrollment_id IN (
    SELECT se.id FROM student_enrollments se
    WHERE se.student_id = public.get_my_student_id()));

-- =============================================================================
-- Migration 068 — Identity & cross-role linking integrity
-- (UNIQUE link indexes + role↔link trigger are mirrored inline above, next to
--  the profiles table/indexes and the guard_profile_privileged_cols trigger.)
-- =============================================================================

-- Deprecate the table-level relationship; student_parents.relationship is the
-- authoritative per-link source of truth.
COMMENT ON COLUMN public.parents.relationship IS
  'DEPRECATED (migration 068). The authoritative relationship lives per-link in '
  'student_parents.relationship. This column is retained only for backward '
  'compatibility and must not be read by application code.';

-- Link-health view: one row per cross-role linking anomaly. ERROR categories
-- (orphaned_profile, role_link_mismatch, duplicate_*_claim) must be resolved;
-- INFO categories are onboarding signals. Read via GET /api/admin/link-health.
CREATE OR REPLACE VIEW public.profile_link_health AS
  SELECT 'orphaned_profile'::text AS category,
         p.id::text               AS subject_id,
         COALESCE(p.full_name, p.email) AS subject_label,
         ('role=' || p.role || ' but ' || p.role || '_id is NULL') AS detail
  FROM public.profiles p
  WHERE (p.role = 'teacher' AND p.teacher_id IS NULL)
     OR (p.role = 'parent'  AND p.parent_id  IS NULL)
  UNION ALL
  SELECT 'unclaimed_student', p.id::text, COALESCE(p.full_name, p.email),
         'role=student but student_id is NULL (awaiting self-link)'
  FROM public.profiles p
  WHERE p.role = 'student' AND p.student_id IS NULL
  UNION ALL
  SELECT 'role_link_mismatch', p.id::text, COALESCE(p.full_name, p.email),
         'non-null link inconsistent with role=' || p.role
  FROM public.profiles p
  WHERE (p.student_id IS NOT NULL AND p.role <> 'student')
     OR (p.parent_id  IS NOT NULL AND p.role <> 'parent')
     OR (p.teacher_id IS NOT NULL AND p.role NOT IN ('teacher', 'admin'))
  UNION ALL
  SELECT 'duplicate_teacher_claim', p.teacher_id::text, t.full_name,
         count(*) || ' accounts linked to this teacher record'
  FROM public.profiles p JOIN public.teachers t ON t.id = p.teacher_id
  WHERE p.teacher_id IS NOT NULL
  GROUP BY p.teacher_id, t.full_name HAVING count(*) > 1
  UNION ALL
  SELECT 'duplicate_student_claim', p.student_id::text, s.full_name,
         count(*) || ' accounts linked to this student record'
  FROM public.profiles p JOIN public.students s ON s.id = p.student_id
  WHERE p.student_id IS NOT NULL
  GROUP BY p.student_id, s.full_name HAVING count(*) > 1
  UNION ALL
  SELECT 'duplicate_parent_claim', p.parent_id::text, pa.full_name,
         count(*) || ' accounts linked to this parent record'
  FROM public.profiles p JOIN public.parents pa ON pa.id = p.parent_id
  WHERE p.parent_id IS NOT NULL
  GROUP BY p.parent_id, pa.full_name HAVING count(*) > 1
  UNION ALL
  SELECT 'parent_without_children', pa.id::text, pa.full_name,
         'active parent record has no student_parents links'
  FROM public.parents pa
  WHERE COALESCE(pa.is_active, true)
    AND NOT EXISTS (SELECT 1 FROM public.student_parents sp WHERE sp.parent_id = pa.id)
  UNION ALL
  SELECT 'student_without_guardian_account', s.id::text, s.full_name,
         'active student has no linked parent with a portal account'
  FROM public.students s
  WHERE COALESCE(s.is_active, true) AND NOT COALESCE(s.is_alumni, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.student_parents sp
      JOIN public.profiles p ON p.parent_id = sp.parent_id
      WHERE sp.student_id = s.id
    );

COMMENT ON VIEW public.profile_link_health IS
  'Cross-role linking anomalies. ERROR categories (orphaned_profile, '
  'role_link_mismatch, duplicate_*_claim) must be resolved; INFO categories '
  '(unclaimed_student, parent_without_children, student_without_guardian_account) '
  'are onboarding signals. Read via GET /api/admin/link-health.';

-- =============================================================================
-- Migration 069 — Timetable ↔ class_subjects teacher-assignment drift
-- class_subjects is the canonical teacher↔subject authority; this view surfaces
-- timetable periods whose teacher differs, for reconciliation.
-- =============================================================================
CREATE OR REPLACE VIEW public.timetable_assignment_drift AS
  SELECT tp.id              AS timetable_period_id,
         tp.class_id,
         c.name             AS class_name,
         c.section          AS class_section,
         tp.subject_id,
         s.name             AS subject_name,
         tp.day_of_week,
         tp.period_number,
         tp.teacher_id      AS timetable_teacher_id,
         tt.full_name       AS timetable_teacher_name,
         cs.teacher_id      AS canonical_teacher_id,
         ct.full_name       AS canonical_teacher_name
  FROM public.timetable_periods tp
  JOIN public.class_subjects cs
    ON cs.class_id = tp.class_id AND cs.subject_id = tp.subject_id
  LEFT JOIN public.classes  c  ON c.id  = tp.class_id
  LEFT JOIN public.subjects s  ON s.id  = tp.subject_id
  LEFT JOIN public.teachers tt ON tt.id = tp.teacher_id
  LEFT JOIN public.teachers ct ON ct.id = cs.teacher_id
  WHERE tp.is_break IS NOT TRUE
    -- migration 119: groups 1..n are parallel tracks with their own teachers.
    -- They differ from the canonical assignment by design, not by drift.
    AND tp.group_no = 0
    AND tp.teacher_id IS DISTINCT FROM cs.teacher_id;

-- Owner-rights view keyed on a teacher; see timetable_teacher_clashes.
REVOKE ALL ON public.timetable_assignment_drift FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_assignment_drift TO authenticated;

COMMENT ON VIEW public.timetable_assignment_drift IS
  'Timetable periods whose teacher differs from the canonical class_subjects '
  'assignment for the same (class, subject). class_subjects is authoritative '
  '(migration 069); rows here are drift to reconcile (or legitimate cover).';

-- =============================================================================
-- MIGRATION 072 — Student UDISE+ profile columns (General + Enrolment template)
-- Mirrors scripts/migrations/erp/migration-072-student-profile-udise.sql
-- =============================================================================

ALTER TABLE students
  -- ── General Profile ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS name_as_per_aadhar text,
  ADD COLUMN IF NOT EXISTS jan_aadhar_number text,
  ADD COLUMN IF NOT EXISTS mother_occupation text,
  ADD COLUMN IF NOT EXISTS mother_qualification text,
  ADD COLUMN IF NOT EXISTS mother_mobile text,
  ADD COLUMN IF NOT EXISTS mother_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS father_occupation text,
  ADD COLUMN IF NOT EXISTS father_qualification text,
  ADD COLUMN IF NOT EXISTS father_mobile text,
  ADD COLUMN IF NOT EXISTS father_annual_income numeric(12, 2),
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_relation text,
  ADD COLUMN IF NOT EXISTS guardian_mobile text,
  -- `address` (existing) is the Present Address; pincodes are separate so
  -- the template's "Address + Pin Code" sub-fields round-trip losslessly.
  ADD COLUMN IF NOT EXISTS present_pincode text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS permanent_pincode text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  -- Distinct from `religion`: the template's Minority Group is a fixed
  -- administrative list (incl. 'none'), not free-text religion.
  ADD COLUMN IF NOT EXISTS minority_group text,
  ADD COLUMN IF NOT EXISTS is_bpl boolean,
  ADD COLUMN IF NOT EXISTS is_ews boolean,
  ADD COLUMN IF NOT EXISTS is_cwsn boolean,
  -- Free text "type (code)" — UDISE impairment codes vary by cycle.
  ADD COLUMN IF NOT EXISTS cwsn_impairment_type text,
  ADD COLUMN IF NOT EXISTS height_cm numeric(5, 1),
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5, 1),
  -- ── Enrolment Profile ─────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS is_rte boolean,
  ADD COLUMN IF NOT EXISTS medium_of_instruction text,
  ADD COLUMN IF NOT EXISTS previous_school_address text,
  ADD COLUMN IF NOT EXISTS previous_school_block text,
  ADD COLUMN IF NOT EXISTS previous_school_district text,
  ADD COLUMN IF NOT EXISTS previous_school_state text,
  ADD COLUMN IF NOT EXISTS previous_school_udise_code text,
  ADD COLUMN IF NOT EXISTS previous_school_reason_for_leaving text,
  ADD COLUMN IF NOT EXISTS previous_class_studied text,
  ADD COLUMN IF NOT EXISTS previous_school_board text,
  -- Text, not numeric: board roll numbers can be alphanumeric.
  ADD COLUMN IF NOT EXISTS board_roll_number text,
  ADD COLUMN IF NOT EXISTS board_percentage numeric(5, 2),
  -- Text: schools record this as "92%" or "180/210 days".
  ADD COLUMN IF NOT EXISTS last_session_attendance text,
  ADD COLUMN IF NOT EXISTS is_staff_ward boolean,
  ADD COLUMN IF NOT EXISTS participates_ncc boolean,
  ADD COLUMN IF NOT EXISTS participates_nss boolean,
  ADD COLUMN IF NOT EXISTS participates_scouts boolean,
  ADD COLUMN IF NOT EXISTS participates_competitions boolean,
  ADD COLUMN IF NOT EXISTS distance_band text,
  -- Template item 12 is ONE dropdown covering mother/father/legal guardian —
  -- "completed highest education level" of whichever parent it applies to.
  ADD COLUMN IF NOT EXISTS parent_highest_education text;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_minority_group;
ALTER TABLE students ADD CONSTRAINT chk_students_minority_group CHECK (
  minority_group IS NULL
  OR minority_group IN ('muslim', 'sikh', 'christian', 'jain', 'buddhist', 'parsi', 'none')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_medium;
ALTER TABLE students ADD CONSTRAINT chk_students_medium CHECK (
  medium_of_instruction IS NULL
  OR medium_of_instruction IN ('english', 'hindi')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_distance_band;
ALTER TABLE students ADD CONSTRAINT chk_students_distance_band CHECK (
  distance_band IS NULL
  OR distance_band IN ('1-3km', '3-5km', '5-10km', 'above-10km')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_parent_highest_education;
ALTER TABLE students ADD CONSTRAINT chk_students_parent_highest_education CHECK (
  parent_highest_education IS NULL
  OR parent_highest_education IN (
    'primary', 'upper_primary', 'secondary', 'senior_secondary',
    'graduation', 'pg_or_more'
  )
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_height_cm;
ALTER TABLE students ADD CONSTRAINT chk_students_height_cm CHECK (
  height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_weight_kg;
ALTER TABLE students ADD CONSTRAINT chk_students_weight_kg CHECK (
  weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_board_percentage;
ALTER TABLE students ADD CONSTRAINT chk_students_board_percentage CHECK (
  board_percentage IS NULL OR (board_percentage >= 0 AND board_percentage <= 100)
);

-- Mirrors scripts/migrations/erp/migration-073-telephony-call-logs.sql
-- Click-to-call audit trail. Teachers/admins ring a student's parent/guardian
-- from the ERP via Exotel (masked bridge); every call is logged here. No raw
-- numbers are stored — only contact_type + the student/actor FKs. The agent
-- leg is read from profiles.phone at call time.
CREATE TABLE IF NOT EXISTS call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  contact_type text NOT NULL
    CHECK (contact_type IN ('student', 'father', 'mother', 'guardian')),
  exotel_sid text,
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated', 'error', 'queued', 'in-progress',
      'completed', 'failed', 'busy', 'no-answer', 'canceled'
    )),
  duration_seconds integer,
  recording_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_actor
  ON call_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_student
  ON call_logs (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_exotel_sid
  ON call_logs (exotel_sid)
  WHERE exotel_sid IS NOT NULL;

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to call_logs" ON call_logs;
CREATE POLICY "Admins have full access to call_logs"
  ON call_logs FOR ALL
  USING (public.get_user_role() = 'admin');

-- =============================================================================
-- Migration 086 — enrollment history integrity
-- (mirrored from scripts/migrations/erp/migration-086-enrollment-history-integrity.sql)
-- =============================================================================
-- `created_at` had never existed on this table, yet report-card.ts,
-- results/by-student and final-result.ts all ORDER BY it and discard the
-- error — so every enrollment lookup silently returned null, stripping class,
-- roll number, grade scale and attendance from every report card and making
-- computeFinalResult() return null for every student.
--
-- `source` / `import_batch_id` mirror results + fee_payments so a backfilled
-- past-year enrollment is distinguishable and a whole batch stays revertible.
--
-- UNIQUE(student_id, academic_year_id) encodes the school's rule: one class
-- per student per session. The pre-existing UNIQUE(student_id, class_id)
-- cannot express this — `classes` are year-scoped, so it blocks the same
-- class twice but permits two different classes within one year.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE student_enrollments
  SET created_at = COALESCE(updated_at, now())
  WHERE created_at IS NULL;

ALTER TABLE student_enrollments
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'erp_native'
    CHECK (source IN ('erp_native', 'historical_import', 'bulk_backfill')),
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS student_enrollments_import_batch_idx
  ON student_enrollments(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

ALTER TABLE student_enrollments
  DROP CONSTRAINT IF EXISTS student_enrollments_student_year_unique;

ALTER TABLE student_enrollments
  ADD CONSTRAINT student_enrollments_student_year_unique
  UNIQUE (student_id, academic_year_id);

-- =============================================================================
-- Migration 087 — student status history
-- (mirrored from scripts/migrations/erp/migration-087-student-status-history.sql)
-- =============================================================================
-- ─── 1. The history table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_status_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: an audit row must outlive the enrollment it
  -- describes (same reasoning as migration 046's audit-log FK sweep).
  enrollment_id    uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  class_id         uuid REFERENCES classes(id) ON DELETE SET NULL,
  from_status text CHECK (from_status IN ('active','passed','failed','terminated','exited')),
  to_status   text NOT NULL
    CHECK (to_status IN ('active','passed','failed','terminated','exited')),
  reason      text,
  source      text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','bulk','promotion','bulk_import','historical_import','system')),
  changed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  -- The requirement, enforced at the lowest level so no future writer — route,
  -- script or console session — can record an exit without saying why.
  CONSTRAINT student_status_history_reason_required CHECK (
    to_status NOT IN ('terminated','exited')
    OR (reason IS NOT NULL AND length(btrim(reason)) >= 5)
  )
);

CREATE INDEX IF NOT EXISTS idx_ssh_student
  ON student_status_history(student_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssh_enrollment
  ON student_status_history(enrollment_id, changed_at DESC);

ALTER TABLE student_status_history ENABLE ROW LEVEL SECURITY;

-- Reads are admin-only. Writes go exclusively through the service-role client
-- (the RPC below), so no INSERT/UPDATE/DELETE policy is granted to anyone.
DROP POLICY IF EXISTS "Admins read student_status_history" ON student_status_history;
CREATE POLICY "Admins read student_status_history"
  ON student_status_history FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ─── 2. Denormalised latest-value cache ─────────────────────────────────────
-- Lets the students table render the reason inline without joining history per
-- row. The table above stays the source of truth.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS status_reason     text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- ─── 3. Atomic status change ────────────────────────────────────────────────
-- p_updates: [{"enrollment_id": uuid, "status": text, "reason": text|null}, …]
--
-- Per element: reads the current row, skips no-ops, inserts a history row,
-- updates the status plus the cache columns, and finally flips
-- students.is_active for the affected students in two set-based statements.
--
-- The reason CHECK on student_status_history is what actually enforces the
-- "terminated/exited must have a reason" rule; the API validates too, for a
-- readable error, but the DB is the backstop.

CREATE OR REPLACE FUNCTION public.change_enrollment_status(
  p_updates jsonb,
  p_actor   uuid DEFAULT NULL,
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_enrollment  record;
  v_new_status  text;
  v_reason      text;
  v_updated     int := 0;
  v_skipped     int := 0;
  v_inactive    uuid[] := ARRAY[]::uuid[];
  v_reactivated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_status := v_item ->> 'status';
    v_reason     := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');

    SELECT se.id, se.student_id, se.class_id, se.academic_year_id, se.status
      INTO v_enrollment
      FROM student_enrollments se
      WHERE se.id = (v_item ->> 'enrollment_id')::uuid
      FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- A no-op still counts as skipped rather than writing a history row that
    -- records no transition.
    IF v_enrollment.status IS NOT DISTINCT FROM v_new_status THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          updated_at        = now()
      WHERE id = v_enrollment.id;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_inactive := v_inactive || v_enrollment.student_id;
    ELSE
      v_reactivated := v_reactivated || v_enrollment.student_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  -- students.is_active gates the admin listing, so it has to track the
  -- enrollment status. Set-based, after the loop, so a student appearing twice
  -- in one payload settles on their final state.
  IF array_length(v_inactive, 1) > 0 THEN
    UPDATE students
      SET is_active = false, updated_at = now()
      WHERE id = ANY(v_inactive) AND is_active IS DISTINCT FROM false;
  END IF;

  IF array_length(v_reactivated, 1) > 0 THEN
    UPDATE students
      SET is_active = true, updated_at = now()
      WHERE id = ANY(v_reactivated)
        AND id <> ALL(v_inactive)
        AND is_active IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

-- Callable only by the service-role client (the API route). No grant to
-- anon/authenticated: status changes are authorised in the route via
-- verifyAdminOrEditorWithUser("students").
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

-- ─── 4. Backfill ────────────────────────────────────────────────────────────
-- Seed one history row per enrollment that is already in a non-active state,
-- so the timeline isn't blank for students who left before this shipped. The
-- reason is explicitly marked unknown rather than invented; `source='system'`
-- keeps these distinguishable from real recorded transitions, and the CHECK
-- above is satisfied because the placeholder is a genuine ≥5-char string.

INSERT INTO student_status_history (
  student_id, enrollment_id, academic_year_id, class_id,
  from_status, to_status, reason, source, changed_by, changed_at
)
SELECT se.student_id, se.id, se.academic_year_id, se.class_id,
       NULL, se.status,
       'Recorded before reason tracking existed — original reason unknown',
       'system', NULL, COALESCE(se.updated_at, now())
FROM student_enrollments se
WHERE se.status <> 'active'
  AND NOT EXISTS (
    SELECT 1 FROM student_status_history h WHERE h.enrollment_id = se.id
  );

-- =============================================================================
-- Migration 089 — student custom-report fields
-- (mirrored from scripts/migrations/erp/migration-089-student-report-fields.sql)
-- =============================================================================
-- Columns needed for the Custom Report Builder to reach parity with the old
-- ERP's 111-field student report: government/board identifiers, contact &
-- identity extras, admissions-desk fields, previous-school marks. All flat on
-- `students` because each is one printable value per student; the moment one
-- needs workflow it earns its own table. House is deliberately NOT here — it
-- is per-session, so it lives on student_enrollments (migration 090).

ALTER TABLE students
  -- Government / board identifiers (PEN + APAAR are UDISE+ mandated).
  ADD COLUMN IF NOT EXISTS pen_number text,
  ADD COLUMN IF NOT EXISTS apaar_number text,
  ADD COLUMN IF NOT EXISTS cbse_registration_no text,
  ADD COLUMN IF NOT EXISTS nic_number text,
  -- Contact & identity extras.
  ADD COLUMN IF NOT EXISTS father_salutation text,
  ADD COLUMN IF NOT EXISTS mother_salutation text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS mother_office_address text,
  ADD COLUMN IF NOT EXISTS mailing_address text,
  -- A pointer to whichever mobile column receives SMS, not a copy of it.
  ADD COLUMN IF NOT EXISTS sms_mobile_source text,
  -- Community name; distinct from `category`, the reservation bucket.
  ADD COLUMN IF NOT EXISTS caste text,
  ADD COLUMN IF NOT EXISTS area_type text,
  -- Admissions desk — flat reporting columns, not an admissions CRM.
  ADD COLUMN IF NOT EXISTS registration_no text,
  ADD COLUMN IF NOT EXISTS registration_date date,
  ADD COLUMN IF NOT EXISTS form_no text,
  ADD COLUMN IF NOT EXISTS admission_confirm_date date,
  ADD COLUMN IF NOT EXISTS counsellor_name text,
  ADD COLUMN IF NOT EXISTS counsellor_remark text,
  ADD COLUMN IF NOT EXISTS staff_reference text,
  -- Manual override for the New/Old classification derived from admission_date.
  ADD COLUMN IF NOT EXISTS student_type text,
  ADD COLUMN IF NOT EXISTS caution_money_receipt_no text,
  ADD COLUMN IF NOT EXISTS caution_money_receipt_date date,
  ADD COLUMN IF NOT EXISTS caution_money_amount numeric(12, 2),
  -- Previous-school marks; completes the group that stopped at board_percentage.
  ADD COLUMN IF NOT EXISTS previous_school_max_marks numeric(7, 2),
  ADD COLUMN IF NOT EXISTS previous_school_obtained_marks numeric(7, 2),
  ADD COLUMN IF NOT EXISTS previous_school_result text;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_father_salutation;
ALTER TABLE students ADD CONSTRAINT chk_students_father_salutation CHECK (
  father_salutation IS NULL
  OR father_salutation IN ('mr', 'shri', 'dr', 'prof', 'late', 'capt', 'col')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_mother_salutation;
ALTER TABLE students ADD CONSTRAINT chk_students_mother_salutation CHECK (
  mother_salutation IS NULL
  OR mother_salutation IN ('mrs', 'ms', 'smt', 'dr', 'prof', 'late')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_sms_mobile_source;
ALTER TABLE students ADD CONSTRAINT chk_students_sms_mobile_source CHECK (
  sms_mobile_source IS NULL
  OR sms_mobile_source IN ('student', 'father', 'mother', 'guardian')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_area_type;
ALTER TABLE students ADD CONSTRAINT chk_students_area_type CHECK (
  area_type IS NULL OR area_type IN ('rural', 'urban')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_student_type;
ALTER TABLE students ADD CONSTRAINT chk_students_student_type CHECK (
  student_type IS NULL OR student_type IN ('new', 'old', 'transfer')
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_previous_marks;
ALTER TABLE students ADD CONSTRAINT chk_students_previous_marks CHECK (
  (previous_school_max_marks IS NULL OR previous_school_max_marks >= 0)
  AND (previous_school_obtained_marks IS NULL OR previous_school_obtained_marks >= 0)
  AND (
    previous_school_max_marks IS NULL
    OR previous_school_obtained_marks IS NULL
    OR previous_school_obtained_marks <= previous_school_max_marks
  )
);

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_caution_money_amount;
ALTER TABLE students ADD CONSTRAINT chk_students_caution_money_amount CHECK (
  caution_money_amount IS NULL OR caution_money_amount >= 0
);

-- PEN and APAAR are national identifiers: a duplicate is always a data-entry
-- error, and it surfaces years later as a rejected board return. Partial so
-- the common NULL stays unconstrained and the index stays small.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_pen_number_unique
  ON students (pen_number) WHERE pen_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_apaar_number_unique
  ON students (apaar_number) WHERE apaar_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_form_no
  ON students (form_no) WHERE form_no IS NOT NULL;

-- =============================================================================
-- Migration 090 — houses master + per-session assignment
-- (mirrored from scripts/migrations/erp/migration-090-houses.sql)
-- =============================================================================
-- house_id sits on student_enrollments, not students: a student's house is
-- per-session, so a students-level column would print today's house against a
-- three-year-old cohort in any historical report. A master table rather than
-- free text because the old ERP's free-text list holds nine rows for four
-- houses (YELLOW / "Yellow House" / "Ble" / GREEN / …), which made every
-- house-wise total untrustworthy.

CREATE TABLE IF NOT EXISTS houses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text,
  colour     text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive: the whole point is to stop "RED" and "Red House" coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_houses_name_unique
  ON houses (lower(btrim(name)));

ALTER TABLE houses DROP CONSTRAINT IF EXISTS chk_houses_colour;
ALTER TABLE houses ADD CONSTRAINT chk_houses_colour CHECK (
  colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$'
);

-- SET NULL, not CASCADE: deleting a house must never delete an enrollment.
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS house_id uuid REFERENCES houses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_house
  ON student_enrollments (house_id) WHERE house_id IS NOT NULL;

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read houses" ON houses;
CREATE POLICY "Public can read houses"
  ON houses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can insert houses" ON houses;
CREATE POLICY "Admins can insert houses"
  ON houses FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can update houses" ON houses;
CREATE POLICY "Admins can update houses"
  ON houses FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can delete houses" ON houses;
CREATE POLICY "Admins can delete houses"
  ON houses FOR DELETE
  USING (public.get_user_role() = 'admin');

INSERT INTO houses (name, code, colour, sort_order)
VALUES
  ('Red House',    'RED', '#DC2626', 1),
  ('Blue House',   'BLU', '#2563EB', 2),
  ('Green House',  'GRN', '#16A34A', 3),
  ('Yellow House', 'YEL', '#CA8A04', 4)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- EXPORT AUDIT (migration 091)
-- (mirrored from scripts/migrations/erp/migration-091-export-events.sql)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Who downloaded which admin list, in what format, how many rows, under which
-- filters, and whether contact/identity fields were included. Written only by
-- the server-side export routes on the service-role client; admin-read-only,
-- append-only.

-- ── What actually writes here ──────────────────────────────────────────────
-- Today: 'students' (the one dataset the server can answer better than the
-- browser — past sessions include students who have since left, and the
-- subject filter needs a two-hop join the list payload does not carry) and
-- 'table_pdf' (every PDF, from any list, since rendering is server-side).
--
-- The other dataset values are reserved. They are listed now so that moving a
-- dataset server-side later is a route change rather than a CHECK-constraint
-- migration — but note that moving one only makes sense when the server can
-- supply something the page cannot. Where the browser already holds every row
-- (staff, users), a server route could withhold nothing and would log an act
-- the page can perform anyway, which is the "complete-looking but hollow"
-- outcome this table is meant to avoid.

CREATE TABLE IF NOT EXISTS export_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role       text,
  dataset          text NOT NULL CHECK (dataset IN (
                     'students', 'staff', 'fees_dues', 'transport_assignments',
                     'users', 'registrations', 'table_pdf')),
  feature_key      text,
  format           text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  row_count        integer NOT NULL DEFAULT 0,
  column_count     integer NOT NULL DEFAULT 0,
  fields           text[] NOT NULL DEFAULT '{}',
  sensitive        boolean NOT NULL DEFAULT false,
  filter_summary   text,
  filter_spec      jsonb,
  source_app       text CHECK (source_app IN ('erp', 'cms')),
  source_path      text,
  -- text, not inet: a malformed X-Forwarded-For must not be able to fail the
  -- download this row describes.
  client_ip        text,
  user_agent       text,
  -- How the export was produced. Deliberately a separate axis from `dataset`:
  -- an AI-produced student sheet is still the student corpus, so reclassifying
  -- it out of 'students' would make every existing per-dataset count wrong.
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'ai')),
  -- ai_query_runs.id that produced the sheet, when source = 'ai'.
  ai_run_id        uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_events_actor
  ON export_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_events_ai
  ON export_events(created_at DESC) WHERE source = 'ai';
CREATE INDEX IF NOT EXISTS idx_export_events_dataset
  ON export_events(dataset, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_events_sensitive
  ON export_events(created_at DESC) WHERE sensitive;

ALTER TABLE export_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read export_events" ON export_events;
CREATE POLICY "Admins read export_events"
  ON export_events FOR SELECT
  USING (public.get_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- HISTORICAL CORRECTIONS (migration 092)
-- (mirrored from scripts/migrations/erp/migration-092-historical-corrections.sql)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every edit made to a CLOSED academic session: who, which session, which row,
-- which columns, the before/after snapshots and a required reason. A past
-- session opens read-only in the admin UI and an edit requires an explicit
-- unlock, which writes one row here. Admin-read, service-role-write,
-- append-only.

CREATE TABLE IF NOT EXISTS historical_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE: the record of a correction must outlive the account
  -- that made it (migration 046 set this convention for the audit tables).
  actor_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role       text,
  -- The session that was edited. This is the whole point of the table: it
  -- distinguishes an ordinary edit from one reaching into a closed year.
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  student_id       uuid REFERENCES students(id) ON DELETE SET NULL,
  enrollment_id    uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  target_table     text NOT NULL,
  target_id        uuid,
  -- Only the columns that actually changed, so reading the log does not mean
  -- diffing two fifty-column blobs by eye.
  changed_columns  text[] NOT NULL DEFAULT '{}',
  before_snapshot  jsonb,
  after_snapshot   jsonb,
  -- Required, and long enough to be a sentence rather than a shrug. The DB
  -- enforces it because the reason is the only thing that makes this edit
  -- reviewable later, and a UI-only check is a suggestion.
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_corrections_year
  ON historical_corrections(academic_year_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_student
  ON historical_corrections(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_actor
  ON historical_corrections(actor_id, created_at DESC);

ALTER TABLE historical_corrections ENABLE ROW LEVEL SECURITY;

-- Admin-read only. Writes go exclusively through the service-role client in the
-- correction path, so no INSERT/UPDATE/DELETE policy is granted to any role —
-- same posture as student_status_history (087) and export_events (091). An
-- audit row that the actor it describes could edit would be worthless.
DROP POLICY IF EXISTS "Admins read historical_corrections" ON historical_corrections;
CREATE POLICY "Admins read historical_corrections"
  ON historical_corrections FOR SELECT
  USING (public.get_user_role() = 'admin');

-- =============================================================================
-- Migration 093 — report presets
-- (mirrored from scripts/migrations/erp/migration-093-report-presets.sql)
-- =============================================================================
-- Saved column/filter selections for the Custom Report Builder. The old ERP
-- saved nothing, so the office re-ticked the same boxes out of 111 every time.
-- Private by default; `is_shared` publishes a preset and only admins may set
-- it. created_by IS NULL marks a system preset (the two seeded below).

CREATE TABLE IF NOT EXISTS report_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Room for the planned fee / attendance / result reports without a second
  -- table; each one gets its own field registry but the same preset shape.
  entity     text NOT NULL DEFAULT 'students',
  -- The whole ReportFilters object (packages/shared/src/lib/report-filters.ts).
  filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered ReportField keys. Unknown keys are dropped on load rather than
  -- erroring, so retiring a field does not break every saved preset.
  fields     text[] NOT NULL DEFAULT '{}',
  is_shared  boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_presets_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT report_presets_entity_known CHECK (entity IN ('students'))
);

-- ON DELETE CASCADE above, not SET NULL: a deleted user's private presets
-- should go with them. SET NULL would silently promote them to system presets,
-- which is the opposite of what anyone intends.

-- One name per owner. Partial, because NULL owners (system presets) need
-- their own global uniqueness — and in Postgres NULL <> NULL, so a single
-- composite unique index would let duplicate system presets through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_owner_name
  ON report_presets (created_by, lower(btrim(name)))
  WHERE created_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_presets_system_name
  ON report_presets (lower(btrim(name)))
  WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_report_presets_visible
  ON report_presets (entity, is_shared, created_by);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Defence in depth: the API also checks ownership explicitly, but a preset is
-- per-user data and the table should be safe on its own.

ALTER TABLE report_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or shared report_presets" ON report_presets;
CREATE POLICY "Read own or shared report_presets"
  ON report_presets FOR SELECT
  USING (created_by = auth.uid() OR is_shared OR public.get_user_role() = 'admin');

-- A caller may only create presets owned by themselves, and may not publish
-- one unless they are an admin.
DROP POLICY IF EXISTS "Insert own report_presets" ON report_presets;
CREATE POLICY "Insert own report_presets"
  ON report_presets FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Update own report_presets" ON report_presets;
CREATE POLICY "Update own report_presets"
  ON report_presets FOR UPDATE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin')
  WITH CHECK (
    (created_by = auth.uid() OR public.get_user_role() = 'admin')
    AND (is_shared = false OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "Delete own report_presets" ON report_presets;
CREATE POLICY "Delete own report_presets"
  ON report_presets FOR DELETE
  USING (created_by = auth.uid() OR public.get_user_role() = 'admin');

-- ─── Seed: two system presets ───────────────────────────────────────────────
-- So the screen is not empty on day one, and so the two reports the office
-- actually runs are one click.
--
-- Field keys must exist in packages/shared/src/lib/report-fields.ts. Unknown
-- keys are dropped silently on load, so a typo here degrades to a missing
-- column rather than an error — scripts/_verify-report-fields.mts is what
-- catches that.
--
-- `serial` and `student_name` are omitted deliberately: they are always-on and
-- get prepended by resolveFields().

INSERT INTO report_presets (name, entity, filters, fields, is_shared, created_by)
VALUES
  (
    'Contact Sheet',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_section', 'roll_number',
      'father_name', 'father_mobile', 'mother_mobile', 'phone'
    ],
    true,
    NULL
  ),
  (
    'UDISE+ Extract',
    'students',
    '{"statuses":["active"],"sort_by":"class_section","then_by":"student_name"}'::jsonb,
    ARRAY[
      'admission_no', 'class_name', 'section', 'gender', 'date_of_birth',
      'father_name', 'mother_name', 'category', 'minority_group',
      'is_bpl', 'is_ews', 'is_cwsn', 'is_rte', 'medium_of_instruction',
      'pen_number', 'apaar_number', 'aadhar_number', 'distance_band',
      'parent_highest_education'
    ],
    true,
    NULL
  )
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN report_presets.created_by IS
  'NULL means a system preset: shared, owned by nobody, admin-only to modify.';

-- ============================================================
-- Missing FK indexes (migration-095-missing-fk-indexes.sql)
-- Postgres indexes PRIMARY KEY and UNIQUE automatically, but not
-- foreign keys. These FK columns carry hot query traffic and had no
-- index; see the migration file for why these and not the other 17.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fee_payments_academic_year_id
  ON fee_payments(academic_year_id);

CREATE INDEX IF NOT EXISTS idx_class_tests_class_id
  ON class_tests(class_id);
CREATE INDEX IF NOT EXISTS idx_class_tests_subject_id
  ON class_tests(subject_id);

CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id
  ON class_subjects(subject_id);

CREATE INDEX IF NOT EXISTS idx_timetable_periods_subject_id
  ON timetable_periods(subject_id);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_subject_id
  ON exam_schedules(subject_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_stream_id
  ON student_enrollments(stream_id);

CREATE INDEX IF NOT EXISTS idx_marksheet_publications_exam_type_id
  ON marksheet_publications(exam_type_id);

CREATE INDEX IF NOT EXISTS idx_student_status_history_academic_year_id
  ON student_status_history(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_student_status_history_class_id
  ON student_status_history(class_id);


-- ============================================================================
-- SCHOOL PROFILE (migration 110)
-- ============================================================================
-- The school's own identity, moved out of packages/shared/src/lib/constants.ts
-- so the assistant surfaces and the WhatsApp sender read it from the database
-- instead of hardcoding it. Exactly one row, enforced by the singleton column.
-- NOT a multi-tenancy migration: no other table carries a school_id.

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
-- Mirrors packages/shared/src/lib/constants.ts SCHOOL as of 2026-09-09, so
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

-- ============================================================
-- Public staff directory (migration-098-restrict-staff-pii.sql)
-- The ONLY staff data readable without logging in. Columns are deliberately
-- limited; staff_members also holds date_of_birth, address, phone, email and
-- license_number, none of which may ever be added here.
-- ============================================================
CREATE OR REPLACE VIEW public_staff_directory AS
  SELECT id, name, subject, category, photo_url, qualifications, sort_order
  FROM staff_members
  WHERE is_active = true
    AND category IN (
      'management', 'pgt', 'tgt', 'prt', 'motherTeachers', 'admin'
    );

GRANT SELECT ON public_staff_directory TO anon, authenticated;


-- ============================================================================
-- AI AUDIT (migration 112)
-- ============================================================================
-- The assistant's audit trail. Four tables because "did the assistant read
-- something the caller was not entitled to?" needs the model's request and the
-- server's rewrite of it side by side, per tool call.
--
-- All four: RLS enabled with ZERO policies, intentionally — service-role only.
-- Stores counts, field keys and filter shapes. Never row contents.

-- ── Conversations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the request came in. whatsapp has no Supabase session, so user_id
  -- is null there and parent_id carries the identity.
  channel text NOT NULL CHECK (channel IN ('erp_web', 'portal_web', 'whatsapp')),
  -- migration-114 added 'guide': the in-app help assistant, which answers
  -- questions about the software and reads no student data.
  feature text NOT NULL CHECK (feature IN ('ask', 'remarks', 'parent', 'guide')),

  -- Actor. SET NULL so the trail outlives the account, matching export_events
  -- and historical_corrections.
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role text,
  parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,

  -- The scope this conversation ran under, denormalised so an auditor can
  -- filter without joining every tool call. scope_hash is the fingerprint the
  -- export path re-checks before letting a download proceed.
  scope_kind text NOT NULL CHECK (scope_kind IN ('all', 'classes', 'students')),
  scope_hash text NOT NULL,

  model text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'error', 'aborted')),
  error_code text,

  started_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),

  -- migration-114: what makes this listable as a chat rather than only
  -- auditable. 'auto' titles are machine-written and safe to overwrite;
  -- 'user' means a human renamed it and the titler must never clobber it.
  title text,
  title_source text CHECK (title_source IN ('auto', 'user')),

  -- Soft delete. A hard DELETE cascades ai_messages AND ai_tool_calls, which
  -- would let anyone erase the record of what the assistant read simply by
  -- tidying their chat list. The audit outlives the conversation.
  deleted_at timestamptz,
  deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor
  ON ai_conversations (actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_channel
  ON ai_conversations (channel, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_parent
  ON ai_conversations (parent_id, started_at DESC) WHERE parent_id IS NOT NULL;
-- migration-114: the chat sidebar query, exactly. The index above is on
-- started_at, which is the wrong column for a list that reorders every time a
-- reply lands.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_actor_recent
  ON ai_conversations (actor_id, feature, last_at DESC)
  WHERE deleted_at IS NULL;

-- ── Messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL,

  role text NOT NULL CHECK (role IN ('user', 'assistant')),

  -- The human's own words, and — since migration-114 — the assistant's reply
  -- too. 112 deliberately withheld the reply; that was right for an audit
  -- table and wrong for a chat, because reopening one showed your questions
  -- above blank bubbles. See the table COMMENT for what that costs.
  content text,

  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  stop_reason text,
  latency_ms integer,

  -- migration-114. Why this turn ended badly: status on the conversation
  -- carried it when a conversation was a single turn, and one aborted turn
  -- must not make a whole chat read as aborted.
  error_code text,
  -- Set when content was blanked by a delete. Distinguishes "the words are
  -- gone" from "the assistant produced no text", which is a real state on the
  -- Stop and budget-exhausted paths.
  redacted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, seq);

-- ── Tool calls ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_seq integer,

  tool_name text NOT NULL,

  -- The pair that makes this table worth having. See the header.
  args_raw jsonb,
  args_scoped jsonb,
  scope_applied jsonb,

  -- Shape of what came back, never the contents.
  row_count integer,
  preview_row_count integer,
  field_keys text[] NOT NULL DEFAULT '{}',
  sensitive_included boolean NOT NULL DEFAULT false,

  duration_ms integer,
  error_code text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_conversation
  ON ai_tool_calls (conversation_id, created_at);
-- The alert query: scope violations, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_errors
  ON ai_tool_calls (created_at DESC) WHERE error_code IS NOT NULL;

-- ── Query runs ──────────────────────────────────────────────────────────────
-- The handle behind an answer. Holds the SCOPED filters, so re-running is
-- guaranteed to reproduce what the caller was entitled to and nothing wider.
--
-- Deliberately stores no rows: the on-screen table and the CSV re-execute
-- under a fresh authorization check rather than serving a cached result. That
-- costs a second query and means the export re-states its own total, but it
-- keeps a teacher who lost a class between preview and download from
-- exporting stale rows.
CREATE TABLE IF NOT EXISTS ai_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,

  filters jsonb NOT NULL,
  field_keys text[] NOT NULL DEFAULT '{}',
  total integer NOT NULL DEFAULT 0,
  capped boolean NOT NULL DEFAULT false,

  -- Re-derived on every read; a mismatch is a 403, not a stale download.
  scope_hash text NOT NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,

  -- migration-114. Which answer owns this run: without it a reopened chat
  -- cannot put a result chip under the answer that produced it.
  message_seq integer,
  -- The model's stated intent, denormalised off ai_tool_calls.args_raw, which
  -- cannot be read back unambiguously — two parallel report calls in one round
  -- share (conversation_id, message_seq) and nothing links a tool-call row to
  -- the run row it produced.
  purpose text,

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Checked lazily at read. There is no cron anywhere in this repo, so
  -- nothing here may depend on a sweeper existing.
  --
  -- migration-114 widened this from 2 hours to 24: two hours is shorter than a
  -- school working day, so reopening this morning's chat found every result
  -- already expired. Anything older goes through the explicit re-run path,
  -- which mints a fresh row under a fresh authorization check.
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  exported_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_query_runs_conversation
  ON ai_query_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_query_runs_expiry
  ON ai_query_runs (expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_query_runs_message
  ON ai_query_runs (conversation_id, message_seq)
  WHERE conversation_id IS NOT NULL;

-- Close the loop opened in migration 097: an exported sheet points back at the
-- question that produced it. Added here because the target table exists now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_events_ai_run_id_fkey'
  ) THEN
    ALTER TABLE export_events
      ADD CONSTRAINT export_events_ai_run_id_fkey
      FOREIGN KEY (ai_run_id) REFERENCES ai_query_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_conversations IS
  'RLS enabled with NO policies, intentionally: service-role access only. Any '
  'client credential reads this as empty. Do not add a policy without deciding '
  'what a non-admin should be able to learn about other people''s questions. '
  'Deletion is SOFT (deleted_at): a hard delete would cascade ai_messages and '
  'ai_tool_calls, letting anyone erase the record of what the assistant read '
  'by tidying their chat list.';
COMMENT ON TABLE ai_messages IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'CHANGED IN 114: assistant content IS stored, because a chat you cannot '
  'read back is not a chat. This table therefore holds an unstructured '
  'partial copy of student facts — names, counts, and, where the caller '
  'unlocked sensitive columns, quoted contact details. Treat it as student '
  'data for retention, DSAR and breach purposes. Deleting a conversation '
  'NULLs content and stamps redacted_at; the audit skeleton (seq, tokens, '
  'tool calls, query runs) survives, the words do not.';
COMMENT ON TABLE ai_tool_calls IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'args_raw vs args_scoped is the scope-widening signal; keep both.';
COMMENT ON TABLE ai_query_runs IS
  'RLS enabled with NO policies, intentionally: service-role access only. '
  'Stores scoped filters, never rows — readers re-execute under a fresh '
  'authorization check.';


-- ============================================================================
-- WHATSAPP CHANNEL (migration 113)
-- ============================================================================
-- Phone enrolment, sessions, message log, and a DB-owned rate limiter.
-- A phone number is not identity: Meta's signature authenticates the provider,
-- not the handset, so a number must be enrolled once before it sees any child's
-- data. All five tables are RLS-enabled with zero policies, intentionally.

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


-- ============================================================================
-- RLS PER-ROW CALL HOISTING (migration 102)
-- ============================================================================
-- Mirrored as the DO block rather than as rewritten CREATE POLICY statements,
-- and that is deliberate. The CREATE POLICY statements ABOVE in this file are
-- known to be stale — migration-erp-redesign.sql renamed ~50 of them without
-- updating this mirror. Rewriting them here would encode names that may not
-- exist. The DO block transforms whatever policies actually got created, so a
-- database rebuilt from this file ends up correct either way. It is
-- idempotent: re-running it is a no-op.
--
-- See scripts/audit/schema-mirror-audit.sql to reconcile the drift properly.

BEGIN;

DO $mig$
DECLARE
  r        record;
  q        text;
  w        text;
  stmt     text;
  changed  int := 0;
  scanned  int := 0;
  -- Scalar, zero-argument, STABLE helpers. Set-returning helpers
  -- (get_my_class_ids, get_my_children_ids) are excluded on purpose.
  fns text[] := ARRAY[
    'get_user_role',
    'get_my_student_id',
    'get_my_teacher_id',
    'get_my_parent_id'
  ];
  fn   text;
  tabs text[] := ARRAY[
    'profiles','students','student_enrollments','results','attendance',
    'fee_payments','parents','report_presets','student_subjects',
    'class_tests','class_test_results','non_scholastic_assessments',
    'student_remarks','ptm_notes','supplementary_attempts'
  ];
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(tabs)
     ORDER BY tablename, policyname
  LOOP
    scanned := scanned + 1;
    q := r.qual;
    w := r.with_check;

    FOREACH fn IN ARRAY fns LOOP
      -- Order matters. Park already-wrapped and schema-qualified forms behind
      -- sentinels first, so the bare replacement cannot corrupt them into
      -- `public.(SELECT f())` or double-wrap an existing `(SELECT f())`.
      q := replace(q, '( SELECT '||fn||'()',        '@@W@@'||fn);
      q := replace(q, '(SELECT '||fn||'()',         '@@W@@'||fn);
      q := replace(q, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      q := replace(q, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      q := replace(q, 'public.'||fn||'()',          '@@Q@@'||fn);
      q := replace(q, fn||'()',            '(SELECT '||fn||'())');
      q := replace(q, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      q := replace(q, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      q := replace(q, '@@W@@'||fn,         '(SELECT '||fn||'()');

      w := replace(w, '( SELECT '||fn||'()',        '@@W@@'||fn);
      w := replace(w, '(SELECT '||fn||'()',         '@@W@@'||fn);
      w := replace(w, '( SELECT public.'||fn||'()', '@@P@@'||fn);
      w := replace(w, '(SELECT public.'||fn||'()',  '@@P@@'||fn);
      w := replace(w, 'public.'||fn||'()',          '@@Q@@'||fn);
      w := replace(w, fn||'()',            '(SELECT '||fn||'())');
      w := replace(w, '@@Q@@'||fn,         '(SELECT public.'||fn||'())');
      w := replace(w, '@@P@@'||fn,         '(SELECT public.'||fn||'()');
      w := replace(w, '@@W@@'||fn,         '(SELECT '||fn||'()');
    END LOOP;

    -- auth.uid() gets the same treatment.
    q := replace(q, '( SELECT auth.uid()', '@@A@@');
    q := replace(q, '(SELECT auth.uid()',  '@@A@@');
    q := replace(q, 'auth.uid()',          '(SELECT auth.uid())');
    q := replace(q, '@@A@@',               '(SELECT auth.uid()');
    w := replace(w, '( SELECT auth.uid()', '@@A@@');
    w := replace(w, '(SELECT auth.uid()',  '@@A@@');
    w := replace(w, 'auth.uid()',          '(SELECT auth.uid())');
    w := replace(w, '@@A@@',               '(SELECT auth.uid()');

    CONTINUE WHEN q IS NOT DISTINCT FROM r.qual
              AND w IS NOT DISTINCT FROM r.with_check;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
    IF w IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', w); END IF;

    RAISE NOTICE '%;', stmt;
    EXECUTE stmt;
    changed := changed + 1;
  END LOOP;

  RAISE NOTICE 'migration-102: scanned % policies, rewrote %.', scanned, changed;

  IF changed = 0 THEN
    RAISE WARNING 'migration-102 changed nothing. Either it has already been '
                  'applied, or the helper names differ from those expected.';
  END IF;
END
$mig$;

-- ─────────────────────────────────────────────────────────────────────────
-- BUG FIX (a real behaviour change, not a rewrite)
--
-- The teacher policy on student_subjects compares class_subjects.teacher_id
-- against auth.uid(). But class_subjects.teacher_id REFERENCES teachers(id),
-- while auth.uid() is profiles.id / auth.users.id - two different UUID
-- spaces. The predicate is ALWAYS FALSE, so teachers see ZERO
-- student_subjects rows today. Every other policy in the schema correctly
-- uses get_my_teacher_id() for this.
--
-- Written defensively: the redesign may have renamed this policy, so we fix
-- whichever policy on student_subjects still carries the broken comparison.
-- ─────────────────────────────────────────────────────────────────────────
DO $fix$
DECLARE r record; q text; n int := 0;
BEGIN
  FOR r IN
    SELECT policyname, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='student_subjects'
       AND qual LIKE '%teacher_id%' AND qual LIKE '%auth.uid()%'
  LOOP
    q := replace(r.qual, 'teacher_id = (SELECT auth.uid())',
                         'teacher_id = (SELECT get_my_teacher_id())');
    q := replace(q,      'teacher_id = auth.uid()',
                         'teacher_id = (SELECT get_my_teacher_id())');
    CONTINUE WHEN q = r.qual;
    RAISE NOTICE 'BUGFIX ALTER POLICY %I ON student_subjects USING (%)', r.policyname, q;
    EXECUTE format('ALTER POLICY %I ON public.student_subjects USING (%s)', r.policyname, q);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'migration-102 bugfix: repaired % student_subjects policy(ies).', n;
END
$fix$;

COMMIT;


-- ============================================================================
-- INDEX COVERAGE (migration 103)
-- ============================================================================
-- Postgres indexes PRIMARY KEY and UNIQUE automatically but never a foreign
-- key, so each of these was a parent DELETE that seq-scanned its child table.
-- The composites match the .eq()/.order() chains the app actually issues.
-- Additive only: the 34 redundant-index candidates are NOT dropped, because
-- deciding that from this mirror is unsafe while the mirror is known stale.

BEGIN;

-- ── Tier 1: unindexed FKs on tables that grow without bound ──────────────
-- Every DELETE FROM profiles / buses / bus_stops currently seq-scans these.

-- transport_change_requests carries six unindexed FKs.
CREATE INDEX IF NOT EXISTS idx_tcr_requested_by      ON transport_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_tcr_reviewed_by       ON transport_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_bus_id   ON transport_change_requests(previous_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_bus_id    ON transport_change_requests(amended_bus_id);
CREATE INDEX IF NOT EXISTS idx_tcr_previous_stop_id  ON transport_change_requests(previous_stop_id);
CREATE INDEX IF NOT EXISTS idx_tcr_amended_stop_id   ON transport_change_requests(amended_stop_id);

-- Append-only audit tables. migration-095 skipped these on the grounds that
-- they "sit on small master tables"; they are not master tables and they do
-- not stay small - student_status_history gains a row per student per
-- promotion run.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_status_changed_by
  ON student_enrollments(status_changed_by);
CREATE INDEX IF NOT EXISTS idx_student_status_history_changed_by
  ON student_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_teacher_absences_marked_by
  ON teacher_absences(marked_by);
CREATE INDEX IF NOT EXISTS idx_fee_change_requests_reviewed_by
  ON fee_change_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_historical_corrections_enrollment
  ON historical_corrections(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_fee_change_audit_source_request
  ON fee_change_audit_log(source_request_id);

-- ── Tier 2: remaining unindexed join columns ─────────────────────────────
-- migration-095 added exam_schedules(subject_id) but missed class_id, which
-- is only ever the SECOND column of idx_exam_schedules_exam_class and so has
-- no leading index of its own.
CREATE INDEX IF NOT EXISTS idx_exam_schedules_class_id
  ON exam_schedules(class_id);
CREATE INDEX IF NOT EXISTS idx_result_masters_grade_scale_id
  ON result_masters(grade_scale_id);
CREATE INDEX IF NOT EXISTS idx_students_alumni_academic_year_id
  ON students(alumni_academic_year_id);
CREATE INDEX IF NOT EXISTS idx_export_events_academic_year_id
  ON export_events(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_buses_conductor_id
  ON buses(conductor_id);
CREATE INDEX IF NOT EXISTS idx_elective_slot_options_subject_id
  ON elective_slot_options(subject_id);

-- ── Composites matching the query shapes the app actually issues ─────────
-- Each was cross-checked against the .eq()/.in()/.order() chains in apps/erp.

-- The hottest shape in the codebase: 15 call sites do
--   .eq("class_id", ...).eq("status","active").order("roll_number")
-- idx_enrollments_active is (student_id, class_id, academic_year_id) WHERE
-- status='active' - it leads with student_id, so a class-roster read cannot
-- use it and falls back to the single-column class_id index plus a sort.
CREATE INDEX IF NOT EXISTS idx_enrollments_class_status_roll
  ON student_enrollments(class_id, status, roll_number);

-- 14 sites: .eq(student_id)[.eq(academic_year_id)].order(enrollment_date DESC).
-- UNIQUE(student_id, class_id) cannot serve the ordering, so this sorts today.
CREATE INDEX IF NOT EXISTS idx_enrollments_student_year_date
  ON student_enrollments(student_id, academic_year_id, enrollment_date DESC);

-- 7 sites on the marksheet path. Only (class_id, subject_id) and a separate
-- (exam_type_id) exist, so neither serves this pair.
CREATE INDEX IF NOT EXISTS idx_results_class_exam
  ON results(class_id, exam_type_id);

-- 6 sites: the student fee ledger.
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_year_date
  ON fee_payments(student_id, academic_year_id, payment_date DESC);

-- The two /api/students list endpoints, which order by full_name and split on
-- is_alumni. Partial so each index only carries the rows its endpoint reads.
CREATE INDEX IF NOT EXISTS idx_students_active_name
  ON students(full_name) WHERE is_alumni = false;
CREATE INDEX IF NOT EXISTS idx_students_alumni_year_name
  ON students(alumni_passing_year, full_name) WHERE is_alumni = true;

ANALYZE;

COMMIT;


-- ============================================================================
-- TRANSPORT READS RESTRICTED TO AUTHENTICATED (migration 104)
-- ============================================================================
-- The four transport tables above are created with "Public can read …"
-- policies that have no TO clause, so they applied to PUBLIC — including the
-- anon role, whose key ships in the marketing site's JS bundle. That exposed
-- every pickup point, route, fee and bus registration number to the internet.
-- Verified against production with real anon-key requests before the fix.
--
-- Applied after those CREATE POLICY statements so a database rebuilt from
-- this file ends up correct.

BEGIN;

-- ── bus_stops ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stops" ON public.bus_stops;
CREATE POLICY "Authenticated can read bus_stops"
  ON public.bus_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_route_stops ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_route_stops" ON public.bus_route_stops;
CREATE POLICY "Authenticated can read bus_route_stops"
  ON public.bus_route_stops FOR SELECT
  TO authenticated
  USING (true);

-- ── bus_stop_fees ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read bus_stop_fees" ON public.bus_stop_fees;
CREATE POLICY "Authenticated can read bus_stop_fees"
  ON public.bus_stop_fees FOR SELECT
  TO authenticated
  USING (true);

-- ── buses ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read buses" ON public.buses;
CREATE POLICY "Authenticated can read buses"
  ON public.buses FOR SELECT
  TO authenticated
  USING (true);

-- ── Assertion: no anonymous read may survive on these four ─────────────────
-- Catches both a policy name that did not match the DROPs above and any future
-- policy that re-opens one of these tables to anon. Aborts the transaction.
DO $assert$
DECLARE leaked text;
BEGIN
  SELECT string_agg(format('%s."%s"', tablename, policyname), ', ')
    INTO leaked
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('bus_stops','bus_route_stops','bus_stop_fees','buses')
     AND cmd IN ('SELECT','ALL')
     AND permissive = 'PERMISSIVE'
     -- roles containing public/anon means unauthenticated callers are included
     AND (roles::text[] && ARRAY['public','anon'])
     -- ...and the predicate does not itself exclude them
     AND coalesce(qual, 'true') = 'true';

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'migration-104 aborted: these policies still allow anonymous reads of transport data: %',
      leaked;
  END IF;

  RAISE NOTICE 'migration-104: transport tables are no longer readable by anon.';
END
$assert$;

COMMIT;


-- ============================================================================
-- MIRROR REPAIR: student_enrollments.pickup_address
-- ============================================================================
-- This column has been live since migration-053 and is read by production code
-- (lib/admin-tables.ts, api/transport/assignments, the transport assignments
-- page, validations.ts, types/index.ts) but it was never mirrored here. A
-- database rebuilt from this file alone was missing it, and the transport
-- assignments page would 400.
--
-- Confirmed against the live catalog: of every column on students,
-- student_enrollments and fee_payments, this was the ONLY one missing from
-- this file.
--
-- migration-053 also added pickup_lat / pickup_lng / pickup_verified_at /
-- pickup_verified_by; migration-074 DROPPED all four along with the rest of the
-- distance-based transport pricing model, and deliberately KEPT this one,
-- repurposed. Only this column is restored here — the other four are correctly
-- absent.
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS pickup_address text;

-- Superseded comment: migration-053 described this as the "source of truth for
-- billing distance", which stopped being true when migration-074 replaced
-- road-distance slabs with flat per-stop fees. It is now a landmark that helps
-- a driver find the child, and nothing prices off it.
COMMENT ON COLUMN student_enrollments.pickup_address IS
  'Free-text pickup landmark supplied by the parent, to help the driver locate '
  'the child. NOT a pricing input: migration-074 replaced distance-based '
  'transport fees with flat per-stop fees on bus_stop_fees.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 115 — Day Book (Head wise) import support
-- (mirrored from scripts/migrations/erp/migration-115-day-book-import.sql)
--
-- `source_receipt_no` is the old software's own receipt number, and it is the
-- idempotency key for the day-book importer. receipt_number cannot be: the
-- importer splits one source receipt across the instalments it settles, so the
-- slice suffix moves whenever the fee schedule is edited, and a re-uploaded
-- overlapping export would insert a duplicate set instead of conflicting.
--
-- The unique index keys on COALESCE(fee_structure_id, bus_stop_id) because
-- fee_payments_target_xor (migration 074) sets exactly one of the two, and a
-- transport day book lands on bus_stop_id with fee_structure_id NULL — NULLs
-- compare distinct, so keying on fee_structure_id alone would leave those rows
-- undeduplicated.
--
-- `import_batches` gives the bare import_batch_id uuid on fee_payments,
-- results and student_enrollments a parent row: what the batch was, who ran
-- it, what it reconciled to, and whether it has been reverted. Deliberately
-- NOT an FK — rows predating this migration have no parent, and ON DELETE
-- semantics would then decide the fate of receipts.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS source_receipt_no text;

COMMENT ON COLUMN fee_payments.source_receipt_no IS
  'Receipt number as printed by the previous ERP software. Stable across '
  're-imports (unlike receipt_number, whose slice suffix moves when the fee '
  'schedule changes), so it is the idempotency key for the day-book importer '
  'and the number the office searches by.';

CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_source_receipt_unique
  ON fee_payments (
    academic_year_id,
    source_receipt_no,
    COALESCE(fee_structure_id, bus_stop_id)
  )
  WHERE source_receipt_no IS NOT NULL;

-- The Day Book records one instrument date for every non-cash receipt: the
-- date on the cheque, or the date the online transfer went through. Both land
-- in cheque_date, so widen what the column claims to mean. Nothing reads it as
-- cheque-only -- the receipt PDF prints it beside whichever reference the row
-- carries.
COMMENT ON COLUMN fee_payments.cheque_date IS
  'Date on the payment instrument: the date written on the cheque, or the '
  'date an online transfer/UTR was executed. Often differs from payment_date, '
  'which is always the date the school received the money.';

CREATE INDEX IF NOT EXISTS idx_fee_payments_source_receipt
  ON fee_payments (academic_year_id, source_receipt_no)
  WHERE source_receipt_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'fees_day_book',
    'fees_account_wise',
    'results_greensheet',
    'students_backfill'
  )),
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  file_name        text,
  file_size_bytes  integer CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  source_period_start date,
  source_period_end   date,
  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_count  integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_count  integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  amount_total   numeric(14, 2),
  control_totals jsonb,
  notes      text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT import_batches_revert_consistent CHECK (
    (reverted_at IS NULL AND reverted_by IS NULL)
    OR reverted_at IS NOT NULL
  ),
  CONSTRAINT import_batches_period_ordered CHECK (
    source_period_start IS NULL
    OR source_period_end IS NULL
    OR source_period_end >= source_period_start
  )
);

CREATE INDEX IF NOT EXISTS idx_import_batches_kind_created
  ON import_batches (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_academic_year
  ON import_batches (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_by
  ON import_batches (created_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_reverted_by
  ON import_batches (reverted_by);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to import batches" ON import_batches;
CREATE POLICY "Admins have full access to import batches"
  ON import_batches FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- The backfill of parent rows for pre-existing batches lives only in the
-- migration file: a database built fresh from this schema has no batches to
-- reconstruct.

-- ============================================================================
-- MIGRATION 116 — Teacher lifecycle (retire, don't orphan)
-- Mirrors scripts/migrations/erp/migration-116-teacher-lifecycle.sql
-- ============================================================================
-- `teachers.staff_member_id` is ON DELETE SET NULL, so deleting someone from
-- People → Staff leaves their teacher row behind, still is_active = true, in a
-- table no ERP screen could edit. Departed staff therefore kept appearing in
-- every teacher dropdown — the dropdowns filter is_active correctly, the data
-- was wrong. These columns plus the review view are what /people/teachers
-- needs to retire a teacher explicitly and reversibly.

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS date_of_leaving date,
  ADD COLUMN IF NOT EXISTS leaving_reason  text;

COMMENT ON COLUMN teachers.date_of_leaving IS
  'Date the teacher left the school. Set when is_active flips to false; kept '
  'when they are reactivated so a rejoin is visible in the record.';
COMMENT ON COLUMN teachers.leaving_reason IS
  'Free-text note on why the teacher was retired (resigned, transferred, …).';

CREATE INDEX IF NOT EXISTS idx_teachers_active_name
  ON teachers(full_name) WHERE is_active;

-- Active teacher rows with neither a staff record nor a portal login: the
-- shape left behind by a staff deletion. A review queue, not an
-- auto-deactivate — a teacher created by bulk import and never linked looks
-- identical, so a human decides.
CREATE OR REPLACE VIEW public.teachers_needing_review AS
  SELECT t.id,
         t.employee_id,
         t.full_name,
         t.email,
         t.phone,
         t.date_of_joining,
         t.created_at,
         (SELECT count(*) FROM public.timetable_periods tp WHERE tp.teacher_id = t.id)
           AS timetable_period_count,
         (SELECT count(*) FROM public.class_subjects cs   WHERE cs.teacher_id = t.id)
           AS class_subject_count,
         (SELECT count(*) FROM public.classes c    WHERE c.class_teacher_id = t.id)
           AS class_teacher_count
  FROM public.teachers t
  WHERE t.is_active
    AND t.staff_member_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.teacher_id = t.id
    );

COMMENT ON VIEW public.teachers_needing_review IS
  'Active teacher records with no linked staff_members row and no portal '
  'profile — the shape left behind when a staff member is deleted from '
  'People → Staff (teachers.staff_member_id is ON DELETE SET NULL). Review '
  'queue for /people/teachers; retiring is an explicit admin action, never '
  'automatic.';

-- ============================================================================
-- MIGRATION 117 — teacher_subjects (which subjects a teacher can teach)
-- Mirrors scripts/migrations/erp/migration-117-teacher-subjects.sql
-- ============================================================================
-- Distinct from class_subjects: that answers "who teaches Maths to VI-B" (one
-- teacher per class+subject); this answers "who can teach Maths at all" (many
-- teachers, no class). It is what lets the assign-subject dropdown surface the
-- school's three maths teachers instead of all sixty staff.

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, subject_id)
);

COMMENT ON TABLE teacher_subjects IS
  'Which subjects a teacher is qualified to teach. Drives the "teachers of '
  'this subject first" ordering in the assign-subject dropdown. Distinct from '
  'class_subjects, which records who actually teaches a subject in one class.';

CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher
  ON teacher_subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject
  ON teacher_subjects(subject_id);

-- Authenticated read, not public: keyed on teacher_id, so an anon read would
-- enumerate every teacher UUID in the school (cf. migration 098). Writes are
-- admin-only; editors reach the table through the admin proxy's `subjects`
-- feature gate, as with class_subjects.
ALTER TABLE teacher_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read teacher_subjects"
  ON teacher_subjects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage teacher_subjects"
  ON teacher_subjects FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Assigning a teacher to a class subject teaches the system that they know
-- that subject. A trigger rather than app code because class_subjects.teacher_id
-- has five writers and adminApi() is a single-table proxy that cannot carry a
-- side effect. Add-only: un-assigning someone from VI-B Maths does not mean
-- they stopped knowing Maths.
CREATE OR REPLACE FUNCTION public.trg_learn_teacher_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subject_id IS NOT NULL THEN
    INSERT INTO public.teacher_subjects (teacher_id, subject_id)
    VALUES (NEW.teacher_id, NEW.subject_id)
    ON CONFLICT (teacher_id, subject_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_subject_learns_teacher_subject ON class_subjects;
CREATE TRIGGER class_subject_learns_teacher_subject
  AFTER INSERT OR UPDATE OF teacher_id ON class_subjects
  FOR EACH ROW
  WHEN (NEW.teacher_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_learn_teacher_subject();

-- The one-time seed from class_subjects and timetable_periods lives only in
-- the migration file: a database built fresh from this schema has nothing to
-- seed from.

-- ============================================================================
-- MIGRATION 118 — wings (a reusable class band with its own subject set)
-- Mirrors scripts/migrations/erp/migration-118-stream-wings.sql
-- ============================================================================
-- The school groups classes into wings — Middle Wing = VI–VIII and so on — and
-- wants a subject set defined once and pushed onto every class and section in
-- the band. `streams` is the only table that already owns a subject set
-- (stream_subjects), so wings live here under a discriminator.
--
-- `kind` is load-bearing, not cosmetic. classes.stream_id,
-- student_enrollments.stream_id and fee_structures.stream_id all read this
-- table and fee resolution keys off it, so a wing loose in that machinery would
-- change what students are charged. Wings are never attached to
-- classes.stream_id at all — they carry their band in `class_names` — and every
-- picker and importer name-lookup filters to kind='stream'. The two lookups
-- that resolve a STORED stream_id back to a name (api/export/students,
-- lib/report-query) are deliberately left unfiltered so a stored id always
-- renders.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stream',
  ADD COLUMN IF NOT EXISTS class_names text[] NOT NULL DEFAULT '{}';

ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_kind_check;
ALTER TABLE streams
  ADD CONSTRAINT streams_kind_check CHECK (kind IN ('stream', 'wing'));

COMMENT ON COLUMN streams.kind IS
  'stream = an academic stream for XI/XII (Science, Commerce, Humanities), the '
  'original meaning: attachable to classes.stream_id and read by fee '
  'resolution. wing = a band of classes with a shared subject set, used only to '
  'push subjects onto classes. Wings are filtered out of every stream picker '
  'and every importer name-lookup.';
COMMENT ON COLUMN streams.class_names IS
  'For kind=wing: the class names the wing covers, e.g. {VI,VII,VIII}. Names '
  'rather than class ids so the wing survives the academic-year rollover. '
  'Always empty for kind=stream.';

CREATE INDEX IF NOT EXISTS idx_streams_kind ON streams(kind);

-- ============================================================================
-- MIGRATION 119 — parallel teaching groups in one timetable period
-- Mirrors scripts/migrations/erp/migration-119-timetable-period-groups.sql
-- ============================================================================
-- The columns, the four-column unique key, the primary-group index and the
-- is_shared exemption on timetable_teacher_no_overlap are all applied inline
-- above, at the timetable_periods definition and at migration 071's constraint.
-- What remains here is the companion view.
--
-- A shared activity is exempt from the double-booking constraint, so what the
-- constraint no longer blocks has to stay visible somewhere. In a healthy
-- timetable every row of this view is an intentional combined activity; a row
-- where neither side is shared is a bug.

CREATE OR REPLACE VIEW public.timetable_teacher_clashes AS
  SELECT a.teacher_id,
         t.full_name        AS teacher_name,
         a.day_of_week,
         a.id               AS period_a,
         ca.name || COALESCE('-' || ca.section, '') AS class_a,
         a.start_time       AS a_start,
         a.end_time         AS a_end,
         a.is_shared        AS a_shared,
         b.id               AS period_b,
         cb.name || COALESCE('-' || cb.section, '') AS class_b,
         b.start_time       AS b_start,
         b.end_time         AS b_end,
         b.is_shared        AS b_shared
  FROM public.timetable_periods a
  JOIN public.timetable_periods b
    ON a.teacher_id = b.teacher_id
   AND a.day_of_week = b.day_of_week
   AND a.id < b.id
  LEFT JOIN public.teachers t  ON t.id  = a.teacher_id
  LEFT JOIN public.classes  ca ON ca.id = a.class_id
  LEFT JOIN public.classes  cb ON cb.id = b.class_id
  WHERE a.teacher_id IS NOT NULL
    AND a.is_break IS NOT TRUE AND b.is_break IS NOT TRUE
    AND a.start_time < b.end_time
    AND a.end_time > b.start_time;

-- A view runs with its OWNER's rights, so it is not held back by the RLS on
-- timetable_periods and teachers. This diagnostic is keyed on a teacher and
-- would enumerate staff UUIDs, so name who may read it rather than inheriting
-- the schema's default grants — the leak migration 098 was written to close.
REVOKE ALL ON public.timetable_teacher_clashes FROM PUBLIC, anon;
GRANT SELECT ON public.timetable_teacher_clashes TO authenticated;

COMMENT ON VIEW public.timetable_teacher_clashes IS
  'Teachers occupying two time-overlapping periods on one weekday. The DB '
  'constraint blocks these unless a row is marked is_shared, so in a healthy '
  'timetable every row here is an intentional combined activity. A row where '
  'neither side is shared is a bug. Surfaced at /timetable/clashes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 123 — enrollment exit date (billing cutoff for leavers)
-- (mirrored from scripts/migrations/erp/migration-123-enrollment-exit-date.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- Dues are computed, not stored: amountBilledToDate() charges every instalment
-- whose due date has passed. It reads the clock and never the roster, so a
-- student who left after the first quarter kept acquiring the second quarter's
-- instalment and every one after it.
--
-- `exit_date` is the missing fact — the last day the student was on the roll.
-- The dues maths clamps its "as of" date to it, so an instalment falling due
-- after that date is never billed. It is consulted ONLY when the enrollment is
-- in an exit status, which is why no CHECK ties the two together: a stale date
-- on a re-activated enrollment is inert, and a constraint would break the bulk
-- importers that write `status` directly.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS exit_date date;

COMMENT ON COLUMN student_enrollments.exit_date IS
  'Last day the student was on the roll. Read ONLY when status is exited or '
  'terminated, and then it is the billing cutoff: an instalment due after this '
  'date is never charged. NULL on an exit means the dues maths falls back to '
  'status_changed_at. Set by change_enrollment_status(); see '
  'apps/erp/src/lib/fees.ts resolveBillingCutoff().';

CREATE INDEX IF NOT EXISTS idx_student_enrollments_exit_date
  ON student_enrollments (exit_date)
  WHERE exit_date IS NOT NULL;

ALTER TABLE student_status_history
  ADD COLUMN IF NOT EXISTS effective_date date;

COMMENT ON COLUMN student_status_history.effective_date IS
  'The exit_date recorded with this transition, when one was supplied. Lets a '
  'later correction to a leaving date be distinguished from the original exit.';

-- change_enrollment_status(), superseding the migration-087 definition above.
-- Same signature — p_updates gains an optional "exit_date" key per element, so
-- callers that omit it keep working. Entering an exit status without a date
-- defaults to CURRENT_DATE rather than leaving NULL, because a NULL would
-- silently restore the unbounded billing this exists to stop; leaving an exit
-- status clears the date so a re-admitted student resumes billing. The date is
-- clamped to the academic year's end: billing for a year stops when the year
-- does, whatever the office typed.

CREATE OR REPLACE FUNCTION public.change_enrollment_status(
  p_updates jsonb,
  p_actor   uuid DEFAULT NULL,
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        jsonb;
  v_enrollment  record;
  v_new_status  text;
  v_reason      text;
  v_exit_date   date;
  v_year_end    date;
  v_updated     int := 0;
  v_skipped     int := 0;
  v_inactive    uuid[] := ARRAY[]::uuid[];
  v_reactivated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_status := v_item ->> 'status';
    v_reason     := NULLIF(btrim(COALESCE(v_item ->> 'reason', '')), '');

    SELECT se.id, se.student_id, se.class_id, se.academic_year_id, se.status
      INTO v_enrollment
      FROM student_enrollments se
      WHERE se.id = (v_item ->> 'enrollment_id')::uuid
      FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_enrollment.status IS NOT DISTINCT FROM v_new_status THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_exit_date := COALESCE(
        NULLIF(btrim(COALESCE(v_item ->> 'exit_date', '')), '')::date,
        CURRENT_DATE
      );
      SELECT ay.end_date INTO v_year_end
        FROM academic_years ay
        WHERE ay.id = v_enrollment.academic_year_id;
      IF v_year_end IS NOT NULL AND v_exit_date > v_year_end THEN
        v_exit_date := v_year_end;
      END IF;
    ELSE
      v_exit_date := NULL;
    END IF;

    INSERT INTO student_status_history (
      student_id, enrollment_id, academic_year_id, class_id,
      from_status, to_status, reason, source, changed_by, effective_date
    ) VALUES (
      v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
      v_enrollment.class_id, v_enrollment.status, v_new_status, v_reason,
      p_source, p_actor, v_exit_date
    );

    UPDATE student_enrollments
      SET status            = v_new_status,
          status_reason     = v_reason,
          status_changed_at = now(),
          status_changed_by = p_actor,
          exit_date         = v_exit_date,
          updated_at        = now()
      WHERE id = v_enrollment.id;

    IF v_new_status IN ('terminated', 'exited') THEN
      v_inactive := v_inactive || v_enrollment.student_id;
    ELSE
      v_reactivated := v_reactivated || v_enrollment.student_id;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  IF array_length(v_inactive, 1) > 0 THEN
    UPDATE students
      SET is_active = false, updated_at = now()
      WHERE id = ANY(v_inactive) AND is_active IS DISTINCT FROM false;
  END IF;

  IF array_length(v_reactivated, 1) > 0 THEN
    UPDATE students
      SET is_active = true, updated_at = now()
      WHERE id = ANY(v_reactivated)
        AND id <> ALL(v_inactive)
        AND is_active IS DISTINCT FROM true;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_enrollment_status(jsonb, uuid, text) FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 124 — editor-aware RLS; fee_payments readable by a Fees editor
-- (mirrored from scripts/migrations/erp/migration-124-fee-payments-editor-rls.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- The fee screens read fee_payments straight from the browser, so Postgres
-- applies RLS — and the only SELECT paths were admin, the student, and their
-- parents. A staff account holding the 'fees' editor grant matched none of
-- them, so every read came back empty: "No payments recorded yet" against a
-- student who had paid, the Dues register pricing the whole school at paid=0,
-- and writes still succeeding through the service-role API routes, which
-- invites recording the same receipt twice.
--
-- Same fault migration 084 fixed for students/student_enrollments; the money
-- table was missed. Fixed feature-aware rather than role-coarse: with the
-- (SELECT …) wrapping from migration 102 the check is one InitPlan per query,
-- so precision costs nothing and no staff account gets every family's payment
-- history just for being staff.
--
-- has_editor_capability() is the hook this database never had for
-- editor_permissions. The tables still carrying the same gap — attendance,
-- results, non_scholastic_assessments, marksheet_publications — each become a
-- six-line follow-up now that it exists.

CREATE OR REPLACE FUNCTION public.has_editor_capability(p_feature text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (
         p.role = 'admin'
         OR EXISTS (
           SELECT 1
             FROM public.editor_permissions ep
            WHERE ep.editor_id = p.id
              AND ep.feature_key = p_feature
         )
       )
  );
$$;

COMMENT ON FUNCTION public.has_editor_capability(text) IS
  'True when the calling user holds this feature key: admins always, everyone '
  'else via editor_permissions. The RLS-side counterpart of '
  'verifyAdminOrEditor() in packages/shared/src/lib/verify-admin.ts. Call it '
  'wrapped as (SELECT has_editor_capability(''key'')) so it is evaluated once '
  'per query as an InitPlan rather than once per row — see migration 102.';

-- PUBLIC's default EXECUTE is deliberately left in place: with no session the
-- function returns false, and revoking it would turn an anonymous read of any
-- table carrying this policy into a hard error instead of an empty result.
GRANT EXECUTE ON FUNCTION public.has_editor_capability(text) TO authenticated;

-- SELECT only. Every write already goes through a server route on the
-- service-role client behind verifyAdminOrEditor('fees'); granting writes here
-- would add a weaker second path that bypasses the change-request workflow.
DROP POLICY IF EXISTS "fee_payments_select_fee_editor" ON public.fee_payments;
CREATE POLICY "fee_payments_select_fee_editor"
  ON public.fee_payments FOR SELECT
  USING ((SELECT public.has_editor_capability('fees')));

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 125 — editor-aware RLS for the remaining screens
-- (mirrored from scripts/migrations/erp/migration-125-editor-rls-remaining-tables.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- Admin screens read from the browser, so RLS applies, and where no policy
-- admits the caller it FILTERS ROWS RATHER THAN RAISING — the page renders
-- empty with nothing anywhere to say the granted feature does not work.
--
-- 084 fixed students/student_enrollments; 124 fixed fee_payments and added
-- has_editor_capability(). These five were the remainder: each was admin +
-- teacher + student + parent with no staff path at all. Every other table an
-- admin screen reads client-side was audited and already admits staff (most
-- are read-by-anyone master data; students/enrollments/profiles carry explicit
-- staff policies; fee_payments is feature-gated by 124).
--
--   attendance                  /attendance                        'attendance'
--   results                     /exams/results                     'results'
--   non_scholastic_assessments  /exams/non-scholastic-assessments  'non_scholastic_entry'
--   marksheet_publications      /exams/publish                     'publish_results'
--   ptm_notes                   /exams/ptm-notes                   'ptm_notes'
--
-- Each key is the one the middleware gate already requires for that path, so a
-- policy grants exactly what ticking that box promises and nothing else — a
-- staff member granted Attendance still cannot read marks.
--
-- SELECT only: none of the five is written from the browser. Marks entry,
-- attendance marking, publishing and PTM notes all post to server routes
-- running verifyAdminOrEditor() on the service-role client, and adding writes
-- here would be a weaker second way in. No is_published filter, unlike the
-- student/parent policies: an editor checking marks must see them before they
-- are published, which is why the admin policy has no filter either.

DROP POLICY IF EXISTS "attendance_select_editor" ON public.attendance;
CREATE POLICY "attendance_select_editor"
  ON public.attendance FOR SELECT
  USING ((SELECT public.has_editor_capability('attendance')));

DROP POLICY IF EXISTS "results_select_editor" ON public.results;
CREATE POLICY "results_select_editor"
  ON public.results FOR SELECT
  USING ((SELECT public.has_editor_capability('results')));

DROP POLICY IF EXISTS "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments;
CREATE POLICY "non_scholastic_assessments_select_editor"
  ON public.non_scholastic_assessments FOR SELECT
  USING ((SELECT public.has_editor_capability('non_scholastic_entry')));

DROP POLICY IF EXISTS "marksheet_publications_select_editor"
  ON public.marksheet_publications;
CREATE POLICY "marksheet_publications_select_editor"
  ON public.marksheet_publications FOR SELECT
  USING ((SELECT public.has_editor_capability('publish_results')));

DROP POLICY IF EXISTS "ptm_notes_select_editor" ON public.ptm_notes;
CREATE POLICY "ptm_notes_select_editor"
  ON public.ptm_notes FOR SELECT
  USING ((SELECT public.has_editor_capability('ptm_notes')));

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 126 — correct a leaving date after the fact
-- (mirrored from scripts/migrations/erp/migration-126-set-enrollment-exit-date.sql)
-- ═══════════════════════════════════════════════════════════════════════════
-- exit_date is the fee billing cutoff (migration 123). It is collected when a
-- student is marked Exited/Terminated and backfilled for everyone who left
-- before it existed — but where the paperwork lagged, that backfill lands on
-- the day the exit was TYPED, and the student keeps instalments they were
-- never meant to owe. Nothing could correct it: the date field only appears
-- when moving INTO an exit status, and re-selecting a status a student already
-- holds is a no-op change_enrollment_status() skips.
--
-- An RPC for the same reason migration 087's is one: the audit row and the
-- write must not come apart, and PostgREST gives the route no transaction. The
-- history row records from_status = to_status — the status did not change,
-- only the date on it — with effective_date carrying the new value, so a
-- correction reads differently from the original exit. status_changed_at,
-- status_changed_by and status_reason are deliberately left alone.

CREATE OR REPLACE FUNCTION public.set_enrollment_exit_date(
  p_enrollment_id uuid,
  p_exit_date     date,
  p_note          text DEFAULT NULL,
  p_actor         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment record;
  v_year_end   date;
  v_new        date;
  v_note       text;
  v_reason     text;
BEGIN
  IF p_exit_date IS NULL THEN
    RAISE EXCEPTION 'A leaving date is required';
  END IF;

  SELECT se.id, se.student_id, se.class_id, se.academic_year_id,
         se.status, se.exit_date
    INTO v_enrollment
    FROM student_enrollments se
   WHERE se.id = p_enrollment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment not found';
  END IF;

  -- A leaving date only means anything for someone who has left. On an active
  -- enrollment it would sit inert until some future status change, and the
  -- dues maths would ignore it — so refuse rather than store a value that
  -- looks set and does nothing.
  IF v_enrollment.status NOT IN ('exited', 'terminated') THEN
    RAISE EXCEPTION
      'Only a student marked Exited or Terminated has a leaving date (this one is %)',
      v_enrollment.status;
  END IF;

  -- A future date would bill instalments that have not been raised yet.
  IF p_exit_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A leaving date cannot be in the future';
  END IF;

  -- Billing for a session stops when the session does, whatever was typed.
  SELECT ay.end_date INTO v_year_end
    FROM academic_years ay
   WHERE ay.id = v_enrollment.academic_year_id;

  v_new := p_exit_date;
  IF v_year_end IS NOT NULL AND v_new > v_year_end THEN
    v_new := v_year_end;
  END IF;

  IF v_enrollment.exit_date IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'changed', false,
      'exit_date', v_new
    );
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  -- Self-describing, so the history row stands on its own a year later — and
  -- long enough to satisfy the >= 5 character reason CHECK without forcing the
  -- office to type a justification for a typo fix. A note, when given, is
  -- appended rather than replacing it.
  v_reason := 'Leaving date corrected from '
           || COALESCE(v_enrollment.exit_date::text, '(not recorded)')
           || ' to ' || v_new::text
           || COALESCE(' — ' || v_note, '');

  INSERT INTO student_status_history (
    student_id, enrollment_id, academic_year_id, class_id,
    from_status, to_status, reason, source, changed_by, effective_date
  ) VALUES (
    v_enrollment.student_id, v_enrollment.id, v_enrollment.academic_year_id,
    v_enrollment.class_id,
    v_enrollment.status, v_enrollment.status,  -- a correction, not a transition
    v_reason, 'manual', p_actor, v_new
  );

  UPDATE student_enrollments
     SET exit_date  = v_new,
         updated_at = now()
   WHERE id = v_enrollment.id;

  RETURN jsonb_build_object(
    'changed', true,
    'exit_date', v_new,
    'previous_exit_date', v_enrollment.exit_date
  );
END;
$$;

COMMENT ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) IS
  'Correct the leaving date on an enrollment that is already Exited or '
  'Terminated, writing the matching student_status_history row in the same '
  'transaction. The date is the fee billing cutoff (migration 123). Status, '
  'status_reason and status_changed_at are left untouched — this records a '
  'correction, not a transition.';

-- Authorised in the route via verifyAdminOrEditorWithUser("students"), exactly
-- as change_enrollment_status is. No grant to anon/authenticated.
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_enrollment_exit_date(uuid, date, text, uuid) FROM anon, authenticated;

-- ============================================================
-- CLASS DIARY (Murlipura-local, migration-903-class-diary.sql)
-- Homework, holiday homework, notices, fee reminders and photos
-- posted to a class (or the whole school when class_id IS NULL).
-- Reads/writes go through /api/class-diary (service role); the
-- SELECT policies mirror the API scope.
-- ============================================================
CREATE TABLE IF NOT EXISTS class_diary_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = whole school.
  class_id         uuid REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  subject_id       uuid REFERENCES subjects(id) ON DELETE SET NULL,
  kind             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  -- The school day the post is for, in IST — not created_at, which is UTC and
  -- lands on the previous day for anything posted before 05:30.
  post_date        date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  due_date         date,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_pinned        boolean NOT NULL DEFAULT false,
  -- Rows sharing a batch_id were posted together to several classes.
  batch_id         uuid,
  -- SET NULL, not CASCADE: a teacher's posts outlive their login.
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Denormalised so the feed still names the author after the profile goes.
  author_name      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT class_diary_kind_known CHECK (
    kind IN ('homework', 'holiday_homework', 'notice', 'fee_reminder', 'photos')
  ),
  CONSTRAINT class_diary_title_len CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT class_diary_body_len CHECK (length(body) <= 5000),
  CONSTRAINT class_diary_attachments_array CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT class_diary_due_after_post CHECK (due_date IS NULL OR due_date >= post_date)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_class_date
  ON class_diary_posts (class_id, post_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_diary_school_wide
  ON class_diary_posts (post_date DESC, created_at DESC) WHERE class_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_diary_created_by
  ON class_diary_posts (created_by);
CREATE INDEX IF NOT EXISTS idx_class_diary_subject
  ON class_diary_posts (subject_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_year
  ON class_diary_posts (academic_year_id);
CREATE INDEX IF NOT EXISTS idx_class_diary_batch
  ON class_diary_posts (batch_id) WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_class_diary_posts ON class_diary_posts;
CREATE TRIGGER set_updated_at_class_diary_posts
  BEFORE UPDATE ON class_diary_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read receipts — the ERP's version of WhatsApp's blue ticks. One row per
-- (post, reader); the teacher sees a count, never a list of who has not read.
CREATE TABLE IF NOT EXISTS class_diary_reads (
  post_id    uuid NOT NULL REFERENCES class_diary_posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_class_diary_reads_profile
  ON class_diary_reads (profile_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE class_diary_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_diary_reads ENABLE ROW LEVEL SECURITY;

-- (select …) wrappers so each helper is evaluated once per statement rather
-- than once per row (migration 102).
DROP POLICY IF EXISTS "Admins and diary editors read class diary" ON class_diary_posts;
CREATE POLICY "Admins and diary editors read class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'admin'
    OR (select public.has_editor_feature('class_diary'))
  );

DROP POLICY IF EXISTS "Teachers read their classes' diary" ON class_diary_posts;
CREATE POLICY "Teachers read their classes' diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'teacher'
    AND (
      class_id IS NULL
      OR class_id IN (SELECT public.get_my_class_ids())
      OR created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Students read their class diary" ON class_diary_posts;
CREATE POLICY "Students read their class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'student'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id = (select public.get_my_student_id())
      )
    )
  );

DROP POLICY IF EXISTS "Parents read their children's class diary" ON class_diary_posts;
CREATE POLICY "Parents read their children's class diary"
  ON class_diary_posts FOR SELECT
  USING (
    (select public.get_user_role()) = 'parent'
    AND (
      class_id IS NULL
      OR class_id IN (
        SELECT e.class_id
        FROM student_enrollments e
        JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
        WHERE e.student_id IN (SELECT public.get_my_children_ids())
      )
    )
  );

DROP POLICY IF EXISTS "Users read their own diary receipts" ON class_diary_reads;
CREATE POLICY "Users read their own diary receipts"
  ON class_diary_reads FOR SELECT
  USING (profile_id = (select auth.uid()));

-- ── Storage ─────────────────────────────────────────────────────────────────
-- Private. No storage.objects policies on purpose: uploads use signed upload
-- URLs minted by /api/class-diary/upload-url after the scope check, and
-- downloads use signed URLs minted by the feed route.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-diary', 'class-diary', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

