"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import { cn, formatClassName } from "@nkps/shared/lib/utils";
import {
  isTeachingStaffCategory,
  staffPortalRole,
} from "@nkps/shared/lib/staff-roles";
import type { Gender, StaffMember } from "@nkps/shared/types";
import { Loader2, Pencil, UserCheck, UserX } from "lucide-react";
import { StaffAvatar } from "@/components/StaffAvatar";

// Read-only view of one staff member, opened from the name in the directory.
// Everything on the staff_members row is shown; for a teaching member with a
// linked teachers row the teacher-only fields and this year's class-teacher and
// subject assignments are fetched on open, since that is the part an admin
// cannot see anywhere else without opening several other screens.

type TeachingDetails = {
  employee_id: string;
  date_of_joining: string | null;
  gender: Gender | null;
  specialization: string | null;
  // Retired teachers (migration 116) keep their row; the dialog says so
  // rather than silently listing nothing.
  is_active: boolean;
  date_of_leaving: string | null;
  // Subjects they are qualified for (teacher_subjects, migration 117) —
  // distinct from what they are timetabled to teach this year.
  canTeach: string[];
  classTeacherOf: string[];
  teaches: { subject: string; classes: string[] }[];
};

type TeacherRow = {
  id: string;
  employee_id: string;
  date_of_joining: string | null;
  gender: Gender | null;
  specialization: string | null;
  is_active: boolean;
  date_of_leaving: string | null;
};

type ClassRow = {
  id: string;
  name: string;
  section: string;
  streams: { name: string } | { name: string }[] | null;
};

