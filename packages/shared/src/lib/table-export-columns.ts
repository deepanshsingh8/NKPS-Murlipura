// Adapter: a page's `TableColumns` map → export columns.
//
// This is the hinge the whole feature turns on. Every list page already hands
// `useTableControls` a map of `{ label, value }` accessors so its headers can
// sort and filter — which is exactly a column registry. Reusing it means an
// export cannot disagree with the table it came from, and ~26 of the app's
// tables gain a working export without defining a single new column.

import {
  labelOf,
  type TableColumnDef,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import type { ExportColumn } from "@nkps/shared/lib/table-export";

export interface ResolveExportColumnsOptions {
  /** Restrict to these keys, in this order. Omit for every exportable column. */
  keys?: readonly string[];
}

function isExportable<T>(column: TableColumnDef<T>): boolean {
  // No accessor means no data — action and icon columns are declared without
  // `value`, so they are excluded without anyone having to remember to.
  return typeof column.value === "function";
}

/** The keys a picker should offer, in the map's own (i.e. on-screen) order. */
export function exportableKeys<T>(columns: TableColumns<T>): string[] {
  return Object.entries(columns)
    .filter(([, column]) => isExportable(column))
    .map(([key]) => key);
}

/** The keys ticked when the dialog opens. */
export function defaultExportKeys<T>(columns: TableColumns<T>): string[] {
  return Object.entries(columns)
    .filter(([, column]) => isExportable(column))
    .filter(([, column]) => !column.exportOnly)
    .map(([key]) => key);
}

function toExportColumn<T>(
  key: string,
  column: TableColumnDef<T>
): ExportColumn<T> {
  const format = column.exportFormat ?? "text";
  return {
    key,
    header: column.exportLabel ?? column.label,
    format,
    text: (row) => labelOf(column, row),
    // For a non-text column the raw source is `exportValue` if given, else
    // `sortValue` — which throughout this codebase already holds precisely
    // the number or date that `value` formats for display (a fee column sorts
    // by the rupee amount, a date column by its epoch). So making a currency
    // column summable in Excel usually costs one word, not a new accessor.
    raw:
      format === "text"
        ? undefined
        : (row) => {
            const accessor = column.exportValue ?? column.sortValue;
            if (accessor) return accessor(row);
            return column.value?.(row);
          },
  };
}

export function resolveExportColumns<T>(
  columns: TableColumns<T>,
  { keys }: ResolveExportColumnsOptions = {}
): ExportColumn<T>[] {
  const wanted = keys ?? exportableKeys(columns);
  const out: ExportColumn<T>[] = [];
  for (const key of wanted) {
    const column = columns[key];
    if (!column || !isExportable(column)) continue;
    out.push(toExportColumn(key, column));
  }
  return out;
}
