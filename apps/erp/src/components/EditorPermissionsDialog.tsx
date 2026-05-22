"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { FEATURE_CATALOG, isFeatureKey, type FeatureKey } from "@nkps/shared/lib/permissions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorId: string | null;
  editorName: string;
}

export function EditorPermissionsDialog({
  open,
  onOpenChange,
  editorId,
  editorName,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [granted, setGranted] = useState<Set<FeatureKey>>(new Set());

  useEffect(() => {
    if (!open || !editorId) return;
    setLoading(true);
    adminFetch(`/api/editor-permissions?editor_id=${editorId}`)
      .then((res) => res.json())
      .then((data) => {
        // Drop stale keys not in the current catalog so they neither appear
        // pre-checked nor get round-tripped back to the API.
        const keys = Array.isArray(data?.feature_keys)
          ? (data.feature_keys as unknown[]).filter(isFeatureKey)
          : [];
        setGranted(new Set(keys));
      })
      .catch(() => toast.error("Failed to load permissions"))
      .finally(() => setLoading(false));
  }, [open, editorId]);

  const toggle = (key: FeatureKey) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setGroup = (group: "cms" | "erp", checked: boolean) => {
    setGranted((prev) => {
      const next = new Set(prev);
      for (const f of FEATURE_CATALOG) {
        if (f.group !== group) continue;
        if (checked) next.add(f.key);
        else next.delete(f.key);
      }
      return next;
    });
  };

  const save = async () => {
    if (!editorId) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/editor-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editor_id: editorId,
          feature_keys: Array.from(granted),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save permissions");
        return;
      }
      toast.success("Permissions updated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const contentFeatures = FEATURE_CATALOG.filter((f) => f.group === "cms");
  const erpFeatures = FEATURE_CATALOG.filter((f) => f.group === "erp");

  const contentAllChecked = contentFeatures.every((f) => granted.has(f.key));
  const erpAllChecked = erpFeatures.every((f) => granted.has(f.key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-950/30 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-purple-700 dark:text-purple-400" />
            </div>
            <div>
              <DialogTitle>Editor Capability</DialogTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Choose which CMS / ERP features {editorName} can access
              </p>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6">
            <FeatureGroup
              title="CMS"
              features={contentFeatures}
              granted={granted}
              toggle={toggle}
              allChecked={contentAllChecked}
              onToggleAll={(checked) => setGroup("cms", checked)}
            />
            <FeatureGroup
              title="ERP"
              features={erpFeatures}
              granted={granted}
              toggle={toggle}
              allChecked={erpAllChecked}
              onToggleAll={(checked) => setGroup("erp", checked)}
            />

            <p className="text-xs text-gray-400 dark:text-gray-500">
              Anyone with a granted feature gets the matching dashboard tile and
              sidebar entry. User management and master config stay admin-only.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || loading}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FeatureGroupProps {
  title: string;
  features: typeof FEATURE_CATALOG;
  granted: Set<FeatureKey>;
  toggle: (key: FeatureKey) => void;
  allChecked: boolean;
  onToggleAll: (checked: boolean) => void;
}

function FeatureGroup({
  title,
  features,
  granted,
  toggle,
  allChecked,
  onToggleAll,
}: FeatureGroupProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(v) => onToggleAll(v === true)}
          />
          Select all
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl border border-gray-200 dark:border-border">
        {features.map((f) => (
          <label
            key={f.key}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-muted/40 cursor-pointer"
          >
            <Checkbox
              checked={granted.has(f.key)}
              onCheckedChange={() => toggle(f.key)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">
              {f.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
