import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// GET /api/fees/waivers/import/template
//
// Sample sheet for the per-student concession bulk upload. Static data, so no
// auth — same as the other import templates.
//
// The sheet is keyed on ADMISSION NUMBER and the FEE HEAD + DUE DATE of the
// instalment being reduced, never on internal ids: an office clerk fills this
// in from records that carry neither.

const HEADER = [
  "Admission No *",
  "Student Name",
  "Fee Head *",
  "Due Date *",
  "Concession Amount *",
  "Reason *",
  "Month",
];

export function GET() {
  const ws = XLSX.utils.aoa_to_sheet([
    HEADER,
    [
      "1024",
      "Aarav Sharma",
      "Tuition Fee",
      "01/04/2026",
      5000,
      "Staff ward — 20% concession approved by Principal",
      "April, 2026",
    ],
    [
      "1025",
      "Diya Verma",
      "Tuition Fee",
      "01/04/2026",
      23500,
      "RTE student — full tuition waiver",
      "April, 2026",
    ],
    [
      "1031",
      "Kabir Nair",
      "Admission Fee",
      "01/04/2026",
      2500,
      "Sibling concession, second child",
      "",
    ],
  ]);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 13 },
    { wch: 18 },
    { wch: 52 },
    { wch: 14 },
  ];

  const notes = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "What to put in it"],
    [
      "Admission No",
      "Yes",
      "The student's admission number exactly as recorded in the ERP.",
    ],
    [
      "Student Name",
      "Optional",
      "Ignored on import — it is there so you can read the sheet. A name that does not match the admission number is reported as a warning.",
    ],
    [
      "Fee Head",
      "Yes",
      "Must match a fee head in that student's class schedule, e.g. Tuition Fee.",
    ],
    [
      "Due Date",
      "Yes",
      "DD/MM/YYYY — identifies WHICH instalment is being reduced. A class with three tuition instalments has three different due dates.",
    ],
    [
      "Concession Amount",
      "Yes",
      "Rupees taken off that instalment. Cannot exceed what is still owed on it.",
    ],
    ["Reason", "Yes", "At least 5 characters. Stored permanently against the student."],
    ["Month", "Optional", "Only needed for monthly heads, to say which month."],
    [""],
    ["How the import behaves"],
    [
      "",
      "",
      "A concession is recorded the same way the single-student Waiver button records one: a zero-rupee receipt carrying the concession amount, so dues and no-dues certificates account for it correctly.",
    ],
    [
      "",
      "",
      "One concession per student, per instalment, per month. A row for a student who already has one is reported and skipped, never doubled.",
    ],
    [
      "",
      "",
      "Every row is re-checked against the live ledger at the moment of import, so a concession cannot exceed the balance if the student has paid in the meantime.",
    ],
    [
      "",
      "",
      "Nothing is written until you confirm the preview, and a file containing any error row is refused outright.",
    ],
    [
      "",
      "",
      "Admin only. Editors record concessions one at a time through the approval workflow.",
    ],
  ]);
  notes["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 96 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Concessions");
  XLSX.utils.book_append_sheet(wb, notes, "Instructions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="student-concessions-template.xlsx"',
    },
  });
}
