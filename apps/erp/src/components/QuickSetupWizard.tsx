"use client";

import { useState, useMemo } from "react";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn, formatClassName } from "@nkps/shared/lib/utils";
import {
  CBSE_GRADE_BANDS,
  CBSE_STREAM_CURRICULA,
  ALL_CBSE_SUBJECTS,
  getSubjectsForClass,
} from "@/lib/cbse-curriculum";
import type { CurriculumSubject } from "@/lib/cbse-curriculum";
import type { Class, Subject } from "@nkps/shared/types";

interface AssignmentRow {
  id: string;
  class_id: string;
  subject_id: string;
}

interface QuickSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSubjects: Subject[];
  existingClasses: Class[];
  existingAssignments: AssignmentRow[];
  onSuccess: () => void;
}

type Step = 1 | 2 | 3;

interface EditableSubject extends CurriculumSubject {
  selected: boolean;
  exists: boolean;
}

export default function QuickSetupWizard({
  open,
  onOpenChange,
  existingSubjects,
  existingClasses,
  existingAssignments,
  onSuccess,
}: QuickSetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // ── Step 1: Editable subject list ──
  const [editableSubjects, setEditableSubjects] = useState<
    Map<string, EditableSubject>
  >(() => buildSubjectMap());

  function buildSubjectMap() {
    const existingNames = new Set(
      existingSubjects.map((s) => s.name.toLowerCase())
    );
    const map = new Map<string, EditableSubject>();
    for (const s of ALL_CBSE_SUBJECTS) {
      map.set(s.name, {
        ...s,
        selected: true,
        exists: existingNames.has(s.name.toLowerCase()),
      });
    }
    return map;
  }

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setStep(1);
      setEditableSubjects(buildSubjectMap());
    }
    onOpenChange(isOpen);
  };

  const toggleSubject = (name: string) => {
    setEditableSubjects((prev) => {
      const next = new Map(prev);
      const entry = next.get(name);
      if (entry) {
        next.set(name, { ...entry, selected: !entry.selected });
      }
      return next;
    });
  };

  const updateCode = (name: string, code: string) => {
    setEditableSubjects((prev) => {
      const next = new Map(prev);
      const entry = next.get(name);
      if (entry) {
        next.set(name, { ...entry, code });
      }
      return next;
    });
  };

  const toggleElective = (name: string) => {
    setEditableSubjects((prev) => {
      const next = new Map(prev);
      const entry = next.get(name);
      if (entry) {
        next.set(name, { ...entry, is_elective: !entry.is_elective });
      }
      return next;
    });
  };

  const selectedSubjects = useMemo(() => {
    return Array.from(editableSubjects.values()).filter((s) => s.selected);
  }, [editableSubjects]);

  const newSubjectsCount = useMemo(() => {
    return selectedSubjects.filter((s) => !s.exists).length;
  }, [selectedSubjects]);

  const existingSubjectsCount = useMemo(() => {
    return selectedSubjects.filter((s) => s.exists).length;
  }, [selectedSubjects]);

  // ── Step 2: Assignment preview ──

  // Build the existing subject name → id map
  const existingSubjectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of existingSubjects) {
      map.set(s.name.toLowerCase(), s.id);
    }
    return map;
  }, [existingSubjects]);

  // Build existing assignment set: "class_id|subject_id"
  const existingAssignmentSet = useMemo(() => {
    const set = new Set<string>();
    for (const a of existingAssignments) {
      set.add(`${a.class_id}|${a.subject_id}`);
    }
    return set;
  }, [existingAssignments]);

  // Helper: extract stream name from a class (which may have a `streams` join)
  function getStreamName(c: Class): string | null {
    // The classes are fetched with "streams:stream_id(name)" join
    const raw = c as unknown as Record<string, unknown>;
    if (typeof raw.stream_name === "string") return raw.stream_name;
    const streams = raw.streams as { name: string } | null | undefined;
    return streams?.name ?? null;
  }

  // Build class lookup: "name|section|stream_name" → class
  const classLookup = useMemo(() => {
    const map = new Map<
      string,
      Class & { stream_name?: string | null }
    >();
    for (const c of existingClasses) {
      const streamName = getStreamName(c);
      const key = `${c.name.toLowerCase()}|${c.section.toLowerCase()}|${(streamName || "").toLowerCase()}`;
      map.set(key, { ...c, stream_name: streamName });
    }
    return map;
  }, [existingClasses]);

  // Generate all planned assignments
  const plannedAssignments = useMemo(() => {
    const selectedNames = new Set(selectedSubjects.map((s) => s.name));
    const result: {
      class_name: string;
      section: string;
      stream_name: string | null;
      subject_name: string;
      classExists: boolean;
      alreadyAssigned: boolean;
      classLabel: string;
    }[] = [];

    const SENIOR_CLASSES = ["XI", "XII"];

    for (const cls of existingClasses) {
      const streamName = getStreamName(cls);

      const subjects = getSubjectsForClass(cls.name, streamName);

      for (const subj of subjects) {
        if (!selectedNames.has(subj.name)) continue;

        // Check if XI/XII without stream — skip
        if (SENIOR_CLASSES.includes(cls.name) && !streamName) continue;

        const subjectId = existingSubjectNameMap.get(
          subj.name.toLowerCase()
        );
        const alreadyAssigned = subjectId
          ? existingAssignmentSet.has(`${cls.id}|${subjectId}`)
          : false;

        result.push({
          class_name: cls.name,
          section: cls.section,
          stream_name: streamName,
          subject_name: subj.name,
          classExists: true,
          alreadyAssigned,
          classLabel: formatClassName({
            name: cls.name,
            section: cls.section,
            stream_name: streamName,
          }),
        });
      }
    }

    // Sort by class sort_order, then subject name
    const classOrderMap = new Map<string, number>();
    for (const c of existingClasses) {
      classOrderMap.set(c.id, c.sort_order);
    }

    result.sort((a, b) => {
      const aLabel = a.classLabel;
      const bLabel = b.classLabel;
      if (aLabel !== bLabel) return aLabel.localeCompare(bLabel);
      return a.subject_name.localeCompare(b.subject_name);
    });

    return result;
  }, [
    existingClasses,
    selectedSubjects,
    existingSubjectNameMap,
    existingAssignmentSet,
  ]);

  const newAssignmentsCount = plannedAssignments.filter(
    (a) => !a.alreadyAssigned
  ).length;
  const existingAssignmentsCount = plannedAssignments.filter(
    (a) => a.alreadyAssigned
  ).length;

  // Group assignments by class for display
  const assignmentsByClass = useMemo(() => {
    const groups = new Map<
      string,
      {
        classLabel: string;
        assignments: typeof plannedAssignments;
      }
    >();

    for (const a of plannedAssignments) {
      if (!groups.has(a.classLabel)) {
        groups.set(a.classLabel, { classLabel: a.classLabel, assignments: [] });
      }
      groups.get(a.classLabel)!.assignments.push(a);
    }

    return Array.from(groups.values());
  }, [plannedAssignments]);

  // Check for missing classes (classes that should exist but don't)
  const missingClasses = useMemo(() => {
    const existing = new Set(existingClasses.map((c) => c.name));
    const allNeeded = new Set<string>();
    for (const band of CBSE_GRADE_BANDS) {
      for (const cn of band.classes) allNeeded.add(cn);
    }
    // XI/XII handled via streams
    allNeeded.add("XI");
    allNeeded.add("XII");
    return Array.from(allNeeded).filter((cn) => !existing.has(cn));
  }, [existingClasses]);

  // ── Step 3: Execute ──

  const handleExecute = async () => {
    setSubmitting(true);

    const subjectsPayload = selectedSubjects.map((s) => ({
      name: s.name,
      code: s.code,
      is_elective: s.is_elective,
    }));

    const assignmentsPayload = plannedAssignments
      .filter((a) => !a.alreadyAssigned)
      .map((a) => ({
        class_name: a.class_name,
        section: a.section,
        stream_name: a.stream_name,
        subject_name: a.subject_name,
      }));

    try {
      const res = await fetch("/api/subjects/quick-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjects: subjectsPayload,
          assignments: assignmentsPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Quick setup failed");
        setSubmitting(false);
        return;
      }

      const parts: string[] = [];
      if (data.subjects_created > 0) {
        parts.push(`${data.subjects_created} subject${data.subjects_created === 1 ? "" : "s"} created`);
      }
      if (data.assignments_created > 0) {
        parts.push(`${data.assignments_created} assignment${data.assignments_created === 1 ? "" : "s"} created`);
      }

      if (parts.length > 0) {
        toast.success(`Quick setup complete: ${parts.join(", ")}`);
      } else {
        toast.info("Everything was already set up — no changes needed");
      }

      if (data.missing_classes?.length > 0) {
        toast.warning(
          `${data.missing_classes.length} class${data.missing_classes.length === 1 ? "" : "es"} not found — create them first: ${data.missing_classes.join(", ")}`
        );
      }

      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Failed to connect to server");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle>Quick Setup — CBSE Curriculum</DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                Pre-populate subjects and assign them to your classes
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-1">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  "flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold transition-colors",
                  step === s
                    ? "bg-navy-900 text-white"
                    : step > s
                      ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-400 dark:bg-muted dark:text-gray-500"
                )}
              >
                {step > s ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  s
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium hidden sm:block",
                  step === s
                    ? "text-navy-900 dark:text-white"
                    : "text-gray-400 dark:text-gray-500"
                )}
              >
                {s === 1 ? "Subjects" : s === 2 ? "Assignments" : "Confirm"}
              </span>
              {s < 3 && (
                <div className="flex-1 h-px bg-gray-200 dark:bg-border" />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto min-h-0 py-2">
          {/* ── Step 1: Review Subjects ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Review and customize the CBSE subjects to create.
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs"
                  >
                    {newSubjectsCount} new
                  </Badge>
                  {existingSubjectsCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs"
                    >
                      {existingSubjectsCount} exist
                    </Badge>
                  )}
                </div>
              </div>

              {/* Grouped by source band */}
              {CBSE_GRADE_BANDS.map((band) => (
                <div key={band.label} className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {band.label}
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setEditableSubjects((prev) => {
                          const next = new Map(prev);
                          const bandNames = band.subjects.map((s) => s.name);
                          const allSelected = bandNames.every(
                            (n) => next.get(n)?.selected
                          );
                          for (const n of bandNames) {
                            const entry = next.get(n);
                            if (entry)
                              next.set(n, {
                                ...entry,
                                selected: !allSelected,
                              });
                          }
                          return next;
                        });
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Toggle all
                    </button>
                  </div>
                  <div className="space-y-1">
                    {band.subjects.map((subj) => {
                      const entry = editableSubjects.get(subj.name);
                      if (!entry) return null;
                      return (
                        <SubjectRow
                          key={subj.name}
                          entry={entry}
                          onToggle={() => toggleSubject(subj.name)}
                          onCodeChange={(code) =>
                            updateCode(subj.name, code)
                          }
                          onToggleElective={() =>
                            toggleElective(subj.name)
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Stream-specific subjects (only show ones not already in grade bands) */}
              {(() => {
                const gradeBandNames = new Set(
                  CBSE_GRADE_BANDS.flatMap((b) =>
                    b.subjects.map((s) => s.name)
                  )
                );
                const streamOnlySubjects = CBSE_STREAM_CURRICULA.flatMap(
                  (sc) => sc.subjects
                ).filter((s) => !gradeBandNames.has(s.name));

                const uniqueStreamSubjects = Array.from(
                  new Map(
                    streamOnlySubjects.map((s) => [s.name, s])
                  ).values()
                );

                if (uniqueStreamSubjects.length === 0) return null;

                return (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
                      Senior Secondary (XI–XII) — Stream Subjects
                    </h4>
                    <div className="space-y-1">
                      {uniqueStreamSubjects.map((subj) => {
                        const entry = editableSubjects.get(subj.name);
                        if (!entry) return null;
                        return (
                          <SubjectRow
                            key={subj.name}
                            entry={entry}
                            onToggle={() => toggleSubject(subj.name)}
                            onCodeChange={(code) =>
                              updateCode(subj.name, code)
                            }
                            onToggleElective={() =>
                              toggleElective(subj.name)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Step 2: Review Assignments ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  These subjects will be assigned to your existing classes.
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs"
                  >
                    {newAssignmentsCount} new
                  </Badge>
                  {existingAssignmentsCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs"
                    >
                      {existingAssignmentsCount} exist
                    </Badge>
                  )}
                </div>
              </div>

              {missingClasses.length > 0 && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-950/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        Missing classes
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        These classes don&apos;t exist yet for the current academic year.
                        Create them on the Classes page first:{" "}
                        <strong>{missingClasses.join(", ")}</strong>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {assignmentsByClass.length === 0 ? (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No assignments to create</p>
                  <p className="text-xs mt-1">
                    Make sure classes exist for the current academic year
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assignmentsByClass.map((group) => (
                    <div
                      key={group.classLabel}
                      className="rounded-lg border border-gray-200 dark:border-border p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Badge
                          variant="secondary"
                          className="bg-navy-100 dark:bg-navy-900/30 text-navy-800 dark:text-navy-200 font-medium"
                        >
                          {group.classLabel}
                        </Badge>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {group.assignments.filter((a) => !a.alreadyAssigned).length} new
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.assignments.map((a) => (
                          <Badge
                            key={`${a.classLabel}-${a.subject_name}`}
                            variant="secondary"
                            className={cn(
                              "text-xs",
                              a.alreadyAssigned
                                ? "bg-gray-100 dark:bg-muted text-gray-400 dark:text-gray-500 line-through"
                                : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                            )}
                          >
                            {a.subject_name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <Sparkles className="h-10 w-10 mx-auto text-amber-500 mb-3" />
                <h3 className="text-lg font-semibold text-navy-900 dark:text-white">
                  Ready to set up
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Here&apos;s what will happen:
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                <div className="rounded-xl border border-gray-200 dark:border-border p-4 text-center">
                  <p className="text-2xl font-bold text-navy-900 dark:text-white">
                    {newSubjectsCount}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    subjects to create
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-border p-4 text-center">
                  <p className="text-2xl font-bold text-navy-900 dark:text-white">
                    {newAssignmentsCount}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    assignments to create
                  </p>
                </div>
              </div>

              {(existingSubjectsCount > 0 ||
                existingAssignmentsCount > 0) && (
                <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                  Skipping {existingSubjectsCount} existing subject
                  {existingSubjectsCount === 1 ? "" : "s"} and{" "}
                  {existingAssignmentsCount} existing assignment
                  {existingAssignmentsCount === 1 ? "" : "s"}
                </p>
              )}

              {missingClasses.length > 0 && (
                <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                  {missingClasses.length} class
                  {missingClasses.length === 1 ? "" : "es"} not found — those
                  assignments will be skipped
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => (s - 1) as Step)}
                disabled={submitting}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => (s + 1) as Step)}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleExecute}
                disabled={
                  submitting ||
                  (newSubjectsCount === 0 && newAssignmentsCount === 0)
                }
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Run Setup
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Subject row component ──

function SubjectRow({
  entry,
  onToggle,
  onCodeChange,
  onToggleElective,
}: {
  entry: EditableSubject;
  onToggle: () => void;
  onCodeChange: (code: string) => void;
  onToggleElective: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        entry.selected
          ? "bg-blue-50/50 dark:bg-blue-950/10"
          : "hover:bg-gray-50 dark:hover:bg-muted/50 opacity-50"
      )}
    >
      <input
        type="checkbox"
        checked={entry.selected}
        onChange={onToggle}
        className="rounded border-gray-300 dark:border-gray-600 text-navy-900 focus:ring-navy-900"
      />
      <span className="text-sm font-medium text-gray-900 dark:text-white flex-1 min-w-0">
        {entry.name}
        {entry.exists && (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline ml-1.5 -mt-0.5" />
        )}
      </span>
      <Input
        value={entry.code}
        onChange={(e) => onCodeChange(e.target.value)}
        className="h-7 w-20 text-xs text-center"
        placeholder="Code"
        disabled={!entry.selected}
      />
      <button
        type="button"
        onClick={onToggleElective}
        disabled={!entry.selected}
        className={cn(
          "text-xs px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
          entry.is_elective
            ? "border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/30"
            : "border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/30"
        )}
      >
        {entry.is_elective ? "Elective" : "Core"}
      </button>
    </div>
  );
}
