"use client";

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
import type { GradeScale } from "@/lib/grading";

export function GradeScaleSection({
  gradeScaleId,
  gradeScales,
  onChange,
}: {
  gradeScaleId: string | null;
  gradeScales: GradeScale[];
  onChange: (id: string | null) => void;
}) {
  const currentLabel = !gradeScaleId
    ? "Using class default"
    : gradeScales.find((gs) => gs.id === gradeScaleId)?.name ??
      "(unknown scale)";

  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">
          Grade Scale Override
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Pick a specific scholastic grade scale, or leave on class default
          (configured on the Grade Master page).
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 md:items-end">
        <div>
          <Label className="text-xs font-medium">Grade scale</Label>
          <div className="mt-1 max-w-md">
            <Select
              value={gradeScaleId ?? "__default__"}
              items={[
                { value: "__default__", label: "Use class default" },
                ...gradeScales.map((gs) => ({
                  value: gs.id,
                  label: gs.name + (gs.is_default ? " · default" : ""),
                })),
              ]}
              onValueChange={(v) => {
                if (!v) return;
                onChange(v === "__default__" ? null : v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Use class default">
                  {currentLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="__default__" label="Use class default">
                  Use class default
                </SelectItem>
                {gradeScales.map((gs) => (
                  <SelectItem
                    key={gs.id}
                    value={gs.id}
                    label={gs.name + (gs.is_default ? " · default" : "")}
                  >
                    {gs.name}
                    {gs.is_default ? " · default" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 md:pb-2">
          Currently:{" "}
          <span className="font-medium text-navy-900 dark:text-white">
            {currentLabel}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
