"use client";

import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
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
import type { ResultMasterRoundingMode } from "@nkps/shared/types";
import { previewRound } from "../helpers";

export function RoundingSection({
  mode,
  precision,
  roundRawMarks,
  onChange,
}: {
  mode: ResultMasterRoundingMode;
  precision: number;
  roundRawMarks: boolean;
  onChange: (
    patch: Partial<{
      rounding_mode: ResultMasterRoundingMode;
      rounding_precision: number;
      round_raw_marks: boolean;
    }>
  ) => void;
}) {
  const previewRawIn = 39.5;
  const previewPctIn = 74.5;
  const previewRaw = previewRound(previewRawIn, mode, precision);
  const previewPct = previewRound(previewPctIn, mode, precision);
  const noRounding = mode === "none";
  const MODE_LABEL: Record<ResultMasterRoundingMode, string> = {
    none: "None",
    half_up: "Half-up (39.5 → 40)",
    half_down: "Half-down (39.5 → 39)",
    ceil: "Ceiling (always up)",
    floor: "Floor (always down)",
  };

  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">Rounding</CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Applied to subject percentages and the overall aggregate. Enable
          raw-marks rounding only if you want raw scores rounded before the
          percentage is computed — this changes downstream percentages
          non-linearly when combined with percentage rounding.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs font-medium">Rounding mode</Label>
            <div className="mt-1">
              <Select
                value={mode}
                items={[
                  { value: "none", label: "None" },
                  { value: "half_up", label: "Half-up (39.5 → 40)" },
                  { value: "half_down", label: "Half-down (39.5 → 39)" },
                  { value: "ceil", label: "Ceiling (always up)" },
                  { value: "floor", label: "Floor (always down)" },
                ]}
                onValueChange={(v) => {
                  if (!v) return;
                  onChange({ rounding_mode: v as ResultMasterRoundingMode });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{MODE_LABEL[mode]}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="none" label="None">
                    None
                  </SelectItem>
                  <SelectItem value="half_up" label="Half-up">
                    Half-up (39.5 → 40)
                  </SelectItem>
                  <SelectItem value="half_down" label="Half-down">
                    Half-down (39.5 → 39)
                  </SelectItem>
                  <SelectItem value="ceil" label="Ceiling">
                    Ceiling (always up)
                  </SelectItem>
                  <SelectItem value="floor" label="Floor">
                    Floor (always down)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium">Decimal places</Label>
            <Input
              type="number"
              min={0}
              max={2}
              step="1"
              value={precision}
              onChange={(e) =>
                onChange({
                  rounding_precision: Math.max(
                    0,
                    Math.min(2, Number(e.target.value) || 0)
                  ),
                })
              }
              disabled={noRounding}
              className="mt-1 font-mono"
            />
          </div>
          <div className="flex items-center gap-2 md:pt-6">
            <Checkbox
              id="round-raw-marks"
              checked={roundRawMarks}
              onCheckedChange={(v) =>
                onChange({ round_raw_marks: Boolean(v) })
              }
              disabled={noRounding}
            />
            <Label
              htmlFor="round-raw-marks"
              className="text-xs font-medium cursor-pointer"
            >
              Also round raw marks before percentage
            </Label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PreviewCard
            label="Raw marks"
            before={`${previewRawIn}`}
            after={noRounding ? "No rounding applied" : `${previewRaw}`}
            disabled={noRounding}
          />
          <PreviewCard
            label="Percentage"
            before={`${previewPctIn}%`}
            after={noRounding ? "No rounding applied" : `${previewPct}%`}
            disabled={noRounding}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewCard({
  label,
  before,
  after,
  disabled,
}: {
  label: string;
  before: string;
  after: string;
  disabled: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-border px-3 py-2 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="text-sm font-mono mt-1 text-navy-900 dark:text-white">
        <span className="text-gray-500 dark:text-gray-400">{before}</span>
        <span className="mx-2 text-gray-300 dark:text-gray-600">→</span>
        <span>{after}</span>
      </p>
    </div>
  );
}
