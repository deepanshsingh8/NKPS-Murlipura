/**
 * Which timetable groups a particular student should see.
 *
 * Migration 119 made a timetable cell hold parallel groups, so an XI period 5
 * runs Informatics Practices and Physical Education side by side — two rows,
 * two teachers, one slot. The class timetable is right to show both. A
 * student's own timetable is not: they attend one of them.
 *
 * The bridge between a pick and a timetable row is the SUBJECT. A pick is
 * (student, slot) -> subject; a timetable group carries a subject_id. Nothing
 * relates `student_elective_picks.slot` to `timetable_periods.period_number`,
 * and nothing needs to.
 *
 * ── The rule, and why it is this conservative ───────────────────────────────
 * A group is hidden only when all of:
 *   1. its subject is an elective option for some slot,
 *   2. that option is offered to this student's class, and
 *   3. the student has picked something for that slot, and it is not this
 *      subject (nor this subject in any other slot).
 *
 * Everything else is shown, which matters more than the hiding does:
 *
 * - A student with NO picks recorded sees every group, exactly as before.
 *   `student_elective_picks` is only filled when the office runs the XI/XII
 *   exercise, and the rest of the codebase already treats it as possibly-empty
 *   (api/students/bulk and the single-student export both have fallbacks).
 * - A CORE subject can never be hidden — it is not in elective_slot_options at
 *   all. This is why the filter is not built from `student_subjects`, which is
 *   sparsely populated and would hide Mathematics from a student whose only
 *   recorded subject is their elective.
 * - Physical Education is a slot-5 elective in XI and an ordinary subject in
 *   class VI. Condition 2 is what keeps the VI cell intact.
 */

import { optionAppliesTo } from "./electives";

export interface ElectiveSlotOptionRow {
  slot: number;
  subject_id: string;
  /** text[]; NULL or empty means both XI and XII. */
  applies_to_classes?: unknown;
  is_active?: boolean | null;
}

export interface ElectivePickRow {
  slot: number;
  subject_id: string;
}

export interface ElectiveFilterInput {
  options: ElectiveSlotOptionRow[];
  picks: ElectivePickRow[];
  /** The student's class NAME ("XI", "XII"), not its id. */
  className: string | null | undefined;
}

/**
 * Returns a predicate: should a timetable group with this subject be shown to
 * this student? Defaults to showing — an unknown class, no options or no picks
 * all mean "no basis to hide anything".
 */
export function buildElectiveFilter(
  input: ElectiveFilterInput
): (subjectId: string | null | undefined) => boolean {
  const hidden = electiveSubjectsToHide(input);
  if (hidden.size === 0) return () => true;
  return (subjectId) => !subjectId || !hidden.has(subjectId);
}

/**
 * The subject ids this student does NOT take, among the electives offered to
 * their class. Exported separately so a caller that already has a subject list
 * (the AI tool folds groups before rendering) can use the set directly.
 */
export function electiveSubjectsToHide({
  options,
  picks,
  className,
}: ElectiveFilterInput): Set<string> {
  const hidden = new Set<string>();
  if (!className || options.length === 0 || picks.length === 0) return hidden;

  // Slots the student has actually decided. A slot with no pick hides nothing:
  // we do not know what they take, so we show them everything on offer.
  const decidedSlots = new Set<number>();
  // Every subject they picked, across all slots. A subject offered in two
  // slots (UNIQUE is on (slot, subject_id), so that is legal) must survive if
  // it was picked in EITHER of them — checking slot-by-slot would hide a
  // subject the student genuinely takes.
  const pickedSubjects = new Set<string>();
  for (const p of picks) {
    decidedSlots.add(p.slot);
    pickedSubjects.add(p.subject_id);
  }

  for (const o of options) {
    if (o.is_active === false) continue;
    if (!decidedSlots.has(o.slot)) continue;
    if (pickedSubjects.has(o.subject_id)) continue;
    if (!optionAppliesTo(o.applies_to_classes, className)) continue;
    hidden.add(o.subject_id);
  }
  return hidden;
}
