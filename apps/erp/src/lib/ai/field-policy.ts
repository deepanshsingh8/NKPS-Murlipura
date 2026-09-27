import {
  partitionFieldKeys,
  applyFieldVisibility,
  type ReportField,
} from "@nkps/shared/lib/report-fields";
import { AI_SENSITIVE_KEYS } from "@nkps/shared/lib/pii-fields";
import type { CallerContext } from "./caller-context";

/**
 * Which columns the assistant may actually return.
 *
 * Three gates, in a fixed order, because the order is load-bearing: resolve
 * first (which prepends the always-on fields), then strip by role, then strip
 * by the AI's own stricter rule. Reversed, a sensitive key could re-enter via
 * the always-on set.
 */

export interface FieldPolicyResult {
  fields: ReportField[];
  /** Keys the model invented, with near-misses so it can correct itself. */
  unknown: { key: string; didYouMean: string[] }[];
  /** Keys that exist but were withheld, with why. The model MUST say so. */
  withheld: { key: string; reason: "sensitive" | "not_permitted" }[];
  /** True when any surviving field is in the sensitive set (audit flag). */
  sensitiveIncluded: boolean;
}

/**
 * Resolve model-requested field keys against the caller's entitlements.
 *
 * The AI gate is deliberately stricter than the screen it fronts: a
 * model-generated sheet of Aadhaar numbers and parent mobiles is a different
 * risk from an admin knowingly ticking those columns, and the AI path has no
 * existing users whose workflow a tighter default would break. `allowSensitive`
 * is a human act in the UI — never a model decision, never a body default.
 */
export function resolveAiFields(
  ctx: CallerContext,
  requestedKeys: readonly string[]
): FieldPolicyResult {
  const { resolved, unknown, suggestions } = partitionFieldKeys(requestedKeys);

  const isAdmin = ctx.role === "admin";
  const roleVisible = applyFieldVisibility(resolved, isAdmin);

  const withheld: FieldPolicyResult["withheld"] = [];
  for (const field of resolved) {
    if (!roleVisible.includes(field)) {
      withheld.push({ key: field.key, reason: "not_permitted" });
    }
  }

  // The AI-only gate. Applies even to admins unless they deliberately
  // unlocked sensitive columns for this question.
  const finalFields = ctx.allowSensitive
    ? roleVisible
    : roleVisible.filter((f) => {
        if (!AI_SENSITIVE_KEYS.has(f.key)) return true;
        withheld.push({ key: f.key, reason: "sensitive" });
        return false;
      });

  return {
    fields: finalFields,
    unknown: unknown.map((key) => ({
      key,
      didYouMean: suggestions[key] ?? [],
    })),
    withheld,
    sensitiveIncluded: finalFields.some((f) => AI_SENSITIVE_KEYS.has(f.key)),
  };
}

/**
 * Line the model is told to reproduce when columns were withheld.
 *
 * Surfacing this matters more than it looks: silently narrowing the table
 * leaves the model describing data it never received, which reads to the user
 * as the assistant being confidently wrong rather than correctly restricted.
 */
export function describeWithheld(
  withheld: FieldPolicyResult["withheld"]
): string | null {
  if (withheld.length === 0) return null;
  const sensitive = withheld.filter((w) => w.reason === "sensitive").map((w) => w.key);
  const notPermitted = withheld.filter((w) => w.reason === "not_permitted").map((w) => w.key);

  const parts: string[] = [];
  if (sensitive.length > 0) {
    parts.push(
      `Withheld as personal data (the user can unlock these with the sensitive-fields option): ${sensitive.join(", ")}.`
    );
  }
  if (notPermitted.length > 0) {
    parts.push(
      `Withheld — this account cannot access these columns: ${notPermitted.join(", ")}.`
    );
  }
  parts.push("State plainly in your answer which columns are missing and why.");
  return parts.join(" ");
}
