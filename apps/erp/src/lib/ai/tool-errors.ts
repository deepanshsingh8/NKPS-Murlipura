/**
 * Errors a tool hands back to the model.
 *
 * Two audiences, one object: the model has to be able to act on it, and the
 * audit trail has to be able to count it. So every error carries a stable
 * `code` (countable, alertable) and a `message` written for the model to read
 * and correct itself.
 */

export type ToolErrorCode =
  /** Zod rejected the model's filters. Recoverable — the model retries. */
  | "invalid_filters"
  /** Every requested field key was unknown. Recoverable. */
  | "unknown_fields"
  /** The model reached outside the caller's scope. NOT recoverable by retry. */
  | "scope_violation"
  /** The caller has no rows at all (e.g. a teacher assigned no class). */
  | "empty_scope"
  /** A parent asked about a child that is not theirs, or does not exist. */
  | "not_your_child"
  /** Budget exhausted — too many tool calls or too long. */
  | "budget_exhausted"
  /** The database failed. Not the model's fault; do not invite a retry. */
  | "query_failed";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  detail?: unknown;
}

/**
 * Codes where retrying with corrected arguments can actually succeed.
 * The runner uses this to decide whether to let the model try again, so a
 * scope violation cannot become a retry loop against the same wall.
 */
const RECOVERABLE: ReadonlySet<ToolErrorCode> = new Set([
  "invalid_filters",
  "unknown_fields",
]);

export function isRecoverable(code: ToolErrorCode): boolean {
  return RECOVERABLE.has(code);
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  detail?: unknown
): ToolError {
  return { code, message, detail };
}

/**
 * The one message a caller may see for "no such student" AND for "not your
 * student".
 *
 * Distinguishing them would turn the assistant into a student-enumeration
 * oracle: a parent could probe admission numbers and learn which ones exist
 * from the difference in wording. The audit row still records which case it
 * actually was.
 */
export const NOT_YOUR_CHILD_MESSAGE =
  "I can only help with your own children's records.";

/** Serialise for a tool_result block. Keep it terse — this costs tokens. */
export function renderToolError(error: ToolError): string {
  const parts = [`error: ${error.code}`, error.message];
  if (error.detail !== undefined) {
    parts.push(`detail: ${JSON.stringify(error.detail)}`);
  }
  if (!isRecoverable(error.code)) {
    parts.push("Do not retry this call. Tell the user what you cannot do.");
  }
  return parts.join("\n");
}
