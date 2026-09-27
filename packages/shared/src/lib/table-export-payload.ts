// The contract between the export dialog and the table-PDF renderer.
//
// One schema, imported by the button that sends the body and by both apps'
// routes that receive it, so a change to either side fails the build rather
// than producing a 400 at runtime.

import { z } from "zod";
import { isFeatureKey } from "@nkps/shared/lib/permissions";

/**
 * Caps. Past these a PDF stops being a document anyone can read, and the
 * request stops being one Vercel will accept (4.5 MB body limit).
 *
 * The dialog enforces them before sending so the admin gets "narrow the
 * filter or export to Excel" instead of a failed download; the route
 * enforces them again because a client-side limit is not a limit.
 */
export const PDF_MAX_ROWS = 5000;
export const PDF_MAX_COLUMNS = 24;
export const PDF_MAX_BODY_BYTES = 4 * 1024 * 1024;

const filterSummaryEntrySchema = z.object({
  label: z.string().max(80),
  value: z.string().max(400),
});

/**
 * Rows travel as positional arrays rather than keyed objects: at 900 rows ×
 * 20 columns the key repetition alone would roughly double the body.
 */
export const tablePdfPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  filterSummary: z.array(filterSummaryEntrySchema).max(12).default([]),
  headers: z.array(z.string().max(120)).min(1).max(PDF_MAX_COLUMNS),
  aligns: z.array(z.enum(["left", "right"])).max(PDF_MAX_COLUMNS).default([]),
  rows: z
    .array(z.array(z.string().max(2000)))
    .max(PDF_MAX_ROWS),
  orientation: z.enum(["auto", "portrait", "landscape"]).default("auto"),
  filename: z.string().min(1).max(160),
  // Audit metadata only. The route NEVER authorizes on these: middleware
  // short-circuits /api/, so a client-supplied feature key would be the
  // caller grading their own paper. (Which app served the request is stamped
  // by the route itself, not taken from the body.)
  sourcePath: z.string().max(200).optional(),
  featureKey: z
    .string()
    .max(60)
    .optional()
    .refine((v) => v === undefined || isFeatureKey(v), {
      message: "unknown feature key",
    }),
});

export type TablePdfPayload = z.infer<typeof tablePdfPayloadSchema>;
