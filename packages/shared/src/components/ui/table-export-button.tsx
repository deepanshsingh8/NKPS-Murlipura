"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@nkps/shared/lib/utils";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import type {
  FilterSummaryEntry,
  TableColumns,
  TableControls,
} from "@nkps/shared/components/ui/data-table";
import {
  buildExportMatrix,
  csvBlob,
  downloadBlob,
  exportAligns,
  exportFilename,
  matrixToText,
  toCsv,
  type ExportFileFormat,
} from "@nkps/shared/lib/table-export";
import {
  defaultExportKeys,
  exportableKeys,
  resolveExportColumns,
} from "@nkps/shared/lib/table-export-columns";
import {
  PDF_MAX_COLUMNS,
  PDF_MAX_ROWS,
} from "@nkps/shared/lib/table-export-payload";

const TABLE_PDF_ROUTE = "/api/export/table-pdf";

const FORMAT_LABELS: Record<ExportFileFormat, string> = {
  csv: "CSV",
  xlsx: "Excel",
  pdf: "PDF",
};

const FORMAT_HINTS: Record<ExportFileFormat, string> = {
  csv: "Plain text. Opens anywhere, but Excel may drop leading zeros from admission numbers.",
  xlsx: "Formatted workbook with filters. Keeps admission numbers and phone numbers intact.",
  pdf: "Printable sheet on the school letterhead, with the filters written into the header.",
};

export interface TableExportSessionOption {
  id: string;
  name: string;
  isCurrent?: boolean;
}

export interface TableExportSession {
  /** Sessions to offer, newest first. */
  options: readonly TableExportSessionOption[];
  /** The session the page is currently showing. */
  value: string | null;
}

export interface TableExportButtonProps<T> {
  ctl: TableControls<T>;
  /** Base of the download's filename, e.g. `"students"`. */
  filename: string;
  /** Heading on the PDF, and the dialog's subject. */
  title: string;
  /**
   * Fields offered in the picker but absent from the table. For a large
   * per-domain set (the ~50 student template fields) build this from that
   * domain's own registry rather than restating it here.
   */
  extraColumns?: TableColumns<T>;
  /**
   * The page's OWN filters — a search box, a tab, a class picker. `ctl` cannot
   * see these, and its rows already have them applied, so without this the
   * file would claim a narrower filter than actually produced it.
   */
  context?: readonly FilterSummaryEntry[];
  /** Ticked rows, when the page has checkboxes. Enables the "selected" scope. */
  selected?: readonly T[];
  /** Enables the academic-session control. */
  session?: TableExportSession;
  /**
   * Route that can rebuild this dataset server-side. Required for datasets
   * whose rows aren't all in the browser (a past session) and for the
   * sensitive ones, which are generated server-side so they can be audited.
   */
  serverRoute?: string;
  /** Always go through `serverRoute`, even for the session on screen. */
  alwaysServer?: boolean;
  /** Audit metadata. Never used for authorization. */
  featureKey?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
}

const FORMATS: ExportFileFormat[] = ["csv", "xlsx", "pdf"];

