import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// GET /api/fees/historical-import/template
//
// A downloadable sample in the exact layout `parseAccountWiseFees` expects.
// The importer reads the previous software's "Day Book (Account Wise)
// Report", a fixed foreign layout that shipped with no template at all — so
// an admin assembling the sheet by hand had no way to know what was wanted.
//
// The shape mirrors packages/shared/src/lib/historical-import/parse-account-wise-fees.ts:
//   • rows 0-5 are decorative (school name, address, report title)
//   • row 6 is the header
//   • the student column is one cell: "SR | Student Name | Father Name"
//   • each month cell holds zero or more payments as
//       {amount} | {dd/mm/yyyy} | {receipt#}:
//     with multiple payments separated by whitespace
//
// Static sample data, so no auth — same as the timetable import template.

const MONTHS = [
  "APR", "MAY", "JUN", "JUL", "AUG", "SEP",
  "OCT", "NOV", "DEC", "JAN", "FEB", "MAR",
];

const HEADER = [
  "S.No.",
  "Class",
  "Section",
  "SR | Student Name | Father Name",
  ...MONTHS,
  "Total",
];

// Blank month cells are as important as filled ones: they show that "no
// payment that month" is an empty cell, not a zero or a dash.
function row(
  sno: number,
  className: string,
  section: string,
  student: string,
  payments: Partial<Record<string, string>>,
  total: number
) {
  return [
    sno,
    className,
    section,
    student,
    ...MONTHS.map((m) => payments[m] ?? ""),
    total,
  ];
}

export function GET() {
  const data: (string | number)[][] = [
    ["N K PUBLIC SCHOOL"],
    ["Village & Post — District, State"],
    ["Day Book (Account Wise) Report"],
    ["Session: 2024-25"],
    [""],
    [""],
    HEADER,
    row(
      1,
      "V",
      "A",
      "1024 | Aarav Sharma | Rakesh Sharma",
      {
        APR: "23500 | 05/04/2024 | 1187:",
        OCT: "23500 | 03/10/2024 | 2461:",
        JAN: "23500 | 07/01/2025 | 3120:",
      },
      70500
    ),
    row(
      2,
      "V",
      "A",
      "1025 | Diya Verma | Sunil Verma",
      {
        // Two payments in one month, whitespace-separated — the parser reads
        // both, so a part payment followed by the balance is representable.
        APR: "10500 | 05/04/2024 | 1188: 13000 | 19/04/2024 | 1203:",
        OCT: "23500 | 11/10/2024 | 2478:",
      },
      47000
    ),
    row(
      3,
      "XI",
      "A",
      " | Kabir Nair | Anil Nair",
      { APR: "31000 | 08/04/2024 | 1204:" },
      31000
    ),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 7 },
    { wch: 8 },
    { wch: 9 },
    { wch: 38 },
    ...MONTHS.map(() => ({ wch: 30 })),
    { wch: 10 },
  ];

  const notes = XLSX.utils.aoa_to_sheet([
    ["How to fill this sheet"],
    [""],
    ["Row 7 is the header row. Rows 1-6 above it are ignored, so you can put"],
    ["whatever school name and report title your export produces there."],
    [""],
    ["Student column", "One cell, three fields separated by | (pipe):"],
    ["", "SR number | Student Name | Father Name"],
    ["", "Leave SR blank for a new admit — the student is then matched by name."],
    [""],
    ["Month columns", "Leave blank when there was no payment that month."],
    ["", "One payment:   23500 | 05/04/2024 | 1187:"],
    ["", "That is:       amount | dd/mm/yyyy | receipt number, ending in a colon."],
    ["", "Two payments:  put both in the same cell, separated by a space."],
    [""],
    ["Class / Section", "Any naming works. Names the importer does not recognise"],
    ["", "are listed after the preview so you can map them by hand."],
    [""],
    ["Total column", "Optional — it is only used to warn about mismatches."],
    [""],
    ["Nothing is written until you confirm the preview, and every import can"],
    ["be reverted as a batch afterwards."],
  ]);
  notes["!cols"] = [{ wch: 18 }, { wch: 72 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Day Book");
  XLSX.utils.book_append_sheet(wb, notes, "Instructions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="historical-fees-template.xlsx"',
    },
  });
}
