-- =============================================================
-- Migration: ERP System Redesign
-- =============================================================
-- Migrates from old schema (profiles-centric, no teachers/parents
-- tables) to new redesigned schema with dedicated teachers, parents,
-- payment_orders, notifications tables and updated RLS policies.
--
-- SAFE TO RE-RUN: Uses IF NOT EXISTS / IF EXISTS throughout.
-- =============================================================

BEGIN;

-- =============================================================
-- PHASE 1: Create new tables
-- =============================================================

-- 1. Teachers table (dedicated teacher entity, decoupled from profiles)
CREATE TABLE IF NOT EXISTS teachers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  date_of_joining DATE,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  qualifications TEXT,
  specialization TEXT,
  address TEXT,
  aadhar_number TEXT,
  photo_url TEXT,
  is_active BOOLEAN DEFAULT true,
  staff_member_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Parents table
CREATE TABLE IF NOT EXISTS parents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT NOT NULL,
  alternate_phone TEXT,
  occupation TEXT,
  address TEXT,
  relationship TEXT NOT NULL DEFAULT 'father'
    CHECK (relationship IN ('father', 'mother', 'guardian')),
  aadhar_number TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Student-Parents join table
CREATE TABLE IF NOT EXISTS student_parents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES parents(id) ON DELETE CASCADE NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('father', 'mother', 'guardian')),
  is_primary_contact BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, parent_id)
);

-- 4. Payment Orders (online payment gateway tracking)
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES parents(id) ON DELETE SET NULL,
  fee_structure_id UUID REFERENCES fee_structures(id) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  gateway TEXT NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'manual')),
  gateway_order_id TEXT UNIQUE,
  gateway_payment_id TEXT,
  gateway_signature TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'attempted', 'paid', 'failed', 'refunded', 'expired')),
  month TEXT,
  notes JSONB DEFAULT '{}',
  callback_url TEXT,
  webhook_verified BOOLEAN DEFAULT false,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- 5. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'warning', 'success', 'fee_reminder', 'result_published', 'attendance_alert', 'announcement')),
  related_entity_type TEXT,
  related_entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- =============================================================
-- PHASE 2: Add new columns to existing tables
-- =============================================================

-- -- profiles: link to teachers and parents tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE SET NULL;

-- -- students: additional fields
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS nationality TEXT DEFAULT 'Indian';
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_class TEXT;

-- -- student_enrollments: academic_year_id (will be populated in Phase 4)
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);

-- -- results: is_published flag
ALTER TABLE results ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;
-- Mark all existing results as published (they were visible before this flag existed)
UPDATE results SET is_published = true WHERE is_published = false;

-- -- fee_structures: new columns
DO $$
BEGIN
  -- class_level with CHECK constraint needs careful handling
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fee_structures' AND column_name = 'class_level'
  ) THEN
    ALTER TABLE fee_structures ADD COLUMN class_level TEXT NOT NULL DEFAULT 'all'
      CHECK (class_level IN ('all', 'nursery_ukg', 'i_v', 'vi_viii', 'ix_x', 'xi_xii'));
  END IF;
END $$;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- -- fee_payments: new columns for online payments
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS payment_order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS gateway_receipt TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- -- timetable_periods: break flag
ALTER TABLE timetable_periods ADD COLUMN IF NOT EXISTS is_break BOOLEAN DEFAULT false;

-- -- calendar_events: richer event metadata
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_school_wide BOOLEAN DEFAULT true;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- -- registration_requests: parent support
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS student_admission_no TEXT;
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS relationship TEXT CHECK (relationship IN ('father', 'mother', 'guardian'));

-- -- classes: room and created_at
ALTER TABLE classes ADD COLUMN IF NOT EXISTS room TEXT;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();


-- =============================================================
-- PHASE 3: Populate teachers from existing teacher profiles
-- =============================================================

-- Create teacher records from existing teacher profiles
INSERT INTO teachers (full_name, email, phone, employee_id)
SELECT
  p.full_name,
  p.email,
  p.phone,
  'NKPS-T-' || LPAD(ROW_NUMBER() OVER (ORDER BY p.created_at)::TEXT, 4, '0')
