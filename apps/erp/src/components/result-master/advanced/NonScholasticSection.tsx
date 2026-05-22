"use client";

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
import type { ResultMasterNonScholasticPlacement } from "@nkps/shared/types";

export function NonScholasticSection({
  include,
  placement,
  onChange,
}: {
  include: boolean;
  placement: ResultMasterNonScholasticPlacement;
  onChange: (
    patch: Partial<{
      include_non_scholastic: boolean;
      non_scholastic_placement: ResultMasterNonScholasticPlacement;
    }>
  ) => void;
}) {
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">
          Non-Scholastic Display
        </CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          No non-scholastic assessment data is being entered yet (Phase 2
          feature). The report card will show &quot;Not yet recorded&quot; in
          this block until Phase 2 lands — configure the layout now so
          it&apos;s ready.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 md:items-end">
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-ns"
            checked={include}
            onCheckedChange={(v) =>
              onChange({ include_non_scholastic: Boolean(v) })
            }
          />
          <Label
            htmlFor="include-ns"
            className="text-xs font-medium cursor-pointer"
          >
            Include non-scholastic on report card
          </Label>
        </div>
        <div>
          <Label className="text-xs font-medium">Placement</Label>
          <div className="mt-1 max-w-xs">
            <Select
              value={placement}
              items={[
                { value: "below", label: "Below scholastic" },
                { value: "above", label: "Above scholastic" },
                { value: "separate_page", label: "Separate page" },
              ]}
              onValueChange={(v) => {
                if (!v) return;
                onChange({
                  non_scholastic_placement:
                    v as ResultMasterNonScholasticPlacement,
                });
              }}
              disabled={!include}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {placement === "below"
                    ? "Below scholastic"
                    : placement === "above"
                      ? "Above scholastic"
                      : "Separate page"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="below" label="Below scholastic">
                  Below scholastic
                </SelectItem>
                <SelectItem value="above" label="Above scholastic">
                  Above scholastic
                </SelectItem>
                <SelectItem value="separate_page" label="Separate page">
                  Separate page
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
