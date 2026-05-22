"use client";

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
import type { ResultMasterGraceCondition } from "@nkps/shared/types";

export function GraceSection({
  perSubjectMax,
  totalMax,
  condition,
  onChange,
}: {
  perSubjectMax: number | "";
  totalMax: number | "";
  condition: ResultMasterGraceCondition;
  onChange: (
    patch: Partial<{
      grace_marks_per_subject_max: number | "";
      grace_marks_total_max: number | "";
      grace_marks_condition: ResultMasterGraceCondition;
    }>
  ) => void;
}) {
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">Grace Marks</CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Applies to both main AND optional subjects. The total cap is
          distributed in subject sort-order; lowest sort_order gets grace
          first when the cap is tight.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs font-medium">Per-subject max (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={perSubjectMax}
            onChange={(e) =>
              onChange({
                grace_marks_per_subject_max:
                  e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Total cap (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={totalMax}
            onChange={(e) =>
              onChange({
                grace_marks_total_max:
                  e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Apply grace to</Label>
          <div className="mt-1">
            <Select
              value={condition}
              items={[
                {
                  value: "failing_only",
                  label: "Only to failing subjects",
                },
                { value: "any_subject", label: "Any subject" },
              ]}
              onValueChange={(v) => {
                if (!v) return;
                onChange({
                  grace_marks_condition: v as ResultMasterGraceCondition,
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {condition === "failing_only"
                    ? "Only to failing subjects"
                    : "Any subject"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem
                  value="failing_only"
                  label="Only to failing subjects"
                >
                  Only to failing subjects
                </SelectItem>
                <SelectItem value="any_subject" label="Any subject">
                  Any subject
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
