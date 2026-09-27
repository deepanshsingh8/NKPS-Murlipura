import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  FEE_TEMPLATE_FIELDS,
  feeTemplateHeaders,
  feeTemplateColWidths,
  feeTemplateSampleRows,
} from "@nkps/shared/lib/fee-template";

// GET /api/fees/schedule/import/template
//
// Headers, widths and samples all come from the shared registry, so the sheet
// an admin downloads can never drift from what the importer parses. Static
// sample data, so no auth — same as the timetable import template.
export function GET() {
  const ws = XLSX.utils.aoa_to_sheet([
    feeTemplateHeaders(),
    ...feeTemplateSampleRows(),
  ]);
  ws["!cols"] = feeTemplateColWidths();

  // Per-column guidance, generated from the same registry rather than
  // hand-written prose that would go stale the first time a column changes.
  const notes = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "What to put in it"],
    ...FEE_TEMPLATE_FIELDS.map((f) => [
      f.label.replace(" *", ""),
      f.required ? "Yes" : "Optional",
      f.help,
    ]),
    [""],
    ["How the import behaves"],
    [
      "",
      "",
      "Each (Class, Stream) block REPLACES that class's schedule for the session — rows you leave out are removed.",
    ],
    [
      "",
      "",
      "Rows already recorded against a payment are deactivated rather than deleted, so receipts stay intact.",
    ],
    [
      "",
      "",
      "Nothing is written until you confirm the preview, and a file with any error row is refused outright — there are no partial imports.",
    ],
    [
      "",
      "",
      "The same fee head + due date + student type twice in one class is rejected: that would double-bill.",
    ],
  ]);
  notes["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Fee Schedule");
  XLSX.utils.book_append_sheet(wb, notes, "Instructions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="fee-schedule-template.xlsx"',
    },
  });
}
