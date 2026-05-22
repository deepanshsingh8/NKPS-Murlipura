"use client";

import { useCallback, useEffect, useState } from "react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nkps/shared/components/ui/tabs";
import { AdmitCardGenerateTab } from "@/components/AdmitCardGenerateTab";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Star,
  AlertTriangle,
  X,
  IdCard,
} from "lucide-react";
import { toast } from "sonner";

type Orientation = "portrait" | "landscape";

interface Template {
  id: string;
  name: string;
  is_default: boolean;
  orientation: Orientation;
  background_image_url: string | null;
  show_photo: boolean;
  show_admission_no: boolean;
  show_roll_no: boolean;
  show_class_section: boolean;
  show_father_name: boolean;
  show_mother_name: boolean;
  show_dob: boolean;
  show_phone: boolean;
  show_address: boolean;
  show_schedule: boolean;
  show_instructions: boolean;
  instructions_text: string | null;
  signature_labels: string[];
  is_active: boolean;
}

const newTemplate = (): Template => ({
  id: "",
  name: "",
  is_default: false,
  orientation: "portrait",
  background_image_url: null,
  show_photo: true,
  show_admission_no: true,
  show_roll_no: true,
  show_class_section: true,
  show_father_name: true,
  show_mother_name: false,
  show_dob: true,
  show_phone: false,
  show_address: false,
  show_schedule: true,
  show_instructions: true,
  instructions_text:
    "1. Bring this admit card to every exam.\n2. Report 15 minutes before start time.\n3. Electronic devices are strictly prohibited.",
  signature_labels: ["Principal", "Exam Controller"],
  is_active: true,
});

// Fields the admin can toggle on/off on the admit card. Kept centralized so
// the edit dialog and card preview can render the same list.
const FIELD_TOGGLES: {
  key: keyof Template;
  label: string;
  description: string;
}[] = [
  { key: "show_photo", label: "Student photo", description: "Slot for the student's uploaded photo" },
  { key: "show_admission_no", label: "Admission number", description: "" },
  { key: "show_roll_no", label: "Roll number", description: "Class-level roll number" },
  { key: "show_class_section", label: "Class & Section", description: "" },
  { key: "show_father_name", label: "Father's name", description: "" },
  { key: "show_mother_name", label: "Mother's name", description: "" },
  { key: "show_dob", label: "Date of birth", description: "" },
  { key: "show_phone", label: "Phone", description: "" },
  { key: "show_address", label: "Address", description: "" },
  { key: "show_schedule", label: "Exam schedule table", description: "Per-subject date, time, room" },
  { key: "show_instructions", label: "Instructions block", description: "Rendered above signatures" },
];

