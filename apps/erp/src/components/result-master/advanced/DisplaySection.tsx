"use client";

import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";

export function DisplaySection({
  showRank,
  showExtraSeparately,
  showDivision,
  onChange,
}: {
  showRank: boolean;
  showExtraSeparately: boolean;
  showDivision: boolean;
  onChange: (
    patch: Partial<{
      show_rank: boolean;
      show_extra_separately: boolean;
      show_division: boolean;
    }>
  ) => void;
}) {
  return (
    <Card className="bg-white dark:bg-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading">Report Display</CardTitle>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Toggles that control what appears on the year-end report card.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-rank"
            checked={showRank}
            onCheckedChange={(v) => onChange({ show_rank: Boolean(v) })}
          />
          <Label
            htmlFor="show-rank"
            className="text-xs font-medium cursor-pointer"
          >
            Show class rank
            <span className="ml-2 text-[10px] font-normal text-gray-500">
              Adds a &ldquo;Rank&rdquo; row to the Final Result panel. Computing rank is
              relatively expensive on large classes (one extra pass over all
              students).
            </span>
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-extra"
            checked={showExtraSeparately}
            onCheckedChange={(v) =>
              onChange({ show_extra_separately: Boolean(v) })
            }
          />
          <Label
            htmlFor="show-extra"
            className="text-xs font-medium cursor-pointer"
          >
            Show optional subjects in a separate table
            <span className="ml-2 text-[10px] font-normal text-gray-500">
              When unchecked, optional subjects are merged into the main
              subject table and counted toward the overall percentage.
            </span>
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-division"
            checked={showDivision}
            onCheckedChange={(v) =>
              onChange({ show_division: Boolean(v) })
            }
          />
          <Label
            htmlFor="show-division"
            className="text-xs font-medium cursor-pointer"
          >
            Show CBSE division (First/Second/Third)
            <span className="ml-2 text-[10px] font-normal text-gray-500">
              First ≥ 60%, Second ≥ 45%, Third ≥ 33%. Only printed when the
              student passes overall.
            </span>
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
