"use client";

/**
 * §2 §3 Timetable Templates Manager.
 * - Lists the four built-in (system) templates A.1/A.2/A.3/A.4 plus any custom ones.
 * - Admin can clone a system template, then edit period times / labels / kinds.
 * - Each template MUST contain at least one lunch slot.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { Loader2, Plus, Copy, Save, Trash2, ArrowLeft, Coffee } from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { toast } from "sonner";

type PeriodKind = "teaching" | "lunch" | "break";

interface TemplatePeriod {
  id?: string;
  position: number;
  kind: PeriodKind;
  label: string | null;
  start_time: string;
  end_time: string;
}

interface Template {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  teaching_period_count: number;
  is_system: boolean;
  is_active: boolean;
  periods: TemplatePeriod[];
}

export default function TimetableTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneFromId, setCloneFromId] = useState("");
  const [cloneName, setCloneName] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = templates.find((t) => t.id === editingId) ?? null;
  const [draftPeriods, setDraftPeriods] = useState<TemplatePeriod[]>([]);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch("/api/timetable/templates");
    if (!res.ok) {
      toast.error("Failed to load templates");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setTemplates(data.templates ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftPeriods(t.periods.map((p) => ({ ...p })));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftPeriods([]);
    setDraftName("");
  };

  const updatePeriod = (idx: number, patch: Partial<TemplatePeriod>) => {
    setDraftPeriods((arr) =>
      arr.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );
  };

  const addPeriodRow = (kind: PeriodKind) => {
    setDraftPeriods((arr) => [
      ...arr,
      {
        position: arr.length + 1,
        kind,
        label:
          kind === "teaching"
            ? `Period ${arr.filter((a) => a.kind === "teaching").length + 1}`
            : kind === "lunch"
              ? "Lunch"
              : "Break",
        start_time: arr.length ? arr[arr.length - 1].end_time : "08:00",
        end_time: kind === "lunch" ? "" : "",
      },
    ]);
  };

  const removePeriodRow = (idx: number) => {
    setDraftPeriods((arr) => arr.filter((_, i) => i !== idx).map((p, i) => ({ ...p, position: i + 1 })));
  };

  const handleSave = async () => {
    if (!editingId) return;
    if (!draftPeriods.some((p) => p.kind === "lunch")) {
      toast.error("Every template must include a lunch slot.");
      return;
    }
    for (const p of draftPeriods) {
      if (!p.start_time || !p.end_time) {
        toast.error(`Period ${p.position} is missing a start or end time.`);
        return;
      }
      if (p.end_time <= p.start_time) {
        toast.error(`Period ${p.position}: end time must be after start time.`);
        return;
      }
    }
    setSaving(true);
    const res = await adminFetch(`/api/timetable/templates/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draftName,
        periods: draftPeriods.map((p, i) => ({
          position: i + 1,
          kind: p.kind,
          label: p.label,
          start_time: p.start_time,
          end_time: p.end_time,
        })),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to save");
    } else {
      toast.success("Template saved");
      cancelEdit();
      await refresh();
    }
    setSaving(false);
  };

  const handleClone = async () => {
    if (!cloneFromId || !cloneName.trim()) {
      toast.error("Pick a source template and enter a name.");
      return;
    }
    const res = await adminFetch("/api/timetable/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clone_from_id: cloneFromId, name: cloneName.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to clone");
      return;
    }
    setCloneOpen(false);
    setCloneFromId("");
    setCloneName("");
    toast.success("Cloned");
    await refresh();
  };

  const handleDelete = async (t: Template) => {
    if (t.is_system) {
      toast.error("System templates cannot be deleted.");
      return;
    }
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const res = await adminFetch(`/api/timetable/templates/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    await refresh();
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
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/timetable" className="inline-flex items-center text-xs text-gray-500 hover:text-navy-900 mb-1">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Timetable
          </Link>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white">
            Timetable Templates
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Built-in templates A.1–A.4 are pre-installed. Clone any to customize period times.
            Every template must include a 20-minute lunch slot.
          </p>
        </div>
        <Button onClick={() => setCloneOpen(true)} className="bg-navy-900 hover:bg-navy-800 text-white">
          <Copy className="h-4 w-4 mr-1.5" />
          Clone Template
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {templates.map((t) => (
          <div key={t.id} className="erp-table-container p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold text-navy-900 dark:text-white">
                  {t.name}
                  {t.is_system && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                      Built-in
                    </span>
                  )}
                </h3>
                {t.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-0.5">
                  {t.teaching_period_count} teaching periods
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(t)}
                  disabled={t.is_system}
                  title={t.is_system ? "Clone first to edit" : "Edit periods"}
                >
                  Edit
                </Button>
                {!t.is_system && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(t)}
                    title="Delete template"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
            <ul className="space-y-1">
              {t.periods.map((p) => (
                <li
                  key={p.position}
                  className={`flex items-center justify-between text-sm rounded-md px-2.5 py-1.5 ${
                    p.kind === "lunch"
                      ? "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
                      : p.kind === "break"
                        ? "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400"
                        : "bg-gray-50 dark:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {p.kind === "lunch" && <Coffee className="h-3.5 w-3.5" />}
                    <span className="font-medium">{p.label ?? `#${p.position}`}</span>
                  </span>
                  <span className="font-mono text-xs">
                    {p.start_time} – {p.end_time}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ─────────────── Clone dialog ─────────────── */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clone Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Clone from</Label>
              <Select value={cloneFromId} onValueChange={(v) => setCloneFromId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">New template name</Label>
              <Input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="e.g. A.1 Regular — Senior Wing"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button onClick={handleClone} className="bg-navy-900 hover:bg-navy-800 text-white">
              <Copy className="h-4 w-4 mr-1" />
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────── Edit dialog ─────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) cancelEdit(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Template name</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-muted">
                  <tr className="text-xs text-gray-500">
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Kind</th>
                    <th className="px-2 py-2 text-left">Label</th>
                    <th className="px-2 py-2 text-left">Start</th>
                    <th className="px-2 py-2 text-left">End</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {draftPeriods.map((p, idx) => (
                    <tr key={idx} className="border-t border-gray-100 dark:border-border">
                      <td className="px-2 py-1.5 text-xs">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={p.kind}
                          onValueChange={(v) => v && updatePeriod(idx, { kind: v as PeriodKind })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="teaching">Teaching</SelectItem>
                            <SelectItem value="lunch">Lunch</SelectItem>
                            <SelectItem value="break">Short break</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={p.label ?? ""}
                          onChange={(e) => updatePeriod(idx, { label: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="time"
                          value={p.start_time}
                          onChange={(e) => updatePeriod(idx, { start_time: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="time"
                          value={p.end_time}
                          onChange={(e) => updatePeriod(idx, { end_time: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removePeriodRow(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => addPeriodRow("teaching")}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Period
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPeriodRow("lunch")}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Lunch
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addPeriodRow("break")}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Break
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
