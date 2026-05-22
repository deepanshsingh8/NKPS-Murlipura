"use client";

import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { EXAM_KIND_LABEL } from "../helpers";
import type { ExamKind } from "@nkps/shared/types";

export interface WeightageRow {
  exam_type_id: string;
  exam_name: string;
  kind: ExamKind;
  is_applicable: boolean;
  weightage: number | "";
  max_marks_override: number | "";
  sort_order: number;
}

export function WeightageSection({
  rows,
  sumRounded,
  sum100,
  loading,
  error,
  onRetry,
  saving,
  onUpdateRow,
}: {
  rows: WeightageRow[];
  sumRounded: number;
  sum100: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  saving: boolean;
  onUpdateRow: (exam_type_id: string, patch: Partial<WeightageRow>) => void;
}) {
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base font-heading">Weightage</CardTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Configure which exams contribute to the final and their relative
              weight. Weights that sum to 100% produce a clean weighted
              average.
            </p>
          </div>
          <SumChip sum={sumRounded} sum100={sum100} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                Weightage save failed
              </p>
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                {error}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={saving}
              className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              <span className="ml-1">Retry</span>
            </Button>
          </div>
        )}

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-navy-900 dark:text-white" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
            No exam types configured for this academic year yet. Add them
            under Exams → Exam Types first.
          </p>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-border overflow-hidden">
            <div className="grid grid-cols-[48px_minmax(140px,2fr)_110px_120px_130px_90px] gap-2 px-3 py-2 bg-gray-50 dark:bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <span>Incl.</span>
              <span>Exam</span>
              <span>Kind</span>
              <span>Weight (%)</span>
              <span>Max marks</span>
              <span>Sort</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-border">
              {rows.map((row) => {
                const disabled = !row.is_applicable;
                return (
                  <div
                    key={row.exam_type_id}
                    className="grid grid-cols-[48px_minmax(140px,2fr)_110px_120px_130px_90px] gap-2 px-3 py-2 items-center"
                  >
                    <Checkbox
                      checked={row.is_applicable}
                      onCheckedChange={(v) =>
                        onUpdateRow(row.exam_type_id, {
                          is_applicable: Boolean(v),
                        })
                      }
                    />
                    <span
                      className={`text-sm truncate ${
                        disabled
                          ? "text-gray-400 dark:text-gray-600"
                          : "text-navy-900 dark:text-white"
                      }`}
                      title={row.exam_name}
                    >
                      {row.exam_name}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {EXAM_KIND_LABEL[row.kind]}
                    </Badge>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={row.weightage}
                      onChange={(e) =>
                        onUpdateRow(row.exam_type_id, {
                          weightage:
                            e.target.value === ""
                              ? ""
                              : Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                      placeholder="—"
                      className="font-mono"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      value={row.max_marks_override}
                      onChange={(e) =>
                        onUpdateRow(row.exam_type_id, {
                          max_marks_override:
                            e.target.value === ""
                              ? ""
                              : Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                      placeholder="(default)"
                      className="font-mono"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      value={row.sort_order}
                      onChange={(e) =>
                        onUpdateRow(row.exam_type_id, {
                          sort_order: Number(e.target.value) || 0,
                        })
                      }
                      className="font-mono"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SumChip({ sum, sum100 }: { sum: number; sum100: boolean }) {
  const label = `Sum: ${sum}%`;
  if (sum100) {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300 border-green-300 dark:border-green-900">
        <CheckCircle2 className="h-3 w-3" />
        <span className="ml-1">{label}</span>
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-900">
      <AlertTriangle className="h-3 w-3" />
      <span className="ml-1">
        {label} — consider 100% for a clean weighted average
      </span>
    </Badge>
  );
}
