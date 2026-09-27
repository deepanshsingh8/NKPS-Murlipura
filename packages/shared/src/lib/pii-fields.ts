/**
 * One place that says what counts as personal data.
 *
 * Two sets grew up independently — `report-fields.ts` (the report builder) and
 * `export-handler.ts` (every other list export) — and they disagree. Both are
 * reproduced here verbatim so the disagreement is visible in one file instead
 * of being discovered during an audit, and so a third consumer (the AI
 * assistant) does not become a fourth opinion.
 *
 * The two known divergences, neither of which this module changes:
 *
 *  1. **Contact numbers.** `EXPORT_SENSITIVE_KEYS` withholds `phone`, `email`,
 *     `father_mobile`, `mother_mobile` and `guardian_mobile` from non-admins;
 *     `REPORT_SENSITIVE_KEYS` does not. So an editor holding the `reports`
 *     grant can currently export every parent's mobile number through the
 *     report builder but not through the other export paths. That is a real
 *     inconsistency to resolve deliberately — tightening the report builder is
 *     a behaviour change for existing users and does not belong in a refactor.
 *
 *  2. **Spelling.** `export-handler.ts` guards both `aadhar_number` and
 *     `aadhaar_number`. Only the single-a spelling is a real column
 *     (`students.aadhar_number`, and `aadhar_number` in the student template
 *     registry); the double-a entry matches nothing. Kept because a harmless
 *     extra key is cheaper than a rename that misses a call site.
 *
 * Until those are settled, anything reading school data through the AI path
 * uses `AI_SENSITIVE_KEYS` — the union — because a set that is merely the
 * intersection of two disagreeing opinions leaks whatever the other one caught.
 */

/**
 * What the report builder withholds from non-admins.
 * Consumed by `report-fields.ts`; changing it changes `/reports/students`.
 */
export const REPORT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "aadhar_number",
  "jan_aadhar_number",
  "name_as_per_aadhar",
  "father_annual_income",
  "mother_annual_income",
  "address",
  "permanent_address",
  "mailing_address",
  "office_address",
  "mother_office_address",
  "present_pincode",
  "permanent_pincode",
  "caution_money_amount",
  "counsellor_remark",
  "pen_number",
  "apaar_number",
  "nic_number",
]);

/**
 * What the generic list exports withhold from non-admins.
 * Consumed by `apps/erp/src/lib/export-handler.ts`.
 *
 * Note these are export-column keys, not report-field keys — the two key
 * spaces overlap but are not identical (`parent_phone` / `parent_email` exist
 * only here).
 */
export const EXPORT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "phone",
  "email",
  "address",
  "permanent_address",
  "present_pincode",
  "permanent_pincode",
  "father_mobile",
  "mother_mobile",
  "guardian_mobile",
  "father_annual_income",
  "mother_annual_income",
  "aadhar_number",
  "aadhaar_number",
  "jan_aadhar_number",
  "name_as_per_aadhar",
  "parent_phone",
  "parent_email",
]);

/**
 * The gate for anything reached through the AI assistant.
 *
 * Deliberately the union, and deliberately stricter than the screen it fronts:
 * a model-generated sheet of Aadhaar numbers or parent mobiles is a different
 * risk from a person ticking those columns knowingly, and the AI path is new
 * enough that it has no existing users to break.
 */
export const AI_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  ...REPORT_SENSITIVE_KEYS,
  ...EXPORT_SENSITIVE_KEYS,
]);

/** True when `key` must be withheld from a non-admin on the AI path. */
export function isAiSensitiveKey(key: string): boolean {
  return AI_SENSITIVE_KEYS.has(key);
}
