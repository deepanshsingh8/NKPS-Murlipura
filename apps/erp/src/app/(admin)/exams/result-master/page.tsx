"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { adminFetch, adminDelete } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Label } from "@nkps/shared/components/ui/label";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nkps/shared/components/ui/tabs";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatClassName } from "@nkps/shared/lib/utils";
import { BasicRulesTab } from "@/components/result-master/BasicRulesTab";
import { SubjectsTab } from "@/components/result-master/SubjectsTab";
import { AdvancedTab } from "@/components/result-master/AdvancedTab";
import { PreviewTab } from "@/components/result-master/PreviewTab";
import type { ExamConfigWithType } from "@/components/result-master/helpers";
import type { GradeScale } from "@/lib/grading";
import type {
  AcademicYear,
  Class,
  ResultMaster,
  ResultMasterSubject,
} from "@nkps/shared/types";

interface ClassOption extends Class {
  streams?: { name: string | null } | { name: string | null }[] | null;
}

interface LoadedBundle {
  master: ResultMaster | null;
  subjects: ResultMasterSubject[];
  exam_configs: ExamConfigWithType[];
  grade_scales: GradeScale[];
}

type TabKey = "basic" | "subjects" | "advanced" | "preview";

export default function AdminResultMasterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <AdminResultMasterContent />
    </Suspense>
  );
}

