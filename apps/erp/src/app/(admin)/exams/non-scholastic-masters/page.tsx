"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch, adminPatch, adminDelete } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nkps/shared/components/ui/tabs";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

interface Subject {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  sub_subject_count: number;
}

interface SubSubject {
  id: string;
  parent_subject_id: string;
  name: string;
  grade_scale_id: string | null;
  sort_order: number;
  is_active: boolean;
  // Per-class scoping (M16). Empty array = available to every class.
  // Populated array = restricted to those class ids.
  class_ids: string[];
}

interface ClassOption {
  id: string;
  label: string;
  sort_order: number;
}

interface GradeScaleOption {
  id: string;
  name: string;
  is_default: boolean;
}

export default function NonScholasticMastersPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subSubjects, setSubSubjects] = useState<SubSubject[]>([]);
  const [scaleOptions, setScaleOptions] = useState<GradeScaleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"subjects" | "sub_subjects">(
    "subjects"
  );

  // Subject dialog state
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subjectForm, setSubjectForm] = useState({
    name: "",
    sort_order: 0,
    is_active: true,
  });
  const [deleteSubjectTarget, setDeleteSubjectTarget] = useState<Subject | null>(
    null
  );

  // Sub-subject dialog state
  const [subSubjectDialogOpen, setSubSubjectDialogOpen] = useState(false);
  const [editingSubSubject, setEditingSubSubject] = useState<SubSubject | null>(
    null
  );
  const [subSubjectForm, setSubSubjectForm] = useState({
    parent_subject_id: "",
    name: "",
    grade_scale_id: "" as string,
    sort_order: 0,
    is_active: true,
    class_ids: [] as string[],
  });
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [deleteSubSubjectTarget, setDeleteSubSubjectTarget] =
    useState<SubSubject | null>(null);

  const fetchSubjects = useCallback(async () => {
    const res = await adminFetch("/api/non-scholastic/subjects");
    if (!res.ok) {
      toast.error("Failed to load subjects");
      return;
    }
    const { data } = (await res.json()) as { data: Subject[] };
    setSubjects(data);
  }, []);

  const fetchSubSubjects = useCallback(async () => {
    const res = await adminFetch("/api/non-scholastic/sub-subjects");
    if (!res.ok) {
      toast.error("Failed to load sub-subjects");
      return;
    }
    const { data } = (await res.json()) as { data: SubSubject[] };
    setSubSubjects(data);
  }, []);

  const fetchScaleOptions = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("grade_scales")
      .select("id, name, is_default")
      .eq("scope", "non_scholastic")
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });
    setScaleOptions(data ?? []);
  }, []);

  // Class list for the per-sub-subject scoping multi-select. Pulled
  // straight from `classes` (current academic year only) so the picker
  // can't accidentally bind to last-year's class rows.
  const fetchClassOptions = useCallback(async () => {
    const supabase = createClient();
    const { data: currentYear } = await supabase
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (!currentYear?.id) {
      setClassOptions([]);
      return;
    }
    const { data } = await supabase
      .from("classes")
      .select("id, name, section, sort_order")
      .eq("academic_year_id", currentYear.id)
      .order("sort_order", { ascending: true });
    const opts: ClassOption[] = (data ?? []).map((c) => ({
      id: c.id as string,
      label: `${c.name}${c.section ? ` — ${c.section}` : ""}`,
      sort_order: (c.sort_order as number) ?? 0,
    }));
    setClassOptions(opts);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([
      fetchSubjects(),
      fetchSubSubjects(),
      fetchScaleOptions(),
      fetchClassOptions(),
    ]).finally(() => setLoading(false));
  }, [fetchSubjects, fetchSubSubjects, fetchScaleOptions, fetchClassOptions]);

  const defaultScale = scaleOptions.find((s) => s.is_default);

  // ---------- Subject handlers ----------

  const openCreateSubject = () => {
    setEditingSubject(null);
    setSubjectForm({
      name: "",
      sort_order: subjects.length,
      is_active: true,
    });
    setSubjectDialogOpen(true);
  };

  const openEditSubject = (s: Subject) => {
    setEditingSubject(s);
    setSubjectForm({
      name: s.name,
      sort_order: s.sort_order,
      is_active: s.is_active,
    });
    setSubjectDialogOpen(true);
  };

  const saveSubject = async () => {
    if (!subjectForm.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    const payload = {
      name: subjectForm.name.trim(),
      sort_order: Number(subjectForm.sort_order),
      is_active: subjectForm.is_active,
    };
    const res = editingSubject
      ? await adminPatch(
          `/api/non-scholastic/subjects/${editingSubject.id}`,
          payload
        )
      : await adminFetch("/api/non-scholastic/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Failed to save subject");
      return;
    }
    toast.success(editingSubject ? "Subject updated" : "Subject created");
    setSubjectDialogOpen(false);
    await fetchSubjects();
  };

  const confirmDeleteSubject = async () => {
    if (!deleteSubjectTarget) return;
    const res = await adminDelete(
      `/api/non-scholastic/subjects/${deleteSubjectTarget.id}`,
      {}
    );
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete subject");
      return;
    }
    toast.success("Subject deleted");
    setDeleteSubjectTarget(null);
    await Promise.all([fetchSubjects(), fetchSubSubjects()]);
  };

  // ---------- Sub-subject handlers ----------

  const openCreateSubSubject = (preselectedParent?: string) => {
    setEditingSubSubject(null);
    setSubSubjectForm({
      parent_subject_id: preselectedParent ?? subjects[0]?.id ?? "",
      name: "",
      grade_scale_id: "",
      sort_order: 0,
      is_active: true,
      class_ids: [],
    });
    setSubSubjectDialogOpen(true);
  };

  const openEditSubSubject = (ss: SubSubject) => {
    setEditingSubSubject(ss);
    setSubSubjectForm({
      parent_subject_id: ss.parent_subject_id,
      name: ss.name,
      grade_scale_id: ss.grade_scale_id ?? "",
      sort_order: ss.sort_order,
      is_active: ss.is_active,
      class_ids: ss.class_ids ?? [],
    });
    setSubSubjectDialogOpen(true);
  };

  const saveSubSubject = async () => {
    if (!subSubjectForm.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (!subSubjectForm.parent_subject_id) {
      toast.error("Pick a parent subject.");
      return;
    }
    const payload = {
      parent_subject_id: subSubjectForm.parent_subject_id,
      name: subSubjectForm.name.trim(),
      grade_scale_id: subSubjectForm.grade_scale_id || null,
      sort_order: Number(subSubjectForm.sort_order),
      is_active: subSubjectForm.is_active,
      class_ids: subSubjectForm.class_ids,
    };
    const res = editingSubSubject
      ? await adminPatch(
          `/api/non-scholastic/sub-subjects/${editingSubSubject.id}`,
          payload
        )
      : await adminFetch("/api/non-scholastic/sub-subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Failed to save sub-subject");
      return;
    }
    toast.success(
      editingSubSubject ? "Sub-subject updated" : "Sub-subject created"
    );
    setSubSubjectDialogOpen(false);
    await Promise.all([fetchSubSubjects(), fetchSubjects()]);
  };

  const confirmDeleteSubSubject = async () => {
    if (!deleteSubSubjectTarget) return;
    const res = await adminDelete(
      `/api/non-scholastic/sub-subjects/${deleteSubSubjectTarget.id}`,
      {}
    );
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete sub-subject");
      return;
    }
    toast.success("Sub-subject deleted");
    setDeleteSubSubjectTarget(null);
    await Promise.all([fetchSubSubjects(), fetchSubjects()]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const scaleNameById = new Map(scaleOptions.map((s) => [s.id, s.name]));
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Non-Scholastic Masters
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Co-scholastic areas and sub-skills that teachers grade alongside
          academic subjects. Subjects group related sub-skills (e.g. Discipline
          → Punctuality, Behaviour).
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        <TabsList>
          <TabsTrigger value="subjects">
            Subjects ({subjects.length})
          </TabsTrigger>
          <TabsTrigger value="sub_subjects">
            Sub-Subjects ({subSubjects.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="subjects" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={openCreateSubject}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Subject
            </Button>
          </div>

          {subjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No non-scholastic subjects yet. Create the first one to start
                organizing sub-skills.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {subjects.map((s) => (
                <Card
                  key={s.id}
                  className="bg-white dark:bg-card rounded-2xl"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base font-heading flex items-center gap-2">
                        {s.name}
                        {!s.is_active && (
                          <Badge variant="outline" className="text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </CardTitle>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {s.sub_subject_count} sub-subject
                      {s.sub_subject_count === 1 ? "" : "s"}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditSubject(s)}
                      className="flex-1"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setActiveTab("sub_subjects");
                        openCreateSubSubject(s.id);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Sub
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteSubjectTarget(s)}
                      className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sub_subjects" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={() => openCreateSubSubject()}
              disabled={subjects.length === 0}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Sub-Subject
            </Button>
          </div>

          {subjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Create a subject first before adding sub-subjects.
              </p>
            </div>
          ) : subSubjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No sub-subjects yet. Click &quot;New Sub-Subject&quot; to add the
                first.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {subjects.map((parent) => {
                const children = subSubjects.filter(
                  (ss) => ss.parent_subject_id === parent.id
                );
                if (children.length === 0) return null;
                return (
                  <div
                    key={parent.id}
                    className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-card p-3"
                  >
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                      <h3 className="text-sm font-heading font-semibold text-navy-900 dark:text-white">
                        {parent.name}
                      </h3>
                      <span className="text-xs text-gray-400">
                        · {children.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {children.map((ss) => (
                        <div
                          key={ss.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {ss.name}
                              </span>
                              {!ss.is_active && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-500 truncate">
                              Scale:{" "}
                              {ss.grade_scale_id
                                ? scaleNameById.get(ss.grade_scale_id) ??
                                  "(missing)"
                                : defaultScale?.name ?? "no default set"}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditSubSubject(ss)}
                              aria-label="Edit sub-subject"
                              className="h-7 w-7 text-blue-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteSubSubjectTarget(ss)}
                              aria-label="Delete sub-subject"
                              className="h-7 w-7 text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {subjects.every(
                (p) =>
                  subSubjects.filter((ss) => ss.parent_subject_id === p.id)
                    .length === 0
              ) && (
                <div className="text-center text-sm text-gray-500 py-6">
                  No sub-subjects yet under any subject.
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Subject dialog */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSubject ? "Edit Subject" : "New Subject"}
            </DialogTitle>
            <DialogDescription>
              Non-scholastic subject (e.g. Discipline, Art Education).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={subjectForm.name}
                onChange={(e) =>
                  setSubjectForm({ ...subjectForm, name: e.target.value })
                }
                placeholder="e.g. Discipline"
              />
            </div>
            <div className="space-y-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={subjectForm.sort_order}
                onChange={(e) =>
                  setSubjectForm({
                    ...subjectForm,
                    sort_order: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={subjectForm.is_active}
                onCheckedChange={(v) =>
                  setSubjectForm({ ...subjectForm, is_active: Boolean(v) })
                }
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSubjectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={saveSubject}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {editingSubject ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-subject dialog */}
      <Dialog
        open={subSubjectDialogOpen}
        onOpenChange={setSubSubjectDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSubSubject ? "Edit Sub-Subject" : "New Sub-Subject"}
            </DialogTitle>
            <DialogDescription>
              A specific skill under a subject (e.g. Discipline → Punctuality).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Parent subject</Label>
              <Select
                value={subSubjectForm.parent_subject_id}
                items={subjects.map((s) => ({ value: s.id, label: s.name }))}
                onValueChange={(v) =>
                  v &&
                  setSubSubjectForm({
                    ...subSubjectForm,
                    parent_subject_id: v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick parent..." />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={subSubjectForm.name}
                onChange={(e) =>
                  setSubSubjectForm({ ...subSubjectForm, name: e.target.value })
                }
                placeholder="e.g. Punctuality"
              />
            </div>
            <div className="space-y-1">
              <Label>Grade scale (optional)</Label>
              <Select
                value={subSubjectForm.grade_scale_id || "__default__"}
                items={[
                  {
                    value: "__default__",
                    label: `Use default (${defaultScale?.name ?? "none set"})`,
                  },
                  ...scaleOptions.map((s) => ({ value: s.id, label: s.name })),
                ]}
                onValueChange={(v) => {
                  if (!v) return;
                  setSubSubjectForm({
                    ...subSubjectForm,
                    grade_scale_id: v === "__default__" ? "" : v,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Use default scale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="__default__"
                    label={`Use default (${defaultScale?.name ?? "none set"})`}
                  >
                    Use default ({defaultScale?.name ?? "none set"})
                  </SelectItem>
                  {scaleOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-500">
                Leave as default unless this sub-subject needs its own rubric
                (e.g. a 2-point pass/fail for Attendance).
              </p>
            </div>
            <div className="space-y-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={subSubjectForm.sort_order}
                onChange={(e) =>
                  setSubSubjectForm({
                    ...subSubjectForm,
                    sort_order: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={subSubjectForm.is_active}
                onCheckedChange={(v) =>
                  setSubSubjectForm({
                    ...subSubjectForm,
                    is_active: Boolean(v),
                  })
                }
              />
              Active
            </label>

            {/* Per-class scoping. Empty selection = available to every class.
                A non-empty selection restricts the sub-subject to those classes. */}
            <div className="space-y-1">
              <Label>Restrict to classes (optional)</Label>
              <p className="text-[10px] text-gray-500">
                Leave empty to make this sub-subject available for every class.
                Tick specific classes to limit it (e.g. &quot;Robotics&quot; only
                for senior classes).
              </p>
              <div className="max-h-44 overflow-y-auto rounded-md border border-gray-200 dark:border-border p-2 grid grid-cols-2 gap-1">
                {classOptions.length === 0 ? (
                  <p className="text-xs text-gray-400 col-span-2">
                    No classes in the current academic year.
                  </p>
                ) : (
                  classOptions.map((c) => {
                    const checked = subSubjectForm.class_ids.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-muted/40 rounded px-1 py-0.5"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const on = Boolean(v);
                            setSubSubjectForm((prev) => ({
                              ...prev,
                              class_ids: on
                                ? Array.from(
                                    new Set([...prev.class_ids, c.id])
                                  )
                                : prev.class_ids.filter((id) => id !== c.id),
                            }));
                          }}
                        />
                        {c.label}
                      </label>
                    );
                  })
                )}
              </div>
              {subSubjectForm.class_ids.length > 0 ? (
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  Restricted to {subSubjectForm.class_ids.length} class
                  {subSubjectForm.class_ids.length === 1 ? "" : "es"}.
                </p>
              ) : (
                <p className="text-[10px] text-gray-500">
                  Currently global (all classes).
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSubSubjectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={saveSubSubject}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {editingSubSubject ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmations */}
      {deleteSubjectTarget && (
        <Dialog
          open={true}
          onOpenChange={(o) => !o && setDeleteSubjectTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete &quot;{deleteSubjectTarget.name}&quot;?
              </DialogTitle>
              <DialogDescription>
                {deleteSubjectTarget.sub_subject_count > 0
                  ? `This will also delete ${deleteSubjectTarget.sub_subject_count} sub-subject${deleteSubjectTarget.sub_subject_count === 1 ? "" : "s"} under it.`
                  : "This subject has no sub-subjects."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteSubjectTarget(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteSubject}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteSubSubjectTarget && (
        <Dialog
          open={true}
          onOpenChange={(o) => !o && setDeleteSubSubjectTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete &quot;{deleteSubSubjectTarget.name}&quot;?
              </DialogTitle>
              <DialogDescription>
                Removes this sub-subject from{" "}
                {subjectNameById.get(deleteSubSubjectTarget.parent_subject_id) ??
                  "its parent"}
                .
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteSubSubjectTarget(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteSubSubject}
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
