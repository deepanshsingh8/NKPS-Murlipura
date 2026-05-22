"use client";

import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { X } from "lucide-react";

export function BestOfSection({
  classTestBestOf,
  practicalBestOf,
  classTestCount,
  practicalCount,
  onChange,
}: {
  classTestBestOf: number | "";
  practicalBestOf: number | "";
  classTestCount: number;
  practicalCount: number;
  onChange: (field: "class_test_best_of" | "practical_best_of", v: number | "") => void;
}) {
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">
          Best-of Rules
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Keep only the top-N exams of a given kind. Dropped exams still
          appear on the report card but don&apos;t contribute to the aggregate.
          No automatic weight redistribution — adjust individual weights if
          you want a constant total contribution.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BestOfInput
          label="Class tests — best of"
          value={classTestBestOf}
          onChange={(v) => onChange("class_test_best_of", v)}
          contextCount={classTestCount}
          contextLabel="class tests"
        />
        <BestOfInput
          label="Practicals — best of"
          value={practicalBestOf}
          onChange={(v) => onChange("practical_best_of", v)}
          contextCount={practicalCount}
          contextLabel="practicals"
        />
      </CardContent>
    </Card>
  );
}

function BestOfInput({
  label,
  value,
  onChange,
  contextCount,
  contextLabel,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  contextCount: number;
  contextLabel: string;
}) {
  return (
    <div>
      <Label className="text-xs font-medium">{label}</Label>
      <div className="mt-1 flex items-center gap-2 max-w-xs">
        <Input
          type="number"
          min={1}
          step="1"
          value={value}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          placeholder="Use all"
          className="font-mono"
        />
        {value !== "" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange("")}
            title="Clear — use all"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
        You have {contextCount} {contextLabel} configured. Example: setting 2
        = only the top 2 {contextLabel} by percentage contribute to the final.
      </p>
    </div>
  );
}
