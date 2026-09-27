// Resolving a stream NAME to the stream row the school actually keeps.
//
// The school's own vocabulary and everyone else's disagree. The ERP stores the
// humanities stream as "Humanities"; the previous software's exports, the
// bulk-upload sheets people hand in, and the classes printed on a fee receipt
// all say "Arts". Both mean the same eleven students.
//
// Matching on the literal name is the failure this module exists to prevent,
// and it fails quietly in both directions: a lookup misses, so a real stream
// looks absent — and then the caller "helpfully" creates a second stream row
// beside the first, along with duplicate classes hanging off it. Nothing
// errors. You find out when a class appears twice in a dropdown.
//
// This logic lived inside api/students/bulk. It is here so every importer
// shares one answer.

export interface StreamRow {
  id: string;
  name: string;
  /**
   * migration 118. The `streams` table also holds wings — class bands that are
   * never attached to a class or a fee row. Rows marked 'wing' are skipped by
   * `buildStreamLookup`, so a caller that forgets to filter its query still
   * cannot resolve a spreadsheet's "Science" to a wing that happens to be
   * named Science. Omitted (undefined) counts as a stream.
   */
  kind?: string | null;
}

/**
 * Canonical stream name → other spellings that mean the same stream.
 *
 * Keyed on the name as the ERP stores it. Add a spelling here rather than
 * renaming the stream: the name is printed on marksheets and TCs.
 */
export const STREAM_ALIASES: Record<string, string[]> = {
  humanities: ["arts", "art", "humanities stream", "arts stream", "hum"],
  science: ["sci", "science stream"],
  commerce: ["comm", "commerce stream", "comm."],
};

function normalize(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build a name → stream_id lookup that answers to aliases as well as to the
 * stored name. Pass every row of `streams`.
 */
export function buildStreamLookup(streams: StreamRow[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const s of streams) {
    // Wings are not streams and must never answer a stream lookup — resolving
    // one would write a wing id into classes.stream_id or
    // fee_structures.stream_id, where fee resolution reads it. (migration 118)
    if (s.kind === "wing") continue;
    const canonical = normalize(s.name);
    lookup.set(canonical, s.id);
    for (const alias of STREAM_ALIASES[canonical] ?? []) {
      // A stored stream never loses to an alias of a different one.
      if (!lookup.has(alias)) lookup.set(alias, s.id);
    }
  }
  // A stored stream named by one of its own aliases ("Arts") still answers to
  // the canonical name, so callers can ask either way.
  for (const [canonical, aliases] of Object.entries(STREAM_ALIASES)) {
    if (lookup.has(canonical)) continue;
    for (const alias of aliases) {
      const id = lookup.get(alias);
      if (id) {
        lookup.set(canonical, id);
        break;
      }
    }
  }
  return lookup;
}

/** `null` for a blank name, or when no stored stream matches. */
export function resolveStreamId(
  lookup: Map<string, string>,
  name: string | null | undefined
): string | null {
  if (!name) return null;
  return lookup.get(normalize(name)) ?? null;
}

/**
 * True when the school has no stream that this name could mean.
 *
 * Use this — never `!lookup.has(name)` on a bare name — before creating a
 * stream, so "Arts" cannot spawn a twin of "Humanities".
 */
export function streamIsMissing(
  lookup: Map<string, string>,
  name: string | null | undefined
): boolean {
  return Boolean(name) && resolveStreamId(lookup, name) === null;
}

/**
 * Every stream name already in use, of ANY kind, normalised.
 *
 * The importers create a stream when the sheet names one the school does not
 * have. `buildStreamLookup` deliberately cannot see wings — which means a
 * sheet saying "Science" when only a *wing* called Science exists would look
 * like a missing stream, and the importer would insert a second row with that
 * name. Exactly the twin `streamIsMissing` exists to prevent, arriving through
 * the other door.
 *
 * So: resolve through the lookup, but check this guard before creating.
 */
export function buildStreamNameGuard(streams: StreamRow[]): Set<string> {
  return new Set(streams.map((s) => normalize(s.name)));
}

/** True when some stream or wing already owns this name. */
export function streamNameTaken(
  guard: Set<string>,
  name: string | null | undefined
): boolean {
  return Boolean(name) && guard.has(normalize(name!));
}