function AdminResultMasterContent() {
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [urlClassId, setUrlClassId] = useUrlState("class_id");
  const [urlYearId, setUrlYearId] = useUrlState("academic_year_id");

  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [topBarLoaded, setTopBarLoaded] = useState(false);

  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>("basic");

  // --- Load classes + academic years once ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [classesRes, yearsRes] = await Promise.all([
        supabase
          .from("classes")
          .select("*, streams:stream_id(name)")
          .order("sort_order", { ascending: true }),
        supabase
          .from("academic_years")
          .select("*")
          .order("start_date", { ascending: false }),
      ]);
      if (cancelled) return;
      setClasses((classesRes.data as ClassOption[] | null) ?? []);
      setYears((yearsRes.data as AcademicYear[] | null) ?? []);
      setTopBarLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Default year → is_current once years are loaded and URL has no year.
  useEffect(() => {
    if (!topBarLoaded || urlYearId) return;
    const current = years.find((y) => y.is_current);
    if (!current) return;
    setUrlYearId(current.id);
  }, [topBarLoaded, urlYearId, years, setUrlYearId]);

  // --- Load the master bundle whenever both params are present ---
  const loadBundle = useCallback(async () => {
    if (!urlClassId || !urlYearId) {
      setBundle(null);
      return;
    }
    setBundleLoading(true);
    try {
      // Main bundle + grade scales (scholastic only) fetched in parallel.
      const [masterRes, gradeScalesRes] = await Promise.all([
        adminFetch(
          `/api/result-masters?class_id=${urlClassId}&academic_year_id=${urlYearId}`
        ),
        adminFetch("/api/grade-scales"),
      ]);
      if (!masterRes.ok) {
        const body = await masterRes.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to load result master");
        setBundle({
          master: null,
          subjects: [],
          exam_configs: [],
          grade_scales: [],
        });
        return;
      }
      const masterBody = (await masterRes.json()) as {
        master: ResultMaster | null;
        subjects: ResultMasterSubject[];
        exam_configs: ExamConfigWithType[];
      };
      let gradeScales: GradeScale[] = [];
      if (gradeScalesRes.ok) {
        const gsBody = (await gradeScalesRes.json()) as { data: GradeScale[] };
        gradeScales = (gsBody.data ?? []).filter(
          (s) => s.scope === "scholastic"
        );
      }
      setBundle({
        master: masterBody.master,
        subjects: masterBody.subjects ?? [],
        exam_configs: masterBody.exam_configs ?? [],
        grade_scales: gradeScales,
      });
    } finally {
      setBundleLoading(false);
    }
  }, [urlClassId, urlYearId]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  const setSelector = (key: "class_id" | "academic_year_id", value: string) => {
    if (key === "class_id") setUrlClassId(value);
    else setUrlYearId(value);
  };

  const handleCreateMaster = async () => {
    if (!urlClassId || !urlYearId) return;
    setCreating(true);
    try {
      const res = await adminFetch("/api/result-masters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: urlClassId,
          academic_year_id: urlYearId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to create result master");
        return;
      }
      toast.success("Result master created");
      await loadBundle();
      setActiveTab("basic");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!bundle?.master) return;
    const res = await adminDelete(
      `/api/result-masters/${bundle.master.id}`,
      {}
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to delete result master");
      return;
    }
    toast.success("Result master deleted");
    setDeleteOpen(false);
    await loadBundle();
  };

  // --- Derived labels ---
  const selectedClass = classes.find((c) => c.id === urlClassId) ?? null;
  const selectedYear = years.find((y) => y.id === urlYearId) ?? null;
  const selectedClassLabel = selectedClass ? formatClassName(selectedClass) : "";
  const yearLabel = selectedYear?.name ?? "";

  if (!topBarLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Result Master
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Configure the rules that drive the Report Card PDF for each class
            and academic year.
          </p>
        </div>
        {bundle?.master && (
          <Button
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Master
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Class</Label>
          <Select
            value={urlClassId || undefined}
            items={classes.map((c) => ({
              value: c.id,
              label: formatClassName(c),
            }))}
            onValueChange={(v) => v && setSelector("class_id", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a class...">
                {selectedClass ? formatClassName(selectedClass) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {classes.map((c) => (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  label={formatClassName(c)}
                >
                  {formatClassName(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Academic Year</Label>
          <Select
            value={urlYearId || undefined}
            items={years.map((y) => ({ value: y.id, label: y.name }))}
            onValueChange={(v) => v && setSelector("academic_year_id", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a year...">
                {selectedYear ? selectedYear.name : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id} label={y.name}>
                  {y.name}
                  {y.is_current ? " · current" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Body */}
      {!urlClassId || !urlYearId ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Select a class and academic year to configure result master.
          </p>
        </div>
      ) : bundleLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : !bundle?.master ? (
        <Card className="bg-white dark:bg-card rounded-2xl">
          <CardContent className="py-10 text-center space-y-4">
            <div>
              <h3 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
                No result master configured
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {selectedClassLabel
                  ? `for ${selectedClassLabel}`
                  : "for this class"}{" "}
                – {yearLabel}. The report card will fall back to the legacy
                layout until you create one.
              </p>
            </div>
            <Button
              onClick={handleCreateMaster}
              disabled={creating}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Result Master
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
        >
          <TabsList>
            <TabsTrigger value="basic">Basic Rules</TabsTrigger>
            <TabsTrigger value="subjects">Subjects</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="mt-4">
            <BasicRulesTab master={bundle.master} onSaved={loadBundle} />
          </TabsContent>

          <TabsContent value="subjects" className="mt-4">
            <SubjectsTab
              master={bundle.master}
              rows={bundle.subjects}
              classId={urlClassId}
              onSaved={loadBundle}
            />
          </TabsContent>

          <TabsContent value="advanced" className="mt-4">
            <AdvancedTab
              master={bundle.master}
              exam_configs={bundle.exam_configs}
              grade_scales={bundle.grade_scales}
              onSaved={loadBundle}
            />
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <PreviewTab
              resultMaster={bundle.master}
              subjects={bundle.subjects}
              classId={urlClassId}
              academicYearId={urlYearId}
              classLabel={selectedClassLabel}
              yearLabel={yearLabel}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* Delete confirmation */}
      {deleteOpen && bundle?.master && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete result master?
              </DialogTitle>
              <DialogDescription>
                This will delete the result master for {selectedClassLabel} (
                {yearLabel}) and unlink all configured subjects. Report cards
                for this class will fall back to the legacy layout.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

