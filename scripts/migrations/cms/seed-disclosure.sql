-- =============================================================================
-- Seed: Mandatory Public Disclosure (CBSE) — NK Public School, Murlipura
--
-- Populates the CMS "Disclosure" page so the CBSE mandatory-disclosure form
-- renders its A–E sections. School-identifying fields carry the campus's known
-- Murlipura values (see packages/shared/src/lib/constants.ts SCHOOL); values the
-- school has not yet published are seeded blank for an admin to fill in.
--
-- Sections: A General Information (general), B Documents (disclosure_documents),
-- C Result & Academics (result_academics), D Staff (staff),
-- E Infrastructure (infrastructure).
--
-- Behaviour: INSERT … ON CONFLICT (field_key / doc_key) DO NOTHING. Existing
-- rows are NEVER touched, so any admin-entered value stays. Idempotent — safe
-- to re-run. Equivalent runner: scripts/_seed-disclosure.mjs.
-- =============================================================================

-- Section A — General Information
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('general', 'school_name', 'Name of the School', 'NK Public School, Murlipura', 0),
  ('general', 'affiliation_no', 'Affiliation No.', '', 1),
  ('general', 'school_code', 'School Code', '', 2),
  ('general', 'address', 'Complete Address with Pin Code', 'Arya Nagar, Murlipura, Jaipur, Rajasthan – 302039', 3),
  ('general', 'principal_name', 'Principal Name & Qualification', 'Ms. Chitra Raje Basera', 4),
  ('general', 'school_email', 'School Email ID', 'nkpsem@gmail.com', 5),
  ('general', 'contact_details', 'Contact Details (Landline/Mobile)', '+91-9785500042, +91-9785500061', 6)
ON CONFLICT (field_key) DO NOTHING;

-- Section C — Result & Academics (text fields; admin fills or uploads)
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('result_academics', 'fee_structure', 'Fee Structure of the School', '', 0),
  ('result_academics', 'academic_calendar', 'Annual Academic Calendar', '', 1),
  ('result_academics', 'smc_list', 'List of School Management Committee (SMC)', '', 2),
  ('result_academics', 'pta_members', 'List of Parents Teachers Association (PTA) Members', '', 3)
ON CONFLICT (field_key) DO NOTHING;

-- Section D — Staff (Teaching)
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('staff', 'principal', 'Principal', 'Ms. Chitra Raje Basera', 0),
  ('staff', 'total_teachers', 'Total No. of Teachers (PGT / TGT / PRT)', '', 1),
  ('staff', 'teacher_section_ratio', 'Teacher-Section Ratio', '', 2),
  ('staff', 'special_educator', 'Details of Special Educator', '', 3),
  ('staff', 'counsellor', 'Details of Counsellor and Wellness Teacher', '', 4)
ON CONFLICT (field_key) DO NOTHING;

-- Section E — School Infrastructure
INSERT INTO disclosure_items (section, field_key, label, value, sort_order) VALUES
  ('infrastructure', 'campus_area', 'Total Campus Area (in sq. mtrs.)', '', 0),
  ('infrastructure', 'classrooms', 'Number and Size of Classrooms', '', 1),
  ('infrastructure', 'labs', 'Number and Size of Laboratories (incl. Computer Labs)', '', 2),
  ('infrastructure', 'internet', 'Internet Facility', 'Yes', 3),
  ('infrastructure', 'girls_toilets', 'Number of Girls'' Toilets', '', 4),
  ('infrastructure', 'boys_toilets', 'Number of Boys'' Toilets', '', 5),
  ('infrastructure', 'youtube_link', 'Link of YouTube Video of School Inspection', '', 6)
ON CONFLICT (field_key) DO NOTHING;

-- Section B — Documents (uploadable PDFs; admin attaches files later)
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