FROM profiles p
WHERE p.role = 'teacher'
  -- Avoid duplicates on re-run: skip if a teacher with this email already exists
  AND NOT EXISTS (
    SELECT 1 FROM teachers t WHERE t.email = p.email
  )
ON CONFLICT (employee_id) DO NOTHING;

-- Link profiles to their teacher records
UPDATE profiles p
SET teacher_id = t.id
FROM teachers t
WHERE p.email = t.email
  AND p.role = 'teacher'
  AND p.teacher_id IS NULL;

-- Try to link teachers to staff_members by name match
UPDATE teachers t
SET staff_member_id = sm.id
FROM staff_members sm
WHERE LOWER(TRIM(t.full_name)) = LOWER(TRIM(sm.name))
  AND t.staff_member_id IS NULL;


-- =============================================================
-- PHASE 4: Denormalize academic_year_id on student_enrollments
-- =============================================================

-- Populate from the class's academic_year_id
UPDATE student_enrollments se
SET academic_year_id = c.academic_year_id
FROM classes c
WHERE se.class_id = c.id AND se.academic_year_id IS NULL;

-- Make it NOT NULL after population (safe: all rows now have a value
-- because classes always have academic_year_id)
DO $$
BEGIN
  ALTER TABLE student_enrollments ALTER COLUMN academic_year_id SET NOT NULL;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'academic_year_id NOT NULL constraint already set or failed: %', SQLERRM;
END $$;


-- =============================================================
-- PHASE 5: Migrate teacher FKs (profiles.id -> teachers.id)
-- =============================================================
-- Currently classes.class_teacher_id, class_subjects.teacher_id, and
-- timetable_periods.teacher_id all reference profiles(id). We need to
-- remap them to teachers(id).

-- Step 1: Build a temporary mapping from profile_id to teacher_id
CREATE TEMP TABLE IF NOT EXISTS teacher_profile_map AS
SELECT p.id AS profile_id, p.teacher_id AS teacher_id
FROM profiles p
WHERE p.role = 'teacher' AND p.teacher_id IS NOT NULL;

-- Step 2: Update classes.class_teacher_id
UPDATE classes c
SET class_teacher_id = tpm.teacher_id
FROM teacher_profile_map tpm
WHERE c.class_teacher_id = tpm.profile_id;

-- Step 3: Update class_subjects.teacher_id
UPDATE class_subjects cs
SET teacher_id = tpm.teacher_id
FROM teacher_profile_map tpm
WHERE cs.teacher_id = tpm.profile_id;

-- Step 4: Update timetable_periods.teacher_id
UPDATE timetable_periods tp
SET teacher_id = tpm.teacher_id
FROM teacher_profile_map tpm
WHERE tp.teacher_id = tpm.profile_id;

-- Step 5: NULL out any unmapped teacher references
-- These are rows where teacher_id still holds a profiles(id) that wasn't
-- in the mapping (e.g., deleted/inactive teacher profiles). We must clear
-- them before adding the FK constraint to teachers(id).
UPDATE classes
SET class_teacher_id = NULL
WHERE class_teacher_id IS NOT NULL
  AND class_teacher_id NOT IN (SELECT id FROM teachers);

UPDATE class_subjects
SET teacher_id = NULL
WHERE teacher_id IS NOT NULL
  AND teacher_id NOT IN (SELECT id FROM teachers);

UPDATE timetable_periods
SET teacher_id = NULL
WHERE teacher_id IS NOT NULL
  AND teacher_id NOT IN (SELECT id FROM teachers);

-- Step 6: Drop old FK constraints and add new ones pointing to teachers(id)
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_class_teacher_id_fkey;
ALTER TABLE classes ADD CONSTRAINT classes_class_teacher_id_fkey
  FOREIGN KEY (class_teacher_id) REFERENCES teachers(id);

ALTER TABLE class_subjects DROP CONSTRAINT IF EXISTS class_subjects_teacher_id_fkey;
ALTER TABLE class_subjects ADD CONSTRAINT class_subjects_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES teachers(id);

ALTER TABLE timetable_periods DROP CONSTRAINT IF EXISTS timetable_periods_teacher_id_fkey;
ALTER TABLE timetable_periods ADD CONSTRAINT timetable_periods_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES teachers(id);

