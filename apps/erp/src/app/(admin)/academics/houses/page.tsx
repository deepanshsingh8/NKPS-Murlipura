"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminApi } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

interface House {
  id: string;
  name: string;
  code: string | null;
  colour: string | null;
  sort_order: number;
  is_active: boolean;
}

const BLANK: Omit<House, "id"> = {
  name: "",
  code: "",
  colour: "#2563EB",
  sort_order: 0,
  is_active: true,
};

/**
 * House master.
 *
 * Assignment is not here — a student's house lives on their enrollment
 * (migration 090) because it is per-session, so it is set on the student
 * record alongside class and roll number. This page owns the list itself.
 */
export default function HousesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<House | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("houses")
      .select("id, name, code, colour, sort_order, is_active")
      .order("sort_order")
      .order("name");
    if (error) toast.error("Failed to load houses");
    setHouses((data ?? []) as House[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...BLANK, sort_order: houses.length + 1 });
    setDialogOpen(true);
  };

  const openEdit = (house: House) => {
    setEditing(house);
    setForm({
      name: house.name,
      code: house.code ?? "",
      colour: house.colour ?? "#2563EB",
      sort_order: house.sort_order,
      is_active: house.is_active,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      code: form.code?.trim() || null,
      colour: form.colour || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };
    const result = editing
      ? await adminApi({
          action: "update",
          table: "houses",
          data: payload,
          match: { column: "id", value: editing.id },
        })
      : await adminApi({ action: "insert", table: "houses", data: payload });
    setSaving(false);

    if (!result.success) {
      // The case-insensitive unique index is the thing this most often trips,
      // and "duplicate key" means nothing to an office user.
      toast.error(
        /duplicate|unique/i.test(result.error ?? "")
          ? `A house named “${name}” already exists`
          : result.error ?? "Failed to save house"
      );
      return;
    }
    toast.success(editing ? "House updated" : "House added");
    setDialogOpen(false);
    load();
  };

  const remove = async (house: House) => {
    // house_id is ON DELETE SET NULL, so deleting silently blanks the house on
    // every enrollment that held it. Say so — deactivating is almost always
    // what the user actually wants.
    if (
      !confirm(
        `Delete “${house.name}”?\n\nEvery student currently assigned to this ` +
          `house will have their house cleared, in every session. ` +
          `Deactivating it instead keeps the history intact.`
      )
    ) {
      return;
    }
    const result = await adminApi({
      action: "delete",
      table: "houses",
      match: { column: "id", value: house.id },
    });
    if (!result.success) {
      toast.error(result.error ?? "Failed to delete house");
      return;
    }
    toast.success("House deleted");
    load();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="erp-page-bar sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-navy-900 dark:text-white">
            Houses
          </h1>
          <p className="text-sm text-muted-foreground">
            Inter-house grouping. A student&apos;s house is recorded per session
            on their enrolment.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add House
        </Button>
      </div>

      <div className="rounded-lg border bg-white dark:bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Colour</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!loading && houses.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No houses yet.
                </TableCell>
              </TableRow>
            )}
            {houses.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-medium">{h.name}</TableCell>
                <TableCell>{h.code ?? "—"}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-4 w-4 rounded border"
                      style={{ backgroundColor: h.colour ?? "transparent" }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {h.colour ?? "—"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.sort_order}
                </TableCell>
                <TableCell>
                  <Badge variant={h.is_active ? "default" : "secondary"}>
                    {h.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(h)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 dark:text-red-400"
                      onClick={() => remove(h)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit House" : "Add House"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Red House"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input
                value={form.code ?? ""}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="RED"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Colour</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border"
                  value={form.colour ?? "#2563EB"}
                  onChange={(e) => setForm({ ...form, colour: e.target.value })}
                />
                <Input
                  value={form.colour ?? ""}
                  onChange={(e) => setForm({ ...form, colour: e.target.value })}
                  placeholder="#DC2626"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sort Order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm({ ...form, is_active: v === true })
                  }
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : "Add House"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