/** Let React paint the pending state before a big synchronous build blocks it. */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function TableExportButton<T>({
  ctl,
  filename,
  title,
  extraColumns,
  context,
  selected,
  session,
  serverRoute,
  alwaysServer = false,
  featureKey,
  variant = "outline",
  className,
}: TableExportButtonProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [format, setFormat] = React.useState<ExportFileFormat>("csv");
  const [scope, setScope] = React.useState<"filtered" | "selected">("filtered");
  const [sessionId, setSessionId] = React.useState<string | null>(
    session?.value ?? null
  );
  const [keys, setKeys] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  // Merged in its own memo: `useTableControls` memoises its filter and sort
  // passes on the identity of `columns`, so handing it (or anything derived
  // from it) a fresh object each render would defeat those memos.
  const columns = React.useMemo<TableColumns<T>>(
    () => ({ ...ctl.columns, ...(extraColumns ?? {}) }),
    [ctl.columns, extraColumns]
  );

  const allKeys = React.useMemo(() => exportableKeys(columns), [columns]);
  const defaults = React.useMemo(() => defaultExportKeys(columns), [columns]);

  // Reset on open rather than on mount, so a picker the admin customised for
  // one download does not silently carry into an unrelated later one.
  React.useEffect(() => {
    if (open) setKeys(defaults);
  }, [open, defaults]);

  const selectedRows = React.useMemo(
    () => (scope === "selected" ? [...(selected ?? [])] : ctl.rows),
    [scope, selected, ctl.rows]
  );

  const sessionChanged =
    !!session && sessionId !== null && sessionId !== session.value;

  const summary = React.useMemo<FilterSummaryEntry[]>(
    () =>
      // Switching to a session the browser never loaded rebuilds the whole of
      // it on the server; this page's filters were never applied to it. So the
      // summary is dropped rather than carried — it feeds the filename and the
      // PDF's provenance line, and a document claiming a filter that did not
      // run is worse than one claiming none.
      sessionChanged ? [] : [...(context ?? []), ...ctl.filterSummary],
    [sessionChanged, context, ctl.filterSummary]
  );
  const needsServer = alwaysServer || sessionChanged;
  const serverUnavailable = needsServer && !serverRoute;

  const orderedKeys = allKeys.filter((k) => keys.includes(k));
  const rowCount = selectedRows.length;
  const columnCount = orderedKeys.length;

  const pdfTooWide = columnCount > PDF_MAX_COLUMNS;
  const pdfTooLong = rowCount > PDF_MAX_ROWS;
  const pdfBlockedReason = pdfTooWide
    ? `PDF holds at most ${PDF_MAX_COLUMNS} columns — ${columnCount} are ticked. Untick some, or export to Excel.`
    : pdfTooLong
      ? `PDF holds at most ${PDF_MAX_ROWS.toLocaleString("en-IN")} rows — this is ${rowCount.toLocaleString("en-IN")}. Narrow the filter, or export to Excel.`
      : null;

  const sessionLabel = session?.options.find((o) => o.id === sessionId)?.name;

  const resolvedName = React.useMemo(
    () =>
      exportFilename(filename, [
        ...(sessionLabel ? [sessionLabel] : []),
        ...summary.map((s) => `${s.label} ${s.value}`),
      ]),
    [filename, sessionLabel, summary]
  );

  const toggleKey = (key: string) =>
    setKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  async function runLocalExport() {
    const exportColumns = resolveExportColumns(columns, { keys: orderedKeys });
    const matrix = buildExportMatrix(selectedRows, exportColumns);
    const headers = exportColumns.map((c) => c.header);

    if (format === "csv") {
      downloadBlob(csvBlob(toCsv(headers, matrix)), `${resolvedName}.csv`);
      return rowCount;
    }

    if (format === "xlsx") {
      const { buildXlsxBlob } = await import("@nkps/shared/lib/table-export-xlsx");
      const blob = await buildXlsxBlob(exportColumns, matrix, { sheetName: title });
      downloadBlob(blob, `${resolvedName}.xlsx`);
      return rowCount;
    }

    const response = await adminFetch(TABLE_PDF_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        subtitle: sessionLabel ? `Academic session ${sessionLabel}` : undefined,
        filterSummary: summary,
        headers,
        aligns: exportAligns(exportColumns),
        rows: matrixToText(matrix),
        orientation: "auto",
        filename: resolvedName,
        sourcePath:
          typeof window === "undefined" ? undefined : window.location.pathname,
        featureKey,
      }),
    });
    if (!response.ok) {
      throw new Error(
        (await response.json().catch(() => null))?.error ?? "Could not build the PDF"
      );
    }
    downloadBlob(await response.blob(), `${resolvedName}.pdf`);
    return rowCount;
  }

  async function runServerExport() {
    // Name the rows outright whenever the browser has them. Restating the
    // filters instead would leave the file's contents depending on the server
    // reaching the same conclusion as the table — and the two would drift the
    // first time a page gained a filter the route did not know about.
    const ids = sessionChanged
      ? undefined
      : selectedRows
          .map((row) => (row as { id?: string }).id)
          .filter((id): id is string => typeof id === "string");

    const response = await adminFetch(serverRoute as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        fields: orderedKeys,
        academic_year_id: sessionId,
        title,
        filename: resolvedName,
        filterSummary: summary,
        row_ids: ids && ids.length > 0 ? ids : undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(
        (await response.json().catch(() => null))?.error ?? "Export failed"
      );
    }
    const omitted = response.headers.get("X-Export-Omitted-Fields");
    downloadBlob(await response.blob(), `${resolvedName}.${format}`);
    if (omitted && Number(omitted) > 0) {
      toast.info(
        `${omitted} admin-only field${Number(omitted) === 1 ? "" : "s"} omitted from this export.`
      );
    }
    return Number(response.headers.get("X-Export-Row-Count") ?? rowCount);
  }

  async function handleDownload() {
    if (columnCount === 0) {
      toast.error("Pick at least one column.");
      return;
    }
    setBusy(true);
    try {
      await yieldToPaint();
      const count = needsServer ? await runServerExport() : await runLocalExport();
      setOpen(false);
      toast.success(
        `Downloaded ${count.toLocaleString("en-IN")} row${count === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  const disabledReason =
    rowCount === 0
      ? "Nothing to export — the current filters match no rows."
      : serverUnavailable
        ? "A past session can only be exported from a page wired to the server export."
        : format === "pdf"
          ? pdfBlockedReason
          : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={variant} className={cn("gap-2", className)} />}
      >
        <Download className="h-4 w-4" />
        Export
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export {title.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Downloads every row matching the filters below — not just the page
            on screen.
          </DialogDescription>
        </DialogHeader>

        <Field label="Format">
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                  format === f
                    ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-input text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-muted"
                )}
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {FORMAT_HINTS[format]}
          </p>
        </Field>

        {session && session.options.length > 0 && (
          <Field label="Academic session">
            <Select
              value={sessionId ?? ""}
              items={session.options.map((o) => ({
                value: o.id,
                label: o.isCurrent ? `${o.name} (current)` : o.name,
              }))}
              onValueChange={(value) => setSessionId((value as string) || null)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {session.options.map((o) => (
                  <SelectItem
                    key={o.id}
                    value={o.id}
                    label={o.isCurrent ? `${o.name} (current)` : o.name}
                  >
                    {o.isCurrent ? `${o.name} (current)` : o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sessionChanged && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                Exports the whole {sessionLabel ?? "selected"} session, rebuilt
                on the server — the filters on this page do not apply to it, and
                it includes anyone who has since left. To filter another session,
                switch to it at the top of the page instead.
              </p>
            )}
          </Field>
        )}

        {selected && selected.length > 0 && !sessionChanged && (
          <Field label="Rows">
            <div className="flex flex-col gap-1.5">
              <Radio
                checked={scope === "filtered"}
                onSelect={() => setScope("filtered")}
                label={`All ${ctl.rows.length.toLocaleString("en-IN")} filtered rows`}
              />
              <Radio
                checked={scope === "selected"}
                onSelect={() => setScope("selected")}
                label={`${selected.length.toLocaleString("en-IN")} ticked rows only`}
              />
            </div>
          </Field>
        )}

        <Field label={`Columns (${columnCount} of ${allKeys.length})`}>
          <div className="mb-2 flex gap-3 text-xs">
            <button
              type="button"
              onClick={() => setKeys(allKeys)}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setKeys(defaults)}
              className="font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Reset
            </button>
          </div>
          <ColumnGroup
            label="Table columns"
            keys={allKeys.filter((k) => !columns[k]?.exportOnly)}
            columns={columns}
            checked={keys}
            onToggle={toggleKey}
          />
          <ColumnGroup
            label="More fields"
            keys={allKeys.filter((k) => columns[k]?.exportOnly)}
            columns={columns}
            checked={keys}
            onToggle={toggleKey}
          />
        </Field>

        {summary.length > 0 && (
          <Field label="Filters applied">
            <ul className="flex flex-wrap gap-1.5">
              {summary.map((entry) => (
                <li
                  key={`${entry.label}:${entry.value}`}
                  className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {entry.label}: {entry.value}
                </li>
              ))}
            </ul>
          </Field>
        )}

        {disabledReason && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {disabledReason}
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {resolvedName}.{format}
          </span>
          <Button onClick={handleDownload} disabled={busy || !!disabledReason}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200"
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-blue-600" : "border-input"
        )}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-blue-600" />}
      </span>
      {label}
    </button>
  );
}

function ColumnGroup<T>({
  label,
  keys,
  columns,
  checked,
  onToggle,
}: {
  label: string;
  keys: string[];
  columns: TableColumns<T>;
  checked: string[];
  onToggle: (key: string) => void;
}) {
  if (keys.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <div className="grid max-h-52 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2">
        {keys.map((key) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-muted"
          >
            <Checkbox
              checked={checked.includes(key)}
              onCheckedChange={() => onToggle(key)}
            />
            <span className="truncate">
              {columns[key]?.exportLabel ?? columns[key]?.label ?? key}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
