import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

/**
 * §10 Downloadable .xlsx template that schools fill in. Header row + 2 sample
 * rows so the format is unambiguous.
 */

export function GET() {
  // Group and Shared are optional — leave them blank and the sheet behaves
  // exactly as it did before they existed. The last three sample rows show the
  // case they are for: one Games period with three parallel groups, each with
  // its own coach, all marked shared because those coaches are simultaneously
  // on the field for the other sections too. (migration 119)
  const data = [
    ["Day", "Period", "Section", "Subject", "Teacher", "Start", "End", "Room", "Group", "Shared"],
    ["Monday", 1, "X-A", "Mathematics", "Anita Rao", "08:00", "08:40", "201", "", ""],
    ["Monday", 2, "X-A", "English Core", "EMP-024",   "08:40", "09:20", "201", "", ""],
    ["Monday", 4, "VI-A", "Games", "Anita Rao",  "11:00", "11:40", "Field", "Basketball", "yes"],
    ["Monday", 4, "VI-A", "Games", "EMP-031",    "11:00", "11:40", "Field", "Badminton",  "yes"],
    ["Monday", 4, "VI-A", "Games", "EMP-042",    "11:00", "11:40", "Field", "Cricket",    "yes"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Modest column widths for readability
  ws["!cols"] = [
    { wch: 10 }, { wch: 7 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 12 }, { wch: 8 },
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