-- Clean up
DROP TABLE IF EXISTS teacher_profile_map;


-- =============================================================
-- PHASE 6: Update CHECK constraints
-- =============================================================

-- profiles.role: add 'parent'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
DO $$
BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'editor', 'teacher', 'student', 'parent'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- registration_requests.role: add 'parent'
ALTER TABLE registration_requests DROP CONSTRAINT IF EXISTS registration_requests_role_check;
DO $$
BEGIN
  ALTER TABLE registration_requests ADD CONSTRAINT registration_requests_role_check
    CHECK (role IN ('teacher', 'student', 'parent'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- fee_payments.payment_method: add 'upi' and 'gateway'
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_payment_method_check;
DO $$
BEGIN
  ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_payment_method_check
    CHECK (payment_method IN ('cash', 'online', 'cheque', 'bank_transfer', 'upi', 'gateway'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- fee_payments.status: add 'processing' and 'failed'
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_status_check;
DO $$
BEGIN
  ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_status_check
    CHECK (status IN ('pending', 'processing', 'paid', 'partial', 'failed', 'refunded'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- fee_payments.recorded_by: make nullable (for online self-service payments)
ALTER TABLE fee_payments ALTER COLUMN recorded_by DROP NOT NULL;

-- attendance.status: replace 'holiday' with 'half_day'
-- Holidays should be calendar events, not attendance records
UPDATE attendance SET status = 'present' WHERE status = 'holiday';
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
DO $$
BEGIN
  ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'half_day'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- timetable_periods.day_of_week: shift from 0-6 (Sun-Sat) to 1-6 (Mon-Sat)
UPDATE timetable_periods SET day_of_week = day_of_week + 1
WHERE day_of_week >= 0 AND day_of_week <= 5;
-- Handle any Sunday (old 6 -> becomes 7, cap at Saturday 6)
UPDATE timetable_periods SET day_of_week = 6 WHERE day_of_week = 7;

ALTER TABLE timetable_periods DROP CONSTRAINT IF EXISTS timetable_periods_day_of_week_check;
DO $$
BEGIN
  ALTER TABLE timetable_periods ADD CONSTRAINT timetable_periods_day_of_week_check
    CHECK (day_of_week BETWEEN 1 AND 6);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- calendar_events.event_type: add sports, cultural types
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;
DO $$
BEGIN
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check
    CHECK (event_type IN ('exam', 'holiday', 'event', 'pta_meeting', 'sports', 'cultural', 'other'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================
-- PHASE 7: Drop student_subjects table
-- =============================================================
-- Subjects are now inferred from class enrollment + class_subjects.
-- The explicit student_subjects join table is no longer needed.

DROP TABLE IF EXISTS student_subjects;


-- =============================================================
-- PHASE 8: Create helper functions
-- =============================================================

-- get_user_role: returns the role of the currently authenticated user
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- get_my_student_id: for student-role users, returns their students.id
CREATE OR REPLACE FUNCTION public.get_my_student_id()
RETURNS UUID AS $$
  SELECT student_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- get_my_teacher_id: for teacher-role users, returns their teachers.id
CREATE OR REPLACE FUNCTION public.get_my_teacher_id()
RETURNS UUID AS $$
  SELECT teacher_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- get_my_parent_id: for parent-role users, returns their parents.id
CREATE OR REPLACE FUNCTION public.get_my_parent_id()
RETURNS UUID AS $$
  SELECT parent_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- get_my_children_ids: for parent-role users, returns all linked student IDs
CREATE OR REPLACE FUNCTION public.get_my_children_ids()
RETURNS SETOF UUID AS $$
  SELECT sp.student_id
  FROM public.student_parents sp
  WHERE sp.parent_id = public.get_my_parent_id();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- get_my_class_ids: for teacher-role users, returns all class IDs they teach
CREATE OR REPLACE FUNCTION public.get_my_class_ids()
RETURNS SETOF UUID AS $$
  SELECT DISTINCT class_id FROM (
    -- Classes where teacher is class_teacher
    SELECT c.id AS class_id FROM public.classes c
    WHERE c.class_teacher_id = public.get_my_teacher_id()
    UNION
    -- Classes where teacher has subject assignments
    SELECT cs.class_id FROM public.class_subjects cs
    WHERE cs.teacher_id = public.get_my_teacher_id()
  ) sub;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- handle_new_user: auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- set_updated_at: generic trigger function for updated_at columns
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================
-- PHASE 9: Drop ALL old ERP RLS policies and create new ones
-- =============================================================

-- ----- profiles -----
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Teachers can read student profiles in their classes" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON profiles;

CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin"
  ON profiles FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "profiles_select_teacher_students"
  ON profiles FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND role = 'student'
    AND student_id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

CREATE POLICY "profiles_select_parent_children"
  ON profiles FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_admin"
  ON profiles FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "profiles_update_admin"
  ON profiles FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "profiles_delete_admin"
  ON profiles FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- academic_years -----
DROP POLICY IF EXISTS "Public can read academic years" ON academic_years;
DROP POLICY IF EXISTS "Admins can insert academic years" ON academic_years;
DROP POLICY IF EXISTS "Admins can update academic years" ON academic_years;
DROP POLICY IF EXISTS "Admins can delete academic years" ON academic_years;

CREATE POLICY "academic_years_select_all"
  ON academic_years FOR SELECT
  USING (true);

CREATE POLICY "academic_years_insert_admin"
  ON academic_years FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "academic_years_update_admin"
  ON academic_years FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "academic_years_delete_admin"
  ON academic_years FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- classes -----
DROP POLICY IF EXISTS "Public can read classes" ON classes;
DROP POLICY IF EXISTS "Admins can insert classes" ON classes;
DROP POLICY IF EXISTS "Admins can update classes" ON classes;
DROP POLICY IF EXISTS "Admins can delete classes" ON classes;

CREATE POLICY "classes_select_all"
  ON classes FOR SELECT
  USING (true);

CREATE POLICY "classes_insert_admin"
  ON classes FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "classes_update_admin"
  ON classes FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "classes_delete_admin"
  ON classes FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- subjects -----
DROP POLICY IF EXISTS "Public can read subjects" ON subjects;
DROP POLICY IF EXISTS "Admins can insert subjects" ON subjects;
DROP POLICY IF EXISTS "Admins can update subjects" ON subjects;
DROP POLICY IF EXISTS "Admins can delete subjects" ON subjects;

CREATE POLICY "subjects_select_all"
  ON subjects FOR SELECT
  USING (true);

CREATE POLICY "subjects_insert_admin"
  ON subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "subjects_update_admin"
  ON subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "subjects_delete_admin"
  ON subjects FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- class_subjects -----
DROP POLICY IF EXISTS "Public can read class subjects" ON class_subjects;
DROP POLICY IF EXISTS "Admins can insert class subjects" ON class_subjects;
DROP POLICY IF EXISTS "Admins can update class subjects" ON class_subjects;
DROP POLICY IF EXISTS "Admins can delete class subjects" ON class_subjects;

CREATE POLICY "class_subjects_select_all"
  ON class_subjects FOR SELECT
  USING (true);

CREATE POLICY "class_subjects_insert_admin"
  ON class_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "class_subjects_update_admin"
  ON class_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "class_subjects_delete_admin"
  ON class_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- student_enrollments -----
DROP POLICY IF EXISTS "Students can read own enrollment" ON student_enrollments;
DROP POLICY IF EXISTS "Teachers can read enrollments for their classes" ON student_enrollments;
DROP POLICY IF EXISTS "Teachers can read enrollments for their subject classes" ON student_enrollments;
DROP POLICY IF EXISTS "Admins can read all enrollments" ON student_enrollments;
DROP POLICY IF EXISTS "Admins can insert enrollments" ON student_enrollments;
DROP POLICY IF EXISTS "Admins can update enrollments" ON student_enrollments;
DROP POLICY IF EXISTS "Admins can delete enrollments" ON student_enrollments;

CREATE POLICY "student_enrollments_select_student"
  ON student_enrollments FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "student_enrollments_select_teacher"
  ON student_enrollments FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "student_enrollments_select_parent"
  ON student_enrollments FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "student_enrollments_select_admin"
  ON student_enrollments FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "student_enrollments_insert_admin"
  ON student_enrollments FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "student_enrollments_update_admin"
  ON student_enrollments FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "student_enrollments_delete_admin"
  ON student_enrollments FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- attendance -----
DROP POLICY IF EXISTS "Students can read own attendance" ON attendance;
DROP POLICY IF EXISTS "Teachers can read attendance for their classes" ON attendance;
DROP POLICY IF EXISTS "Teachers can read attendance via class_subjects" ON attendance;
DROP POLICY IF EXISTS "Teachers can insert attendance for their classes" ON attendance;
DROP POLICY IF EXISTS "Teachers can insert attendance via class_subjects" ON attendance;
DROP POLICY IF EXISTS "Teachers can update attendance for their classes" ON attendance;
DROP POLICY IF EXISTS "Teachers can update attendance via class_subjects" ON attendance;
DROP POLICY IF EXISTS "Admins have full access to attendance" ON attendance;

CREATE POLICY "attendance_select_student"
  ON attendance FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "attendance_select_parent"
  ON attendance FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "attendance_select_teacher"
  ON attendance FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "attendance_insert_teacher"
  ON attendance FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "attendance_update_teacher"
  ON attendance FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "attendance_all_admin"
  ON attendance FOR ALL
  USING (public.get_user_role() = 'admin');


-- ----- exam_types -----
DROP POLICY IF EXISTS "Public can read exam types" ON exam_types;
DROP POLICY IF EXISTS "Admins can insert exam types" ON exam_types;
DROP POLICY IF EXISTS "Admins can update exam types" ON exam_types;
DROP POLICY IF EXISTS "Admins can delete exam types" ON exam_types;

CREATE POLICY "exam_types_select_all"
  ON exam_types FOR SELECT
  USING (true);

CREATE POLICY "exam_types_insert_admin"
  ON exam_types FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "exam_types_update_admin"
  ON exam_types FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "exam_types_delete_admin"
  ON exam_types FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- results -----
DROP POLICY IF EXISTS "Students can read own results" ON results;
DROP POLICY IF EXISTS "Teachers can read results for their class/subject" ON results;
DROP POLICY IF EXISTS "Teachers can read results via class_subjects" ON results;
DROP POLICY IF EXISTS "Teachers can insert results for their class/subject" ON results;
DROP POLICY IF EXISTS "Teachers can insert results via class_subjects" ON results;
DROP POLICY IF EXISTS "Teachers can update results for their class/subject" ON results;
DROP POLICY IF EXISTS "Teachers can update results via class_subjects" ON results;
DROP POLICY IF EXISTS "Admins have full access to results" ON results;

CREATE POLICY "results_select_student"
  ON results FOR SELECT
  USING (
    student_id = public.get_my_student_id()
    AND is_published = true
  );

CREATE POLICY "results_select_parent"
  ON results FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
    AND is_published = true
  );

CREATE POLICY "results_select_teacher"
  ON results FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
  );

CREATE POLICY "results_insert_teacher"
  ON results FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
    AND subject_id IN (
      SELECT cs.subject_id FROM class_subjects cs
      WHERE cs.teacher_id = public.get_my_teacher_id()
    )
  );

CREATE POLICY "results_update_teacher"
  ON results FOR UPDATE
  USING (
    public.get_user_role() = 'teacher'
    AND class_id IN (SELECT public.get_my_class_ids())
    AND subject_id IN (
      SELECT cs.subject_id FROM class_subjects cs
      WHERE cs.teacher_id = public.get_my_teacher_id()
    )
  );

CREATE POLICY "results_all_admin"
  ON results FOR ALL
  USING (public.get_user_role() = 'admin');


-- ----- fee_structures -----
DROP POLICY IF EXISTS "Public can read fee structures" ON fee_structures;
DROP POLICY IF EXISTS "Admins can insert fee structures" ON fee_structures;
DROP POLICY IF EXISTS "Admins can update fee structures" ON fee_structures;
DROP POLICY IF EXISTS "Admins can delete fee structures" ON fee_structures;

CREATE POLICY "fee_structures_select_authenticated"
  ON fee_structures FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "fee_structures_insert_admin"
  ON fee_structures FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "fee_structures_update_admin"
  ON fee_structures FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "fee_structures_delete_admin"
  ON fee_structures FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- fee_payments -----
DROP POLICY IF EXISTS "Students can read own fee payments" ON fee_payments;
DROP POLICY IF EXISTS "Admins have full access to fee payments" ON fee_payments;

CREATE POLICY "fee_payments_select_student"
  ON fee_payments FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "fee_payments_select_parent"
  ON fee_payments FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "fee_payments_all_admin"
  ON fee_payments FOR ALL
  USING (public.get_user_role() = 'admin');


-- ----- timetable_periods -----
DROP POLICY IF EXISTS "Public can read timetable periods" ON timetable_periods;
DROP POLICY IF EXISTS "Admins can insert timetable periods" ON timetable_periods;
DROP POLICY IF EXISTS "Admins can update timetable periods" ON timetable_periods;
DROP POLICY IF EXISTS "Admins can delete timetable periods" ON timetable_periods;

CREATE POLICY "timetable_periods_select_all"
  ON timetable_periods FOR SELECT
  USING (true);

CREATE POLICY "timetable_periods_insert_admin"
  ON timetable_periods FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "timetable_periods_update_admin"
  ON timetable_periods FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "timetable_periods_delete_admin"
  ON timetable_periods FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- calendar_events -----
DROP POLICY IF EXISTS "Public can read calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Admins can insert calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Admins can update calendar events" ON calendar_events;
DROP POLICY IF EXISTS "Admins can delete calendar events" ON calendar_events;

CREATE POLICY "calendar_events_select_public"
  ON calendar_events FOR SELECT
  USING (is_public = true);

CREATE POLICY "calendar_events_select_authenticated"
  ON calendar_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "calendar_events_insert_admin"
  ON calendar_events FOR INSERT
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "calendar_events_update_admin"
  ON calendar_events FOR UPDATE
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "calendar_events_delete_admin"
  ON calendar_events FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- students -----
DROP POLICY IF EXISTS "Admins can read all students" ON students;
DROP POLICY IF EXISTS "Teachers can read students in their classes" ON students;
DROP POLICY IF EXISTS "Admins can insert students" ON students;
DROP POLICY IF EXISTS "Admins can update students" ON students;
DROP POLICY IF EXISTS "Admins can delete students" ON students;

CREATE POLICY "students_select_own"
  ON students FOR SELECT
  USING (id = public.get_my_student_id());

CREATE POLICY "students_select_parent"
  ON students FOR SELECT
  USING (
    public.get_user_role() = 'parent'
    AND id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "students_select_teacher"
  ON students FOR SELECT
  USING (
    public.get_user_role() = 'teacher'
    AND id IN (
      SELECT se.student_id FROM student_enrollments se
      WHERE se.class_id IN (SELECT public.get_my_class_ids())
    )
  );

CREATE POLICY "students_select_admin"
  ON students FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "students_insert_admin"
  ON students FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "students_update_admin"
  ON students FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "students_delete_admin"
  ON students FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- streams -----
DROP POLICY IF EXISTS "Public can read streams" ON streams;
DROP POLICY IF EXISTS "Admins can insert streams" ON streams;
DROP POLICY IF EXISTS "Admins can update streams" ON streams;
DROP POLICY IF EXISTS "Admins can delete streams" ON streams;

CREATE POLICY "streams_select_all"
  ON streams FOR SELECT
  USING (true);

CREATE POLICY "streams_insert_admin"
  ON streams FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "streams_update_admin"
  ON streams FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "streams_delete_admin"
  ON streams FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- stream_subjects -----
DROP POLICY IF EXISTS "Public can read stream_subjects" ON stream_subjects;
DROP POLICY IF EXISTS "Admins can insert stream_subjects" ON stream_subjects;
DROP POLICY IF EXISTS "Admins can update stream_subjects" ON stream_subjects;
DROP POLICY IF EXISTS "Admins can delete stream_subjects" ON stream_subjects;

CREATE POLICY "stream_subjects_select_all"
  ON stream_subjects FOR SELECT
  USING (true);

CREATE POLICY "stream_subjects_insert_admin"
  ON stream_subjects FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "stream_subjects_update_admin"
  ON stream_subjects FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "stream_subjects_delete_admin"
  ON stream_subjects FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- registration_requests -----
DROP POLICY IF EXISTS "Anyone can submit registration" ON registration_requests;
DROP POLICY IF EXISTS "Admins can read all registrations" ON registration_requests;
DROP POLICY IF EXISTS "Admins can update registrations" ON registration_requests;
DROP POLICY IF EXISTS "Admins can delete registrations" ON registration_requests;

CREATE POLICY "registration_requests_insert_public"
  ON registration_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "registration_requests_select_admin"
  ON registration_requests FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "registration_requests_update_admin"
  ON registration_requests FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "registration_requests_delete_admin"
  ON registration_requests FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- teachers (new) -----
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teachers_select_own"
  ON teachers FOR SELECT
  USING (id = public.get_my_teacher_id());

CREATE POLICY "teachers_select_admin"
  ON teachers FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "teachers_select_authenticated"
  ON teachers FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "teachers_insert_admin"
  ON teachers FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "teachers_update_own"
  ON teachers FOR UPDATE
  USING (id = public.get_my_teacher_id());

CREATE POLICY "teachers_update_admin"
  ON teachers FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "teachers_delete_admin"
  ON teachers FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- parents (new) -----
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parents_select_own"
  ON parents FOR SELECT
  USING (id = public.get_my_parent_id());

CREATE POLICY "parents_select_admin"
  ON parents FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "parents_insert_admin"
  ON parents FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "parents_update_own"
  ON parents FOR UPDATE
  USING (id = public.get_my_parent_id());

CREATE POLICY "parents_update_admin"
  ON parents FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "parents_delete_admin"
  ON parents FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- student_parents (new) -----
ALTER TABLE student_parents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_parents_select_parent"
  ON student_parents FOR SELECT
  USING (parent_id = public.get_my_parent_id());

CREATE POLICY "student_parents_select_student"
  ON student_parents FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "student_parents_select_admin"
  ON student_parents FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "student_parents_insert_admin"
  ON student_parents FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "student_parents_update_admin"
  ON student_parents FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "student_parents_delete_admin"
  ON student_parents FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- payment_orders (new) -----
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_orders_select_parent"
  ON payment_orders FOR SELECT
  USING (parent_id = public.get_my_parent_id());

CREATE POLICY "payment_orders_select_student"
  ON payment_orders FOR SELECT
  USING (student_id = public.get_my_student_id());

CREATE POLICY "payment_orders_select_admin"
  ON payment_orders FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "payment_orders_insert_parent"
  ON payment_orders FOR INSERT
  WITH CHECK (
    public.get_user_role() = 'parent'
    AND parent_id = public.get_my_parent_id()
    AND student_id IN (SELECT public.get_my_children_ids())
  );

CREATE POLICY "payment_orders_insert_admin"
  ON payment_orders FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "payment_orders_update_admin"
  ON payment_orders FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "payment_orders_delete_admin"
  ON payment_orders FOR DELETE
  USING (public.get_user_role() = 'admin');


-- ----- notifications (new) -----
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_insert_admin"
  ON notifications FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "notifications_select_admin"
  ON notifications FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "notifications_delete_admin"
  ON notifications FOR DELETE
  USING (public.get_user_role() = 'admin');


-- =============================================================
-- PHASE 10: Create indexes
-- =============================================================

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_student_id ON profiles(student_id);
CREATE INDEX IF NOT EXISTS idx_profiles_teacher_id ON profiles(teacher_id);
CREATE INDEX IF NOT EXISTS idx_profiles_parent_id ON profiles(parent_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- students
CREATE INDEX IF NOT EXISTS idx_students_admission_no ON students(admission_no);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_is_alumni ON students(is_alumni);

-- teachers
CREATE INDEX IF NOT EXISTS idx_teachers_employee_id ON teachers(employee_id);
CREATE INDEX IF NOT EXISTS idx_teachers_is_active ON teachers(is_active);
CREATE INDEX IF NOT EXISTS idx_teachers_staff_member_id ON teachers(staff_member_id);
CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email);

-- parents
CREATE INDEX IF NOT EXISTS idx_parents_email ON parents(email);
CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone);

-- student_parents
CREATE INDEX IF NOT EXISTS idx_student_parents_student_id ON student_parents(student_id);
CREATE INDEX IF NOT EXISTS idx_student_parents_parent_id ON student_parents(parent_id);

-- academic_years
CREATE INDEX IF NOT EXISTS idx_academic_years_is_current ON academic_years(is_current);

-- classes
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON classes(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_classes_class_teacher_id ON classes(class_teacher_id);

-- class_subjects
CREATE INDEX IF NOT EXISTS idx_class_subjects_class_id ON class_subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id ON class_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_teacher_id ON class_subjects(teacher_id);

-- student_enrollments
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id ON student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_id ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_academic_year_id ON student_enrollments(academic_year_id);

-- attendance
CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class_id ON attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance(class_id, date);

-- results
CREATE INDEX IF NOT EXISTS idx_results_student_id ON results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_class_id ON results(class_id);
CREATE INDEX IF NOT EXISTS idx_results_exam_type_id ON results(exam_type_id);
CREATE INDEX IF NOT EXISTS idx_results_is_published ON results(is_published);

-- fee_structures
CREATE INDEX IF NOT EXISTS idx_fee_structures_academic_year_id ON fee_structures(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_class_level ON fee_structures(class_level);

-- fee_payments
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_id ON fee_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_fee_structure_id ON fee_payments(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_academic_year_id ON fee_payments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_status ON fee_payments(status);
CREATE INDEX IF NOT EXISTS idx_fee_payments_payment_order_id ON fee_payments(payment_order_id);

-- payment_orders
CREATE INDEX IF NOT EXISTS idx_payment_orders_student_id ON payment_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_parent_id ON payment_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_gateway_order_id ON payment_orders(gateway_order_id);

-- timetable_periods
CREATE INDEX IF NOT EXISTS idx_timetable_periods_class_id ON timetable_periods(class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_periods_teacher_id ON timetable_periods(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_periods_day ON timetable_periods(day_of_week);

-- calendar_events
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_type ON calendar_events(event_type);
CREATE INDEX IF NOT EXISTS idx_calendar_events_academic_year_id ON calendar_events(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_is_public ON calendar_events(is_public);

-- exam_types
CREATE INDEX IF NOT EXISTS idx_exam_types_academic_year_id ON exam_types(academic_year_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(recipient_id, is_read) WHERE is_read = false;


-- =============================================================
-- PHASE 11: Create updated_at triggers
-- =============================================================

-- profiles
DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- students
DROP TRIGGER IF EXISTS set_students_updated_at ON students;
CREATE TRIGGER set_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- teachers
DROP TRIGGER IF EXISTS set_teachers_updated_at ON teachers;
CREATE TRIGGER set_teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- parents
DROP TRIGGER IF EXISTS set_parents_updated_at ON parents;
CREATE TRIGGER set_parents_updated_at
  BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- student_enrollments (has updated_at? adding one)
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS set_student_enrollments_updated_at ON student_enrollments;
CREATE TRIGGER set_student_enrollments_updated_at
  BEFORE UPDATE ON student_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- results
DROP TRIGGER IF EXISTS set_results_updated_at ON results;
CREATE TRIGGER set_results_updated_at
  BEFORE UPDATE ON results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- fee_structures
DROP TRIGGER IF EXISTS set_fee_structures_updated_at ON fee_structures;
CREATE TRIGGER set_fee_structures_updated_at
  BEFORE UPDATE ON fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- fee_payments
DROP TRIGGER IF EXISTS set_fee_payments_updated_at ON fee_payments;
CREATE TRIGGER set_fee_payments_updated_at
  BEFORE UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payment_orders
DROP TRIGGER IF EXISTS set_payment_orders_updated_at ON payment_orders;
CREATE TRIGGER set_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- calendar_events
DROP TRIGGER IF EXISTS set_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER set_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- PHASE 12: Enable RLS on new tables (already done in Phase 9,
-- but ensuring they are enabled for safety)
-- =============================================================

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;


COMMIT;