type ClassSubjectRow = {
  classes: ClassRow | null;
  subjects: { name: string } | null;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

function DetailField({
  label,
  value,
  className,
  children,
}: {
  label: string;
  value?: string | number | null;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </p>
      {children ?? (
        <p className="text-sm text-gray-800 dark:text-gray-100 break-words">
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 border-b pb-1.5">
      {children}
    </h3>
  );
}

async function loadTeachingDetails(
  staffMemberId: string
): Promise<TeachingDetails | null> {
  const supabase = createClient();
  const [teacherRes, yearRes] = await Promise.all([
    supabase
      .from("teachers")
      .select(
        "id, employee_id, date_of_joining, gender, specialization, is_active, date_of_leaving"
      )
      .eq("staff_member_id", staffMemberId)
      .maybeSingle(),
    supabase.from("academic_years").select("id").eq("is_current", true).limit(1),
  ]);
  const teacher = teacherRes.data as TeacherRow | null;
  if (!teacher) return null;

  // Assignments are per academic year; show only the current one when a year
  // is flagged current, otherwise fall back to everything rather than nothing.
  const currentYearId = (yearRes.data?.[0]?.id as string | undefined) ?? null;

  let classQuery = supabase
    .from("classes")
    .select("id, name, section, streams:stream_id(name)")
    .eq("class_teacher_id", teacher.id)
    .order("name")
    .order("section");
  let subjectQuery = supabase
    .from("class_subjects")
    .select(
      "classes:class_id!inner(id, name, section, streams:stream_id(name)), subjects:subject_id(name)"
    )
    .eq("teacher_id", teacher.id);
  if (currentYearId) {
    classQuery = classQuery.eq("academic_year_id", currentYearId);
    subjectQuery = subjectQuery.eq("classes.academic_year_id", currentYearId);
  }

  const [classRes, subjectRes, canTeachRes] = await Promise.all([
    classQuery,
    subjectQuery,
    supabase
      .from("teacher_subjects")
      .select("subjects:subject_id(name)")
      .eq("teacher_id", teacher.id),
  ]);
  const canTeach = (
    (canTeachRes.data ?? []) as unknown as { subjects: { name: string } | null }[]
  )
    .map((r) => r.subjects?.name)
    .filter((n): n is string => !!n)
    .sort();
  const classTeacherOf = ((classRes.data ?? []) as unknown as ClassRow[]).map(
    formatClassName
  );

  // One line per subject, listing every class it is taught to.
  const bySubject = new Map<string, string[]>();
  for (const row of (subjectRes.data ?? []) as unknown as ClassSubjectRow[]) {
    if (!row.classes || !row.subjects) continue;
    const list = bySubject.get(row.subjects.name) ?? [];
    list.push(formatClassName(row.classes));
    bySubject.set(row.subjects.name, list);
  }
  const teaches = Array.from(bySubject, ([subject, classes]) => ({
    subject,
    classes: classes.sort(),
  })).sort((a, b) => a.subject.localeCompare(b.subject));

  return {
    employee_id: teacher.employee_id,
    date_of_joining: teacher.date_of_joining,
    gender: teacher.gender,
    specialization: teacher.specialization,
    is_active: teacher.is_active,
    date_of_leaving: teacher.date_of_leaving,
    canTeach,
    classTeacherOf,
    teaches,
  };
}

export function StaffDetailDialog({
  member,
  onClose,
  onEdit,
  hasLogin,
  teacherLinked,
  categoryLabel,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onEdit: (member: StaffMember) => void;
  hasLogin: boolean;
  teacherLinked: boolean;
  categoryLabel: string;
}) {
  // The loaded assignments are tagged with the member they belong to, so
  // opening a different person simply stops matching — no reset state needed,
  // and a slow response for the previous person can never be shown as this one.
  const [loaded, setLoaded] = useState<{
    memberId: string;
    details: TeachingDetails | null;
  } | null>(null);

  const wantsTeaching =
    !!member && isTeachingStaffCategory(member.category) && teacherLinked;

  useEffect(() => {
    if (!member || !wantsTeaching) return;
    const memberId = member.id;
    let cancelled = false;
    loadTeachingDetails(memberId)
      .then((details) => {
        if (!cancelled) setLoaded({ memberId, details });
      })
      .catch((err) => {
        console.error("Failed to load teacher details:", err);
        if (!cancelled) setLoaded({ memberId, details: null });
      });
    return () => {
      cancelled = true;
    };
  }, [member, wantsTeaching]);

  const teaching =
    loaded && member && loaded.memberId === member.id ? loaded.details : null;
  const teachingLoading = wantsTeaching && loaded?.memberId !== member?.id;

  const portalRole = member ? staffPortalRole(member.category) : null;

  return (
    <Dialog
      open={!!member}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {member && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-4">
                <StaffAvatar
                  name={member.name}
                  photoUrl={member.photo_url}
                  size="lg"
                />
                <div className="min-w-0 flex-1 pt-1">
                  <DialogTitle className="truncate">{member.name}</DialogTitle>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {member.subject}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {categoryLabel}
                    </Badge>
                    {!member.is_active && (
                      <Badge variant="outline" className="text-gray-500">
                        Inactive
                      </Badge>
                    )}
                    {/* Login status mirrors the row action: a tick when a
                        login exists, otherwise why there isn't one. */}
                    {hasLogin ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <UserCheck className="h-3.5 w-3.5" />
                        Has portal login
                      </span>
                    ) : portalRole ? (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <UserX className="h-3.5 w-3.5" />
                        No login yet
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">
                        No portal login for this category
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-5 sm:max-h-[55dvh] sm:overflow-y-auto sm:pr-1">
              <section className="space-y-3">
                <SectionTitle>Contact &amp; personal</SectionTitle>
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <DetailField label="Email" value={member.email} />
                  <DetailField label="Phone" value={member.phone} />
                  <DetailField
                    label="Date of Birth"
                    value={formatDate(member.date_of_birth)}
                  />
                  <DetailField
                    label="Qualifications"
                    value={member.qualifications}
                  />
                  <DetailField
                    label="Address"
                    value={member.address}
                    className="col-span-2"
                  />
                  {member.category === "busDriver" && (
                    <DetailField
                      label="Driving License Number"
                      value={member.license_number}
                    />
                  )}
                </div>
              </section>

              {isTeachingStaffCategory(member.category) && (
                <section className="space-y-3">
                  <SectionTitle>Teaching</SectionTitle>
                  {!teacherLinked ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Not yet converted to a teacher record — use the
                      graduation-cap action on the row. Until then they cannot
                      be picked as a class or subject teacher.
                    </p>
                  ) : teachingLoading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading assignments…
                    </div>
                  ) : !teaching ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Teacher record could not be loaded.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                      {!teaching.is_active && (
                        <p className="col-span-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          Retired
                          {teaching.date_of_leaving
                            ? ` on ${formatDate(teaching.date_of_leaving)}`
                            : ""}{" "}
                          — no longer offered in teacher dropdowns.
                        </p>
                      )}
                      <DetailField
                        label="Employee ID"
                        value={teaching.employee_id}
                      />
                      <DetailField
                        label="Date of Joining"
                        value={formatDate(teaching.date_of_joining)}
                      />
                      <DetailField
                        label="Gender"
                        value={teaching.gender ? GENDER_LABELS[teaching.gender] : null}
                      />
                      <DetailField
                        label="Specialization"
                        value={teaching.specialization}
                      />
                      <DetailField label="Can teach" className="col-span-2">
                        {teaching.canTeach.length === 0 ? (
                          <p className="text-sm text-gray-400">
                            No subjects recorded
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {teaching.canTeach.map((s) => (
                              <Badge key={s} variant="secondary">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </DetailField>
                      <DetailField label="Class teacher of" className="col-span-2">
                        {teaching.classTeacherOf.length === 0 ? (
                          <p className="text-sm text-gray-400">None this year</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {teaching.classTeacherOf.map((c) => (
                              <Badge key={c} variant="outline">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </DetailField>
                      <DetailField label="Teaches" className="col-span-2">
                        {teaching.teaches.length === 0 ? (
                          <p className="text-sm text-gray-400">
                            No subject assignments this year
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {teaching.teaches.map((t) => (
                              <li
                                key={t.subject}
                                className="text-sm text-gray-800 dark:text-gray-100"
                              >
                                <span className="font-medium">{t.subject}</span>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {" "}
                                  — {t.classes.join(", ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </DetailField>
                    </div>
                  )}
                </section>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => onEdit(member)} className="gap-2">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
