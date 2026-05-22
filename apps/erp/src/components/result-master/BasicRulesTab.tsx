"use client";

import { useEffect, useState } from "react";
import { adminPatch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SUPPORTED_PASS_CRITERIA_TYPES } from "@/lib/final-result";
import type {
  ResultMaster,
  ResultMasterPassMarkMode,
} from "@nkps/shared/types";
import {
  defaultConfigFor,
  labelForCriteriaType,
  shallowEqualRecord,
} from "./helpers";

interface BasicForm {
  pass_mark_mode: ResultMasterPassMarkMode;
  pass_mark_value: number | "";
  pass_criteria_type: string;
  pass_criteria_config: Record<string, unknown>;
}

function basicFormFromMaster(m: ResultMaster): BasicForm {
  return {
    pass_mark_mode: m.pass_mark_mode,
    pass_mark_value: m.pass_mark_value,
    pass_criteria_type: m.pass_criteria_type,
    pass_criteria_config: { ...(m.pass_criteria_config ?? {}) },
  };
}

export function BasicRulesTab({
  master,
  onSaved,
}: {
  master: ResultMaster;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<BasicForm>(() =>
    basicFormFromMaster(master)
  );
  const [baseline, setBaseline] = useState<BasicForm>(() =>
    basicFormFromMaster(master)
  );
  const [saving, setSaving] = useState(false);

  // Re-seed when the master identity changes (e.g., after a successful save
  // refetch or when the selector swaps classes).
  useEffect(() => {
    const next = basicFormFromMaster(master);
    setForm(next);
    setBaseline(next);
  }, [master]);

  const dirty =
    form.pass_mark_mode !== baseline.pass_mark_mode ||
    form.pass_mark_value !== baseline.pass_mark_value ||
    form.pass_criteria_type !== baseline.pass_criteria_type ||
    !shallowEqualRecord(
      form.pass_criteria_config,
      baseline.pass_criteria_config
    );

  const unit = form.pass_mark_mode === "percentage" ? "%" : "marks";

  const changeCriteriaType = (type: string) => {
    setForm((prev) => ({
      ...prev,
      pass_criteria_type: type,
      pass_criteria_config: defaultConfigFor(type),
    }));
  };

  const setConfigField = (key: string, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      pass_criteria_config: { ...prev.pass_criteria_config, [key]: value },
    }));
  };

  const validate = (): string | null => {
    if (
      form.pass_mark_value === "" ||
      Number.isNaN(Number(form.pass_mark_value))
    ) {
      return "Pass mark value is required.";
    }
    const pmv = Number(form.pass_mark_value);
    if (pmv < 0) return "Pass mark must be ≥ 0.";
    if (form.pass_mark_mode === "percentage" && pmv > 100) {
      return "Percentage pass mark must be ≤ 100.";
    }
    const type = form.pass_criteria_type;
    const cfg = form.pass_criteria_config;
    if (
      type === "overall_percentage" ||
      type === "main_and_overall" ||
      type === "allow_one_fail"
    ) {
      const n = Number(cfg.overall_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return "Overall % must be between 0 and 100.";
      }
    } else if (type === "pass_n_subjects") {
      const n = Number(cfg.n);
      if (!Number.isInteger(n) || n < 1) {
        return "Minimum pass count must be a positive integer.";
      }
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await adminPatch(`/api/result-masters/${master.id}`, {
        pass_mark_mode: form.pass_mark_mode,
        pass_mark_value: Number(form.pass_mark_value),
        pass_criteria_type: form.pass_criteria_type,
        pass_criteria_config: form.pass_criteria_config,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save basic rules");
        return;
      }
      toast.success("Basic rules saved");
      setBaseline(form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base font-heading">Basic Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pass mark mode + value — side-by-side, start-aligned, independent helper text */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Pass mark mode</Label>
            <div
              className="inline-flex rounded-lg border border-gray-200 dark:border-border p-[3px] bg-gray-50 dark:bg-muted/40 h-10"
              role="radiogroup"
              aria-label="Pass mark mode"
            >
              {(
                [
                  { v: "percentage", label: "Percentage" },
                  { v: "raw_marks", label: "Raw marks" },
                ] as const
              ).map((opt) => {
                const active = form.pass_mark_mode === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        pass_mark_mode: opt.v,
                      }))
                    }
                    className={[
                      "px-3 text-sm rounded-md transition-colors",
                      active
                        ? "bg-white dark:bg-background shadow-sm text-navy-900 dark:text-white font-medium"
                        : "text-gray-500 hover:text-navy-900 dark:hover:text-white",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Percentage: e.g. 33 → 33%. Raw marks: e.g. 33 → 33 out of the subject&apos;s total.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Pass mark value ({unit})
            </Label>
            <div className="relative max-w-xs">
              <Input
                type="number"
                step="0.5"
                min={0}
                max={form.pass_mark_mode === "percentage" ? 100 : undefined}
                value={form.pass_mark_value}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    pass_mark_value:
                      e.target.value === "" ? "" : Number(e.target.value),
                  }))
                }
                className="pr-10 font-mono h-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {unit}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Applied uniformly unless a subject override is set on the
              Subjects tab.
            </p>
          </div>
        </div>

        {/* Pass criteria */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Pass criteria</Label>
            <div className="max-w-md">
              <Select
                value={form.pass_criteria_type}
                items={SUPPORTED_PASS_CRITERIA_TYPES.map((t) => ({
                  value: t as string,
                  label: labelForCriteriaType(t),
                }))}
                onValueChange={(v) => v && changeCriteriaType(v)}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Pick a criteria...">
                    {labelForCriteriaType(form.pass_criteria_type)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {SUPPORTED_PASS_CRITERIA_TYPES.map((t) => (
                    <SelectItem
                      key={t}
                      value={t}
                      label={labelForCriteriaType(t)}
                    >
                      {labelForCriteriaType(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <CriteriaConfigPanel
            type={form.pass_criteria_type}
            config={form.pass_criteria_config}
            onChange={setConfigField}
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-navy-900 text-white hover:bg-navy-900/90"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Basic Rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CriteriaConfigPanel({
  type,
  config,
  onChange,
}: {
  type: string;
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (type === "all_main_subjects") {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-muted/40 rounded-lg p-3">
        No extra config — student must pass every main subject.
      </p>
    );
  }

  if (
    type === "overall_percentage" ||
    type === "main_and_overall" ||
    type === "allow_one_fail"
  ) {
    const raw = config.overall_pct;
    const value: number | "" =
      raw === undefined || raw === null || raw === "" ? "" : Number(raw);
    return (
      <div className="max-w-xs">
        <Label className="text-xs font-medium">Overall %</Label>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.5"
          value={value}
          onChange={(e) =>
            onChange(
              "overall_pct",
              e.target.value === "" ? "" : Number(e.target.value)
            )
          }
          className="mt-1 font-mono"
        />
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
          Aggregate is computed across main subjects only.
        </p>
      </div>
    );
  }

  if (type === "pass_n_subjects") {
    const raw = config.n;
    const value: number | "" =
      raw === undefined || raw === null || raw === "" ? "" : Number(raw);
    return (
      <div className="max-w-xs">
        <Label className="text-xs font-medium">
          Minimum main subjects to pass (N)
        </Label>
        <Input
          type="number"
          min={1}
          step="1"
          value={value}
          onChange={(e) =>
            onChange(
              "n",
              e.target.value === "" ? "" : Number(e.target.value)
            )
          }
          className="mt-1 font-mono"
        />
      </div>
    );
  }

  return null;
}
