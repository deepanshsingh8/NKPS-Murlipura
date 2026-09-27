/**
 * Which senior classes an elective slot option is offered to.
 *
 * `elective_slot_options.applies_to_classes` has existed since migration 049
 * (defaulting to {XI,XII}) but nothing ever read it: both the admin list and
 * the per-student picker showed one list per slot to XI and XII alike. This
 * module is the rule both sides now share, so the list an admin curates and
 * the list a student can be assigned from cannot drift apart.
 *
 * `UNIQUE(slot, subject_id)` means one subject appears at most once per slot,
 * so a subject offered to both classes is ONE row listing both — never two
 * rows. Narrowing an option to a single class edits that array; it does not
 * split the row.
 */

export const ELECTIVE_CLASSES = ["XI", "XII"] as const;

export type ElectiveClass = (typeof ELECTIVE_CLASSES)[number];

export function isElectiveClass(value: unknown): value is ElectiveClass {
  return (
    typeof value === "string" &&
    (ELECTIVE_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * Reads a stored `applies_to_classes` value into a clean class list.
 *
 * NULL or an empty array means "both" — rows written before this was wired up
 * relied on the column default, and a row that applies to nothing at all would
 * be invisible with no way to fix it from the UI. Order follows
 * ELECTIVE_CLASSES so the badges read "XI, XII" consistently.
 */
export function normaliseElectiveClasses(raw: unknown): ElectiveClass[] {
  if (!Array.isArray(raw)) return [...ELECTIVE_CLASSES];
  const found = ELECTIVE_CLASSES.filter((c) => raw.includes(c));
  return found.length > 0 ? found : [...ELECTIVE_CLASSES];
}

/** Is this option offered to the given class? */
export function optionAppliesTo(raw: unknown, cls: string): boolean {
  return (normaliseElectiveClasses(raw) as readonly string[]).includes(cls);
}

/** "XI only", "XII only", "XI & XII" — the phrasing used in admin messages. */
export function describeElectiveClasses(raw: unknown): string {
  const classes = normaliseElectiveClasses(raw);
  return classes.length === ELECTIVE_CLASSES.length
    ? "XI & XII"
    : `${classes[0]} only`;
}
