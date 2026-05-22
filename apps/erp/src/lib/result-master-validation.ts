// Shared validators for Result Master routes. Enforces the `pass_criteria_type`
// is one of `SUPPORTED_PASS_CRITERIA_TYPES` (imported from final-result so new
// types auto-propagate) and the config shape matches the type.

import { SUPPORTED_PASS_CRITERIA_TYPES } from "@/lib/final-result";

export function validatePassCriteria(
  type: string,
  config: Record<string, unknown>
): string | null {
  if (!(SUPPORTED_PASS_CRITERIA_TYPES as readonly string[]).includes(type)) {
    return `Unsupported pass_criteria_type "${type}". Supported: ${SUPPORTED_PASS_CRITERIA_TYPES.join(", ")}`;
  }

  switch (type) {
    case "all_main_subjects": {
      const keys = Object.keys(config ?? {});
      if (keys.length !== 0) {
        return `pass_criteria_config for "all_main_subjects" must be an empty object (got keys: ${keys.join(", ")})`;
      }
      return null;
    }
    case "overall_percentage":
    case "main_and_overall":
    case "allow_one_fail": {
      const pct = config?.overall_pct;
      if (typeof pct !== "number" || !Number.isFinite(pct)) {
        return `pass_criteria_config.overall_pct must be a number for "${type}"`;
      }
      if (pct < 0 || pct > 100) {
        return `pass_criteria_config.overall_pct must be between 0 and 100 (got ${pct})`;
      }
      return null;
    }
    case "pass_n_subjects": {
      const n = config?.n;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
        return `pass_criteria_config.n must be an integer ≥ 1 for "pass_n_subjects"`;
      }
      return null;
    }
    default:
      // Unreachable given the supported-list check above, but keeps TS happy
      // and leaves a hook for new types that don't require config.
      return null;
  }
}
