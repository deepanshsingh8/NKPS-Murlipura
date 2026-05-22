/**
 * CSV Export utility for downloading data as CSV files.
 */

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCSV<T extends object>(
  rows: T[],
  columns: { key: string; header: string }[],
  filename: string
) {
  const header = columns.map((c) => escapeCSV(c.header)).join(",");
  const body = rows
    .map((row) =>
      columns.map((c) => escapeCSV((row as Record<string, unknown>)[c.key])).join(",")
    )
    .join("\n");

  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Student CSV columns matching the bulk upload format */
export const STUDENT_CSV_COLUMNS = [
  { key: "admission_no", header: "Admission No" },
  { key: "full_name", header: "Full Name" },
  { key: "class_name", header: "Class" },
  { key: "class_section", header: "Section" },
  { key: "roll_number", header: "Roll No" },
  { key: "father_name", header: "Father Name" },
  { key: "mother_name", header: "Mother Name" },
  { key: "date_of_birth", header: "Date of Birth" },
  { key: "gender", header: "Gender" },
  { key: "phone", header: "Phone" },
  { key: "email", header: "Email" },
  { key: "address", header: "Address" },
  { key: "blood_group", header: "Blood Group" },
  { key: "category", header: "Category" },
  { key: "aadhar_number", header: "Aadhar Number" },
  { key: "previous_school", header: "Previous School" },
  { key: "admission_date", header: "Admission Date" },
  { key: "enrollment_status", header: "Status" },
];

/** Staff CSV columns matching the bulk upload format */
export const STAFF_CSV_COLUMNS = [
  { key: "name", header: "Name" },
  { key: "subject", header: "Subject/Designation" },
  { key: "category", header: "Category" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "date_of_birth", header: "Date of Birth" },
  { key: "address", header: "Address" },
  { key: "qualifications", header: "Qualifications" },
];
