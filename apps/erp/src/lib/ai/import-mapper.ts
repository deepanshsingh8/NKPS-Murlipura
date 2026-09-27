import { getAiClient, AI_MODELS, AI_EFFORT } from "./client";
import type { ColumnProfile, MappingSuggestion } from "@nkps/shared/lib/import-mapping";

/**
 * Matching leftover spreadsheet columns to template fields.
 *
 * One structured call, no tools, no loop. There is nothing to look up: the
 * candidate fields arrive with the request and the column profiles arrive with
 * it too, so a tool round-trip would only add a way to fail.
 *
 * ── What this is NOT allowed to do ──────────────────────────────────────────
 * It maps columns. It never emits a cell VALUE. The distinction is the whole
 * safety story: a wrong mapping is visible in the preview grid and rejected in
 * one click, whereas a model-authored value would be a fabricated fact sitting
 * in a student record with nothing marking it as invented. It also never sees
 * a real value — see describeColumn for how a column is described without one.
 */

export interface FieldCandidate {
  key: string;
  label: string;
  /** e.g. "date", "enum: male|female", "text". Helps type-match a column. */
  kind?: string;
}

const SYSTEM = `You match spreadsheet columns to the fields of a school ERP import template.

You are given, for each unmatched column: its header, how many rows are filled, how many distinct values it holds, and a SHAPE describing the values — never the values themselves, except for low-cardinality columns where the distinct values are categories rather than anybody's personal data.

Match on evidence, in this order:
1. The shape. "10 digits" is a mobile number; "12 digits" is Aadhaar; "date" is a date field; "1-3 words" is a name. A header you cannot read is often obvious from its shape alone.
2. The header text, including Indian school abbreviations — "F. Name" and "Father Name" both mean the father's name, "D.O.B" is date of birth, "Adm No" is the admission number, "Cat" is category.
3. Which fields are still unclaimed. Never propose a field that is already taken.

Rules:
- One field per column, and one column per field.
- Return fieldKey null when a column has no sensible home. An honest null is far better than a plausible wrong match: a wrong mapping writes the wrong data into a student record, and the operator is reviewing dozens of rows and will wave through anything that looks reasonable.
- confidence "high" only when the shape AND the header agree. Header alone, or shape alone, is "medium". A guess is "low".
- "why" is one short clause the operator can judge in a glance, naming the evidence — e.g. "10 digits, header says Contact" or "header only; values are free text".
- Never invent a fieldKey. Use only the keys given to you.`;

export async function proposeMapping(args: {
  columns: ColumnProfile[];
  candidates: FieldCandidate[];
}): Promise<MappingSuggestion[]> {
  if (args.columns.length === 0 || args.candidates.length === 0) return [];

  const response = await getAiClient().messages.create({
    model: AI_MODELS.importMapping,
    max_tokens: 2000,
    output_config: {
      effort: AI_EFFORT.importMapping,
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  fieldKey: { type: ["string", "null"] },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  why: { type: "string" },
                },
                required: ["index", "fieldKey", "confidence", "why"],
                additionalProperties: false,
              },
            },
          },
          required: ["suggestions"],
          additionalProperties: false,
        },
      },
    },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Fields still unclaimed:\n${args.candidates
          .map((c) => `- ${c.key}: ${c.label}${c.kind ? ` (${c.kind})` : ""}`)
          .join("\n")}\n\nColumns to match:\n${JSON.stringify(args.columns, null, 1)}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is { type: "text"; text: string; citations: never } => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { suggestions?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("[ai.import-mapper] unparseable structured output");
    return [];
  }

  const allowed = new Set(args.candidates.map((c) => c.key));
  const byIndex = new Set(args.columns.map((c) => c.index));
  const claimed = new Set<string>();

  // Re-check everything the schema cannot: that the key exists, that the
  // column was actually one we asked about, and that no field is claimed
  // twice. The model is told these rules; the server does not rely on it
  // having followed them.
  return (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map((s) => s as MappingSuggestion)
    .filter((s) => byIndex.has(s.index))
    .map((s) => {
      if (s.fieldKey && (!allowed.has(s.fieldKey) || claimed.has(s.fieldKey))) {
        return { ...s, fieldKey: null, confidence: "low" as const, why: s.why };
      }
      if (s.fieldKey) claimed.add(s.fieldKey);
      return s;
    });
}
