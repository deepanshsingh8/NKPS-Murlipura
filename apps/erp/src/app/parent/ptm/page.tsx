"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Loader2,
  MessageSquare,
  CheckCircle2,
  XCircle,
  User,
} from "lucide-react";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
}

interface PtmNote {
  id: string;
  student_id: string;
  exam_type_id: string | null;
  meeting_date: string;
  attendance: "present" | "absent";
  teacher_remarks: string | null;
  parent_remarks: string | null;
  action_points: string | null;
  created_at: string;
}

interface ExamType {
  id: string;
  name: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ParentPtmPage() {
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [notes, setNotes] = useState<PtmNote[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingNotes, setLoadingNotes] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("parent_id")
        .eq("id", user.id)
        .single();
      const parentId = profile?.parent_id as string | undefined;
      if (!parentId) {
        setLoading(false);
        return;
      }

      const { data: studentParents } = await supabase
        .from("student_parents")
        .select("student_id, students(id, full_name)")
        .eq("parent_id", parentId);

      const childOptions: ChildOption[] = [];
      for (const sp of studentParents ?? []) {
        const student = sp.students as unknown as {
          id: string;
          full_name: string;
        } | null;
        if (!student) continue;
        const { data: enrollment } = await supabase
          .from("student_enrollments")
          .select("classes(name, section)")
          .eq("student_id", student.id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        const classInfo = enrollment?.classes as unknown as {
          name: string;
          section: string;
        } | null;
        childOptions.push({
          student_id: student.id,
          full_name: student.full_name,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
        });
      }

      setChildren(childOptions);
      if (childOptions[0]) setSelectedChild(childOptions[0].student_id);

      const { data: currentYear } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();
      if (currentYear) {
        const { data: et } = await supabase
          .from("exam_types")
          .select("id, name")
          .eq("academic_year_id", currentYear.id)
          .order("sort_order", { ascending: true });
        setExamTypes((et ?? []) as ExamType[]);
      }

      setLoading(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedChild) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotes([]);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoadingNotes(true);
      const res = await fetch(
        `/api/ptm-notes?student_id=${encodeURIComponent(selectedChild)}`
      );
      if (cancelled) return;
      if (!res.ok) {
        setNotes([]);
        setLoadingNotes(false);
        return;
      }
      const body = (await res.json()) as { data: PtmNote[] };
      if (!cancelled) {
        setNotes(body.data ?? []);
        setLoadingNotes(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedChild]);

  const examNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of examTypes) m.set(e.id, e.name);
    return m;
  }, [examTypes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900" />
      </div>
    );
  }

  const activeChild = children.find((c) => c.student_id === selectedChild);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          PTM Notes
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Records of parent-teacher meetings, class-teacher remarks, and
          action points for your child.
        </p>
      </div>

      {children.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No linked child found for your account. Please contact the
              school office to link your parent profile to your child.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4 text-navy-900 dark:text-gold-500" />
                Select child
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedChild}
                onValueChange={(v) => setSelectedChild(v ?? "")}
                items={children.map((c) => ({
                  value: c.student_id,
                  label:
                    c.full_name +
                    (c.class_name
                      ? ` · ${c.class_name}${c.section ? ` - ${c.section}` : ""}`
                      : ""),
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {children.map((c) => {
                    const childLabel =
                      c.full_name +
                      (c.class_name
                        ? ` · ${c.class_name}${c.section ? ` - ${c.section}` : ""}`
                        : "");
                    return (
                      <SelectItem
                        key={c.student_id}
                        value={c.student_id}
                        label={childLabel}
                      >
                        {childLabel}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {activeChild ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-navy-900 dark:text-gold-500" />
                  {activeChild.full_name}&apos;s meetings
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingNotes ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-navy-900" />
                  </div>
                ) : notes.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4">
                    No meetings recorded yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {notes.map((n) => (
                      <div
                        key={n.id}
                        className="rounded-lg border border-gray-200 dark:border-gray-800 p-4"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-navy-900 dark:text-white">
                              {fmtDate(n.meeting_date)}
                            </span>
                            {n.attendance === "present" ? (
                              <Badge
                                variant="outline"
                                className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Present
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                              >
                                <XCircle className="h-3 w-3 mr-1" />
                                Absent
                              </Badge>
                            )}
                          </div>
                          {n.exam_type_id &&
                          examNameById.has(n.exam_type_id) ? (
                            <Badge variant="outline">
                              {examNameById.get(n.exam_type_id)}
                            </Badge>
                          ) : null}
                        </div>

                        {n.teacher_remarks ? (
                          <div className="mb-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              Teacher remarks
                            </span>
                            <p className="text-sm text-navy-900 dark:text-white mt-1 whitespace-pre-line">
                              {n.teacher_remarks}
                            </p>
                          </div>
                        ) : null}

                        {n.parent_remarks ? (
                          <div className="mb-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              Parent remarks
                            </span>
                            <p className="text-sm text-navy-900 dark:text-white mt-1 whitespace-pre-line">
                              {n.parent_remarks}
                            </p>
                          </div>
                        ) : null}

                        {n.action_points ? (
                          <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              Action points
                            </span>
                            <p className="text-sm text-navy-900 dark:text-white mt-1 whitespace-pre-line">
                              {n.action_points}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
