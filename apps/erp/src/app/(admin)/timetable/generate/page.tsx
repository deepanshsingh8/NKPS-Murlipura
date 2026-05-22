"use client";

/**
 * §2 Auto-Generate Timetable.
 * Pick a template + classes + days, then generate. Shows preview of conflicts
 * that the generator could not place (missing subjects, teacher clashes, etc.)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Loader2, Wand2, ArrowLeft, AlertTriangle } from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { formatClassName } from "@nkps/shared/lib/utils";
import type { Class } from "@nkps/shared/types";
import { toast } from "sonner";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

interface TemplateLite {
  id: string;
  name: string;
  code: string | null;
  teaching_period_count: number;
}

interface Conflict {
  class_id: string;
  day: number;
  period: number;
  reason: string;
}

export default function GenerateTimetablePage() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);

  const [templateId, setTemplateId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6]));
  const [replace, setReplace] = useState(false);
  const [allowSubjectRepeat, setAllowSubjectRepeat] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<
    | { generated: number; skipped: number; conflicts: Conflict[] }
    | null
  >(null);

  useEffect(() => {
    (async () => {
      const [tplRes, yearRes] = await Promise.all([
        adminFetch("/api/timetable/templates"),
        supabase.from("academic_years").select("id").eq("is_current", true).maybeSingle(),
      ]);
      if (tplRes.ok) {
        const data = await tplRes.json();
        setTemplates(
          (data.templates ?? []).map((t: { id: string; name: string; code: string | null; teaching_period_count: number }) => t)
        );
      }
      if (yearRes.data?.id) {
        const { data: cl } = await supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .eq("academic_year_id", yearRes.data.id)
          .order("sort_order");
        setClasses((cl as Class[]) ?? []);
      }
      setLoading(false);
    })();
  }, [supabase]);

  const toggleClass = useCallback((id: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleDay = useCallback((d: number) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }, []);

  const classNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classes) m.set(c.id, formatClassName(c));
    return m;
  }, [classes]);

  const handleGenerate = async () => {
    if (!templateId) { toast.error("Pick a template"); return; }
    if (selectedClassIds.size === 0) { toast.error("Pick at least one class"); return; }
    if (selectedDays.size === 0) { toast.error("Pick at least one day"); return; }
    setRunning(true);
    setResult(null);
    const res = await adminFetch("/api/timetable/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: templateId,
        class_ids: [...selectedClassIds],
        days: [...selectedDays].sort(),
        replace,
        allow_subject_repeat: allowSubjectRepeat,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Generation failed");
    } else {
      setResult(data);
      toast.success(`Generated ${data.generated} period(s); ${data.skipped} skipped.`);
    }
    setRunning(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link href="/timetable" className="inline-flex items-center text-xs text-gray-500 hover:text-navy-900 mb-1">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Timetable
        </Link>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
          Auto-Generate Timetable
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Pick a template, pick classes and days, then generate. The generator
          enforces no teacher clash across sections, lunch is fixed, and each
          subject runs at most once per day for a class.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="erp-table-container p-4">
          <Label className="text-xs">Template</Label>
          <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? "")}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Pick a template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} ({t.teaching_period_count}p)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="erp-table-container p-4">
          <Label className="text-xs">Days</Label>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {DAYS.map((d) => (
              <button
                key={d.value}
                onClick={() => toggleDay(d.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                  selectedDays.has(d.value)
                    ? "bg-navy-900 text-white border-navy-900"
                    : "bg-white dark:bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-border"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="erp-table-container p-4 space-y-2">
          <Label className="text-xs">Options</Label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="rounded" />
            Replace existing periods on selected days
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={allowSubjectRepeat} onChange={(e) => setAllowSubjectRepeat(e.target.checked)} className="rounded" />
            Allow same subject more than once per day
          </label>
        </div>
      </div>

      <div className="erp-table-container p-4">
        <Label className="text-xs">Classes</Label>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
          {classes.map((c) => (
            <label
              key={c.id}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs border cursor-pointer ${
                selectedClassIds.has(c.id)
                  ? "bg-blue-50 dark:bg-blue-950/20 border-blue-300"
                  : "border-gray-200 dark:border-border hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedClassIds.has(c.id)}
                onChange={() => toggleClass(c.id)}
                className="rounded"
              />
              {formatClassName(c)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          onClick={handleGenerate}
          disabled={running}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          {running && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          <Wand2 className="h-4 w-4 mr-1.5" />
          Generate
        </Button>
      </div>

      {result && (
        <div className="erp-table-container p-4 space-y-2">
          <h3 className="font-semibold">Result</h3>
          <p className="text-sm">
            <strong className="text-green-700">{result.generated}</strong> periods written ·{" "}
            <strong className={result.skipped > 0 ? "text-amber-700" : "text-gray-500"}>{result.skipped}</strong> skipped
          </p>
          {result.conflicts.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-amber-800 mt-3 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Skipped slots
              </h4>
              <ul className="text-xs space-y-1 mt-1.5">
                {result.conflicts.map((c, i) => (
                  <li key={i} className="rounded bg-amber-50 px-2 py-1.5 text-amber-900">
                    {classNameById.get(c.class_id) ?? c.class_id} · Day {c.day} ·
                    Period {c.period} → {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
