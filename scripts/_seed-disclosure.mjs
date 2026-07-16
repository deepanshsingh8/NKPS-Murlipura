// Seed the CBSE Mandatory Public Disclosure content for NK Public School,
// Murlipura into Supabase (disclosure_items + disclosure_documents).
//
// Run with: node --env-file=.env.local scripts/_seed-disclosure.mjs
//
// Idempotent: upserts on the natural keys (field_key / doc_key) with
// ignoreDuplicates, so existing admin-entered rows are never overwritten.
// Mirrors scripts/migrations/cms/seed-disclosure.sql.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const items = [
  // Section A — General Information
  ["general", "school_name", "Name of the School", "NK Public School, Murlipura", 0],
  ["general", "affiliation_no", "Affiliation No.", "", 1],
  ["general", "school_code", "School Code", "", 2],
  ["general", "address", "Complete Address with Pin Code", "Arya Nagar, Murlipura, Jaipur, Rajasthan – 302039", 3],
  ["general", "principal_name", "Principal Name & Qualification", "Ms. Chitra Raje Basera", 4],
  ["general", "school_email", "School Email ID", "nkpsem@gmail.com", 5],
  ["general", "contact_details", "Contact Details (Landline/Mobile)", "+91-9785500042, +91-9785500061", 6],
  // Section C — Result & Academics
  ["result_academics", "fee_structure", "Fee Structure of the School", "", 0],
  ["result_academics", "academic_calendar", "Annual Academic Calendar", "", 1],
  ["result_academics", "smc_list", "List of School Management Committee (SMC)", "", 2],
  ["result_academics", "pta_members", "List of Parents Teachers Association (PTA) Members", "", 3],
  // Section D — Staff (Teaching)
  ["staff", "principal", "Principal", "Ms. Chitra Raje Basera", 0],
  ["staff", "total_teachers", "Total No. of Teachers (PGT / TGT / PRT)", "", 1],
  ["staff", "teacher_section_ratio", "Teacher-Section Ratio", "", 2],
  ["staff", "special_educator", "Details of Special Educator", "", 3],
  ["staff", "counsellor", "Details of Counsellor and Wellness Teacher", "", 4],
  // Section E — School Infrastructure
  ["infrastructure", "campus_area", "Total Campus Area (in sq. mtrs.)", "", 0],
  ["infrastructure", "classrooms", "Number and Size of Classrooms", "", 1],
  ["infrastructure", "labs", "Number and Size of Laboratories (incl. Computer Labs)", "", 2],
  ["infrastructure", "internet", "Internet Facility", "Yes", 3],
  ["infrastructure", "girls_toilets", "Number of Girls' Toilets", "", 4],
  ["infrastructure", "boys_toilets", "Number of Boys' Toilets", "", 5],
  ["infrastructure", "youtube_link", "Link of YouTube Video of School Inspection", "", 6],
].map(([section, field_key, label, value, sort_order]) => ({
  section,
  field_key,
  label,
  value,
  sort_order,
}));

const documents = [
  ["affiliation_letter", "Copies of Affiliation/Upgradation Letter and Recent Extension of Affiliation", 0],
  ["society_registration", "Copies of Societies/Trust/Company Registration/Renewal Certificate", 1],
  ["noc", "Copy of No Objection Certificate (NOC) Issued by the State Govt/UT", 2],
  ["rte_recognition", "Copy of Recognition Certificate under RTE Act, 2009, and Its Renewal", 3],
  ["building_safety", "Copy of Valid Building Safety Certificate (as per National Building Code)", 4],
  ["fire_safety", "Copy of Valid Fire Safety Certificate Issued by the Competent Authority", 5],
  ["deo_certificate", "Copy of DEO Certificate Submitted for Affiliation/Self-Certification by School", 6],
  ["water_health_sanitation", "Copy of Valid Water, Health and Sanitation Certificates", 7],
].map(([doc_key, label, sort_order]) => ({ doc_key, label, sort_order }));

const { error: itemsErr } = await supa
  .from("disclosure_items")
  .upsert(items, { onConflict: "field_key", ignoreDuplicates: true });
if (itemsErr) {
  console.error("disclosure_items seed failed:", itemsErr.message);
  process.exit(1);
}

const { error: docsErr } = await supa
  .from("disclosure_documents")
  .upsert(documents, { onConflict: "doc_key", ignoreDuplicates: true });
if (docsErr) {
  console.error("disclosure_documents seed failed:", docsErr.message);
  process.exit(1);
}

const [{ count: itemCount }, { count: docCount }] = await Promise.all([
  supa.from("disclosure_items").select("*", { count: "exact", head: true }),
  supa.from("disclosure_documents").select("*", { count: "exact", head: true }),
]);

console.log(`✓ Disclosure seeded — disclosure_items: ${itemCount}, disclosure_documents: ${docCount}`);
