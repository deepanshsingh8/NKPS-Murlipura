import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

/**
 * §10 Downloadable .xlsx template that schools fill in. Header row + 2 sample
 * rows so the format is unambiguous.
 */

export function GET() {
  const data = [
    ["Day", "Period", "Section", "Subject", "Teacher", "Start", "End", "Room"],
    ["Monday", 1, "X-A", "Mathematics", "Anita Rao", "08:00", "08:40", "201"],
    ["Monday", 2, "X-A", "English Core", "EMP-024",   "08:40", "09:20", "201"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Modest column widths for readability
  ws["!cols"] = [
    { wch: 10 }, { wch: 7 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timetable");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="timetable-template.xlsx"',
    },
  });
}
