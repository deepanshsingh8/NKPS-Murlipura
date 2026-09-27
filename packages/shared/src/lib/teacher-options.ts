import type { Teacher } from "@nkps/shared/types";

/**
 * Build the option list for a teacher `<Select>`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Every teacher dropdown in the ERP loads `teachers WHERE is_active` — correct
 * for picking someone new. But rows created earlier can still point at a
 * teacher who has since been retired (migration 116 made retiring a real
 * action, so this went from theoretical to routine). When the selected id is
 * absent from the option list the Select renders blank, and the next save
 * writes that blank back: the class quietly loses its class teacher, or the
 * period loses its teacher, with no error and nothing on screen to notice.
 *
 * So: keep the active teachers, and append whoever is currently selected if
 * they are not among them, labelled so the admin can see why they look odd.
 *
 * `all` is optional. When the caller has not loaded inactive teachers, a
 * selected-but-missing id still gets a placeholder option rather than nothing,
 * which preserves the value through a save even if the name is unknown.
 */

export interface TeacherOption {
  value: string;
  label: string;
}

export function teacherLabel(t: Pick<Teacher, "full_name" | "employee_id">): string {
  return t.employee_id ? `${t.full_name} (${t.employee_id})` : t.full_name;
}

export function teacherOptions(
  active: Teacher[],
  currentId?: string | null,
  all?: Teacher[]
): TeacherOption[] {
  const options: TeacherOption[] = active.map((t) => ({
    value: t.id,
    label: teacherLabel(t),
  }));

  if (!currentId) return options;
  if (options.some((o) => o.value === currentId)) return options;

  const known = all?.find((t) => t.id === currentId);
  options.push({
    value: currentId,
    label: known
      ? `${teacherLabel(known)} — inactive`
      : "Former teacher — inactive",
  });
  return options;
}