export default function AdmitCardsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [promoteCandidate, setPromoteCandidate] = useState<string>("");

  const fetchTemplates = useCallback(async () => {
    const res = await adminFetch("/api/admit-card-templates");
    if (!res.ok) {
      toast.error("Failed to load admit card templates");
      return;
    }
    const { data } = (await res.json()) as { data: Template[] };
    setTemplates(data);
  }, []);

  useEffect(() => {
    fetchTemplates().finally(() => setLoading(false));
  }, [fetchTemplates]);

  const openCreate = () => {
    setEditing(newTemplate());
    setIsCreating(true);
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing({ ...t, signature_labels: [...t.signature_labels] });
    setIsCreating(false);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("Name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: editing.name.trim(),
        is_default: editing.is_default,
        orientation: editing.orientation,
        background_image_url: editing.background_image_url?.trim() || null,
        show_photo: editing.show_photo,
        show_admission_no: editing.show_admission_no,
        show_roll_no: editing.show_roll_no,
        show_class_section: editing.show_class_section,
        show_father_name: editing.show_father_name,
        show_mother_name: editing.show_mother_name,
        show_dob: editing.show_dob,
        show_phone: editing.show_phone,
        show_address: editing.show_address,
        show_schedule: editing.show_schedule,
        show_instructions: editing.show_instructions,
        instructions_text:
          editing.instructions_text?.trim() || null,
        signature_labels: editing.signature_labels
          .map((s) => s.trim())
          .filter(Boolean),
        is_active: editing.is_active,
      };
      const res = isCreating
        ? await adminFetch("/api/admit-card-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await adminPatch(
            `/api/admit-card-templates/${editing.id}`,
            payload
          );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save template");
        return;
      }
      toast.success(isCreating ? "Template created" : "Template updated");
      setDialogOpen(false);
      setEditing(null);
      await fetchTemplates();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.is_default) {
        if (!promoteCandidate) {
          toast.error("Pick a template to promote first.");
          return;
        }
        // Promote the chosen one to default, then delete the original.
        const pRes = await adminPatch(
          `/api/admit-card-templates/${promoteCandidate}`,
          { is_default: true }
        );
        if (!pRes.ok) {
          const b = await pRes.json();
          toast.error(b.error ?? "Failed to promote replacement");
          return;
        }
      }
      const res = await adminDelete(
        `/api/admit-card-templates/${deleteTarget.id}`,
        {}
      );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to delete");
        return;
      }
      toast.success("Template deleted");
      setDeleteTarget(null);
      setPromoteCandidate("");
      await fetchTemplates();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const deleteCandidates = deleteTarget
    ? templates.filter((t) => t.id !== deleteTarget.id)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Admit Cards
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Reusable admit card templates + per-student PDF generation. Pick a
          class and exam in the Generate tab to create admit cards.
        </p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">
            Templates ({templates.length})
          </TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={openCreate}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>

          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
              <IdCard className="h-8 w-8 mx-auto mb-3 text-gray-400" />
              <p className="text-sm text-gray-500">
                No admit card templates yet. Click{" "}
                <span className="font-medium">New Template</span> to create
                one.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map((t) => {
                const activeFields = FIELD_TOGGLES.filter(
                  (f) => (t[f.key] as boolean) === true
                );
                return (
                  <Card
                    key={t.id}
                    className="bg-white dark:bg-card rounded-2xl"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base font-heading flex items-center gap-2 flex-wrap">
                          {t.name}
                          {t.is_default && (
                            <Badge className="bg-gold-500/15 text-gold-700 dark:text-gold-400 border-gold-500/30">
                              <Star className="h-3 w-3 mr-1 fill-current" />
                              Default
                            </Badge>
                          )}
                          {!t.is_active && (
                            <Badge variant="outline" className="text-[10px]">
                              Inactive
                            </Badge>
                          )}
                        </CardTitle>
                      </div>
                      <p className="text-xs text-gray-500 capitalize">
                        {t.orientation} · {activeFields.length} fields shown
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {activeFields.slice(0, 6).map((f) => (
                          <Badge
                            key={f.key}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {f.label}
                          </Badge>
                        ))}
                        {activeFields.length > 6 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{activeFields.length - 6} more
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(t)}
                          className="flex-1"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(t)}
                          className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="generate" className="mt-4">
          <AdmitCardGenerateTab
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              is_default: t.is_default,
              is_active: t.is_active,
            }))}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isCreating ? "New Admit Card Template" : "Edit Template"}
              </DialogTitle>
              <DialogDescription>
                Toggle which student fields appear on the admit card and set
                instructions + signature labels.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    placeholder="e.g. Board Exam Admit Card"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Orientation</Label>
                  <Select
                    value={editing.orientation}
                    items={[
                      { value: "portrait", label: "Portrait" },
                      { value: "landscape", label: "Landscape" },
                    ]}
                    onValueChange={(v) =>
                      v &&
                      setEditing({
                        ...editing,
                        orientation: v as Orientation,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Orientation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait" label="Portrait">
                        Portrait
                      </SelectItem>
                      <SelectItem value="landscape" label="Landscape">
                        Landscape
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Background image URL (optional)</Label>
                <Input
                  value={editing.background_image_url ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      background_image_url: e.target.value,
                    })
                  }
                  placeholder="/images/admit-card-bg.png or https://..."
                />
              </div>

              <div>
                <Label className="mb-2 block">Fields to show</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 border rounded-lg p-3">
                  {FIELD_TOGGLES.map((f) => (
                    <label
                      key={f.key}
                      className="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 rounded px-2 py-1.5"
                    >
                      <Checkbox
                        checked={editing[f.key] as boolean}
                        onCheckedChange={(v) =>
                          setEditing({ ...editing, [f.key]: Boolean(v) })
                        }
                        className="mt-0.5"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block">{f.label}</span>
                        {f.description && (
                          <span className="block text-[10px] text-gray-500">
                            {f.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {editing.show_instructions && (
                <div className="space-y-1">
                  <Label>Instructions text</Label>
                  <textarea
                    value={editing.instructions_text ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        instructions_text: e.target.value,
                      })
                    }
                    rows={5}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-900 dark:focus-visible:ring-gold-500"
                    placeholder="One instruction per line"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Signature labels</Label>
                <div className="space-y-1.5">
                  {editing.signature_labels.map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={label}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            signature_labels: editing.signature_labels.map(
                              (l, idx) => (idx === i ? e.target.value : l)
                            ),
                          })
                        }
                        placeholder="e.g. Principal"
                        className="h-9"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            signature_labels: editing.signature_labels.filter(
                              (_, idx) => idx !== i
                            ),
                          })
                        }
                        aria-label="Remove signature label"
                        className="h-9 w-9 text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      signature_labels: [...editing.signature_labels, ""],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add signature slot
                </Button>
              </div>

              <div className="flex flex-wrap gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={editing.is_default}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, is_default: Boolean(v) })
                    }
                    disabled={
                      editing.is_default && !isCreating
                    }
                  />
                  Set as default template
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={editing.is_active}
                    onCheckedChange={(v) =>
                      setEditing({ ...editing, is_active: Boolean(v) })
                    }
                  />
                  Active
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={saving}
                className="bg-navy-900 text-white hover:bg-navy-900/90"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isCreating ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog
          open={true}
          onOpenChange={(o) => {
            if (!o) {
              setDeleteTarget(null);
              setPromoteCandidate("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete &quot;{deleteTarget.name}&quot;?
              </DialogTitle>
              <DialogDescription>
                {deleteTarget.is_default
                  ? "This is the current default. Pick another template to promote first."
                  : "This template will be permanently removed."}
              </DialogDescription>
            </DialogHeader>
            {deleteTarget.is_default && (
              <div className="space-y-2">
                <Label>Promote to default:</Label>
                {deleteCandidates.length === 0 ? (
                  <p className="text-xs text-red-600">
                    No other templates exist. Create one first.
                  </p>
                ) : (
                  <Select
                    value={promoteCandidate}
                    onValueChange={(v) => v && setPromoteCandidate(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {deleteCandidates.map((c) => (
                        <SelectItem key={c.id} value={c.id} label={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteTarget(null);
                  setPromoteCandidate("");
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={
                  saving ||
                  (deleteTarget.is_default && !promoteCandidate)
                }
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {deleteTarget.is_default ? "Promote & Delete" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
