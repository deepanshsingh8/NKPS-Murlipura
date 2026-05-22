"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Download, Loader2, IdCard, CalendarClock, Users } from "lucide-react";
import { toast } from "sonner";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_id: string | null;
  class_label: string;
}

interface ExamRow {
  id: string;
  name: string;
  upper_header: string | null;
  schedule_count: number;
  earliest_date: string | null;
  latest_date: string | null;
}

async function downloadFromResponse(res: Response, fallbackName: string) {
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ParentAdmitCardsPage() {
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExams, setLoadingExams] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [defaultTemplateExists, setDefaultTemplateExists] = useState(false);

  const fetchChildren = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("parent_id")
      .eq("id", user.id)
      .maybeSingle();
    const parentId = profile?.parent_id as string | undefined;
    if (!parentId) return;

    const { data: studentParents } = await supabase
      .from("student_parents")
      .select("student_id, students(id, full_name)")
      .eq("parent_id", parentId);

    if (!studentParents || studentParents.length === 0) return;

    const options: ChildOption[] = [];
    for (const sp of studentParents) {
      const student = sp.students as unknown as {
        id: string;
        full_name: string;
      } | null;
      if (!student) continue;
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("class_id, classes(name, section)")
        .eq("student_id", student.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      const cls = enrollment?.classes as unknown as {
        name: string;
        section: string;
      } | null;
      options.push({
        student_id: student.id,
        full_name: student.full_name,
        class_id: (enrollment?.class_id as string | undefined) ?? null,
        class_label: cls ? `${cls.name} — ${cls.section}` : "—",
      });
    }
    setChildren(options);
    if (options.length > 0 && !selectedChild) {
      setSelectedChild(options[0].student_id);
    }

    const { data: tmpl } = await supabase
      .from("admit_card_templates")
      .select("id")
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    setDefaultTemplateExists(Boolean(tmpl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchChildren().finally(() => setLoading(false));
  }, [fetchChildren]);

  const child = children.find((c) => c.student_id === selectedChild) ?? null;

  const fetchExams = useCallback(async () => {
    if (!child?.class_id) {
      setExams([]);
      return;
    }
    setLoadingExams(true);
    try {
      const supabase = createClient();
      const { data: scheduleRows } = await supabase
        .from("exam_schedules")
        .select("exam_type_id, exam_date, exam_types(id, name, upper_header)")
        .eq("class_id", child.class_id);

      const byExam = new Map<
        string,
        {
          id: string;
          name: string;
          upper_header: string | null;
          dates: string[];
        }
      >();
      for (const r of scheduleRows ?? []) {
        const et = r.exam_types as unknown as {
          id: string;
          name: string;
          upper_header: string | null;
        } | null;
        if (!et) continue;
        const bucket = byExam.get(et.id) ?? {
          id: et.id,
          name: et.name,
          upper_header: et.upper_header,
          dates: [],
        };
        bucket.dates.push(r.exam_date as string);
        byExam.set(et.id, bucket);
      }

      const rows: ExamRow[] = Array.from(byExam.values()).map((b) => {
        const sorted = [...b.dates].sort();
        return {
          id: b.id,
          name: b.name,
          upper_header: b.upper_header,
          schedule_count: b.dates.length,
          earliest_date: sorted[0] ?? null,
          latest_date: sorted[sorted.length - 1] ?? null,
        };
      });
      rows.sort((a, b) =>
        (a.earliest_date ?? "").localeCompare(b.earliest_date ?? "")
      );
      setExams(rows);
    } finally {
      setLoadingExams(false);
    }
  }, [child?.class_id]);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  const download = async (examTypeId: string, examName: string) => {
    if (!selectedChild) return;
    setDownloading(examTypeId);
    try {
      const res = await fetch(
        `/api/admit-cards/pdf?student_id=${selectedChild}&exam_type_id=${examTypeId}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to download admit card");
        return;
      }
      await downloadFromResponse(
        res,
        `admit-card-${examName.replace(/\W+/g, "_")}.pdf`
      );
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Admit Cards
        </h1>
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="py-12 text-center text-gray-400 dark:text-gray-500">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No children linked to this account yet.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Admit Cards
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {child ? `${child.full_name} | ${child.class_label}` : ""}
          </p>
        </div>
        {children.length > 1 && (
          <div className="w-64">
            <Select
              value={selectedChild}
              items={children.map((c) => ({
                value: c.student_id,
                label: c.full_name,
              }))}
              onValueChange={(v) => v && setSelectedChild(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick child" />
              </SelectTrigger>
              <SelectContent>
                {children.map((c) => (
                  <SelectItem
                    key={c.student_id}
                    value={c.student_id}
                    label={c.full_name}
                  >
                    {c.full_name} · {c.class_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!defaultTemplateExists ? (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="py-12 text-center text-gray-400 dark:text-gray-500">
            <IdCard className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No admit card template is active yet.</p>
            <p className="text-xs text-gray-300 dark:text-gray-500 mt-1">
              Please check back closer to your child&apos;s exam dates.
            </p>
          </CardContent>
        </Card>
      ) : loadingExams ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : exams.length === 0 ? (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="py-12 text-center text-gray-400 dark:text-gray-500">
            <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No upcoming exams with a schedule.</p>
            <p className="text-xs text-gray-300 dark:text-gray-500 mt-1">
              Admit cards appear here once the school publishes the schedule.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {exams.map((e) => (
            <Card key={e.id} className="bg-white dark:bg-card rounded-2xl">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {e.upper_header && (
                      <Badge
                        variant="outline"
                        className="mb-2 text-[10px] tracking-wide"
                      >
                        {e.upper_header}
                      </Badge>
                    )}
                    <h3 className="font-heading text-base font-semibold text-navy-900 dark:text-white truncate">
                      {e.name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {e.schedule_count} paper
                      {e.schedule_count === 1 ? "" : "s"} ·{" "}
                      {e.earliest_date === e.latest_date
                        ? fmtDate(e.earliest_date)
                        : `${fmtDate(e.earliest_date)} – ${fmtDate(e.latest_date)}`}
                    </p>
                  </div>
                  <IdCard className="h-5 w-5 text-gray-300 dark:text-gray-600 shrink-0" />
                </div>
                <Button
                  onClick={() => download(e.id, e.name)}
                  disabled={downloading === e.id}
                  className="w-full bg-navy-900 text-white hover:bg-navy-900/90"
                  size="sm"
                >
                  {downloading === e.id ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {downloading === e.id ? "Preparing…" : "Download Admit Card"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
