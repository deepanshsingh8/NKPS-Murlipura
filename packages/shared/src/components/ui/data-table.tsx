"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronsUpDown,
  ListFilter,
  Search,
  X,
} from "lucide-react";

import { cn } from "@nkps/shared/lib/utils";
import { TableHead } from "@nkps/shared/components/ui/table";

// ---------------------------------------------------------------------------
// Excel-style sorting + per-column filtering for the plain JSX tables used
// across the admin app.
//
// The tables here are hand-written `<Table>`/`<TableRow>` markup with bespoke
// cell rendering, so a full headless-table library would mean rewriting every
// list page. Instead `useTableControls` takes a map of column *accessors*
// (how to read the sortable/filterable value out of a row), returns the
// sorted + filtered rows, and `<SortFilterHead>` drops into the header in
// place of `<TableHead>`. Cell rendering is untouched.
//
// The filter panel is portalled to `document.body` and positioned from the
// trigger's bounding box: `.erp-table-container` scrolls horizontally, and an
// absolutely-positioned panel inside it would be clipped.
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

/** `"select"` = checkbox list of the distinct values actually present. */
export type FilterKind = "select" | "text" | "none";

export type CellValue = string | number | boolean | null | undefined;

export interface TableColumnDef<T> {
  /** Header text. Also the label in the filter panel. */
  label: string;
  /**
   * Reads the value used for sorting and filtering. Booleans render as
   * Yes/No; null/undefined/"" become `emptyLabel` in the option list so
   * "not assigned yet" is selectable like any other value.
   */
  value?: (row: T) => CellValue;
  /** Overrides `value` for sorting only (e.g. sort a date column by epoch). */
  sortValue?: (row: T) => CellValue;
  /** Defaults to `"select"` when `value` is given, `"none"` otherwise. */
  filter?: FilterKind;
  /** Defaults to true when `value` is given. */
  sortable?: boolean;
  /** Option-list text for blank values. Default `"—"`. */
  emptyLabel?: string;
}

export type TableColumns<T> = Record<string, TableColumnDef<T>>;

export interface ColumnFilter {
  text: string;
  selected: string[];
}

export interface TableSort {
  key: string;
  dir: SortDir;
}

/** The slice of the controls the header component needs (non-generic). */
export interface TableHeadControls {
  sort: TableSort | null;
  toggleSort: (key: string) => void;
  setSort: (next: TableSort | null) => void;
  getColumnMeta: (key: string) => {
    label: string;
    sortable: boolean;
    filter: FilterKind;
  };
  getFilter: (key: string) => ColumnFilter;
  setFilter: (key: string, next: Partial<ColumnFilter>) => void;
  clearFilter: (key: string) => void;
  optionsFor: (key: string) => string[];
}

export interface TableControls<T> extends TableHeadControls {
  /** Filtered, then sorted. */
  rows: T[];
  /** Number of columns with an active filter. */
  activeFilterCount: number;
  clearFilters: () => void;
}

const EMPTY_FILTER: ColumnFilter = { text: "", selected: [] };

const DEFAULT_EMPTY_LABEL = "—";

function isBlank(v: CellValue): boolean {
  return v === null || v === undefined || v === "";
}

/** Display text for a cell value — the identity used by `select` filters. */
function labelOf<T>(col: TableColumnDef<T>, row: T): string {
  const raw = col.value?.(row);
  if (isBlank(raw)) return col.emptyLabel ?? DEFAULT_EMPTY_LABEL;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

function sortKeyOf<T>(col: TableColumnDef<T>, row: T): string | number | null {
  const raw = (col.sortValue ?? col.value)?.(row);
  if (isBlank(raw)) return null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  return raw as string | number;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Blanks always sort last, in both directions — they're never the answer. */
function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: SortDir
): number {
  if (a === null || b === null) {
    if (a === null && b === null) return 0;
    return a === null ? 1 : -1;
  }
  const c =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return dir === "desc" ? -c : c;
}

function hasActiveFilter(f: ColumnFilter | undefined): boolean {
  return !!f && (f.text.trim() !== "" || f.selected.length > 0);
}

function omitKey<V>(
  source: Record<string, V>,
  key: string
): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k !== key) next[k] = v;
  }
  return next;
}

function seedFilters(
  preset: Record<string, Partial<ColumnFilter>> | undefined
): Record<string, ColumnFilter> {
  const seed: Record<string, ColumnFilter> = {};
  for (const [key, f] of Object.entries(preset ?? {})) {
    seed[key] = { ...EMPTY_FILTER, ...f };
  }
  return seed;
}

export interface UseTableControlsOptions<T> {
  rows: T[];
  columns: TableColumns<T>;
  defaultSort?: TableSort | null;
  /** Preset column filters, e.g. from a dashboard deep-link. */
  initialFilters?: Record<string, Partial<ColumnFilter>>;
  /**
   * Identity of `initialFilters`. The preset is applied once per distinct
   * non-empty value, which matters because a deep-linked preset usually is
   * NOT known at mount: the App Router commits the URL after the target
   * page's first render, so a `?audit=` param read from it arrives a tick
   * late. Seeding state only in the initializer meant those links opened an
   * unfiltered table. Applying per-key also means clearing the filters by
   * hand sticks — the preset does not re-assert itself on the next render.
   */
  presetKey?: string | null;
}

/**
 * Owns the sort + per-column filter state for one table and applies it.
 *
 * `rows` should already have any page-level filtering (the search box, the
 * class picker) applied — this layer sits on top of those.
 */
export function useTableControls<T>({
  rows,
  columns,
  defaultSort = null,
  initialFilters,
  presetKey = null,
}: UseTableControlsOptions<T>): TableControls<T> {
  const [sort, setSort] = React.useState<TableSort | null>(defaultSort);
  const [filters, setFilters] = React.useState<Record<string, ColumnFilter>>(
    () => seedFilters(initialFilters)
  );

  const appliedPreset = React.useRef<string | null>(presetKey);
  React.useEffect(() => {
    if (!presetKey || appliedPreset.current === presetKey) return;
    appliedPreset.current = presetKey;
    setFilters(seedFilters(initialFilters));
  }, [presetKey, initialFilters]);

  // Callers build `columns` inside their own `useMemo`, so it is a stable
  // reference and the memos below can depend on it directly.
  const getColumn = React.useCallback(
    (key: string): TableColumnDef<T> | undefined => columns[key],
    [columns]
  );

  /** Rows passing every active filter except (optionally) one column's. */
  const rowsPassing = React.useCallback(
    (source: T[], exceptKey?: string) => {
      const active = Object.entries(filters).filter(
        ([key, f]) => hasActiveFilter(f) && key !== exceptKey
      );
      if (active.length === 0) return source;
      return source.filter((row) =>
        active.every(([key, f]) => {
          const col = columns[key];
          if (!col) return true;
          const label = labelOf(col, row);
          if (f.selected.length > 0 && !f.selected.includes(label)) return false;
          const q = f.text.trim().toLowerCase();
          if (q && !label.toLowerCase().includes(q)) return false;
          return true;
        })
      );
    },
    [filters, columns]
  );

  const filteredRows = React.useMemo(
    () => rowsPassing(rows),
    [rows, rowsPassing]
  );

  const sortedRows = React.useMemo(() => {
    if (!sort) return filteredRows;
    const col = columns[sort.key];
    if (!col) return filteredRows;
    // Copy before sorting so the caller's own array is never reordered.
    // Array#sort is stable, which keeps the incoming order as the tiebreaker.
    return [...filteredRows].sort((a, b) =>
      compareValues(sortKeyOf(col, a), sortKeyOf(col, b), sort.dir)
    );
  }, [filteredRows, sort, columns]);

  const optionsFor = React.useCallback(
    (key: string): string[] => {
      const col = columns[key];
      if (!col?.value) return [];
      const seen = new Set<string>();
      for (const row of rowsPassing(rows, key)) seen.add(labelOf(col, row));
      // Also keep already-selected values visible even if the other filters
      // now exclude them — otherwise unchecking one is impossible.
      for (const v of filters[key]?.selected ?? []) seen.add(v);
      const empty = col.emptyLabel ?? DEFAULT_EMPTY_LABEL;
      return Array.from(seen).sort((a, b) => {
        if (a === empty) return 1;
        if (b === empty) return -1;
        return collator.compare(a, b);
      });
    },
    [rows, rowsPassing, filters, columns]
  );

  const getColumnMeta = React.useCallback(
    (key: string) => {
      const col = getColumn(key);
      const hasValue = !!col?.value;
      return {
        label: col?.label ?? key,
        sortable: col?.sortable ?? hasValue,
        filter: col?.filter ?? (hasValue ? ("select" as const) : ("none" as const)),
      };
    },
    [getColumn]
  );

  const getFilter = React.useCallback(
    (key: string): ColumnFilter => filters[key] ?? EMPTY_FILTER,
    [filters]
  );

  const setFilter = React.useCallback(
    (key: string, next: Partial<ColumnFilter>) => {
      setFilters((prev) => {
        const merged = { ...EMPTY_FILTER, ...prev[key], ...next };
        if (!hasActiveFilter(merged)) {
          if (!prev[key]) return prev;
          return omitKey(prev, key);
        }
        return { ...prev, [key]: merged };
      });
    },
    []
  );

  const clearFilter = React.useCallback((key: string) => {
    setFilters((prev) => (prev[key] ? omitKey(prev, key) : prev));
  }, []);

  const clearFilters = React.useCallback(() => setFilters({}), []);

  const toggleSort = React.useCallback((key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);

  const activeFilterCount = React.useMemo(
    () => Object.values(filters).filter(hasActiveFilter).length,
    [filters]
  );

  return {
    rows: sortedRows,
    sort,
    toggleSort,
    setSort,
    getColumnMeta,
    getFilter,
    setFilter,
    clearFilter,
    optionsFor,
    activeFilterCount,
    clearFilters,
  };
}

// ---------------------------------------------------------------------------
// Header cell
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 248;

interface PanelPosition {
  top: number;
  left: number;
  maxHeight: number;
}

function computePosition(anchor: HTMLElement): PanelPosition {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(r.left, window.innerWidth - PANEL_WIDTH - margin)
  );
  const below = window.innerHeight - r.bottom - margin;
  const above = r.top - margin;
  // Flip above the header when there's clearly more room up there.
  if (below < 240 && above > below) {
    return { top: Math.max(margin, r.top - Math.min(above, 380) - 4), left, maxHeight: Math.min(above, 380) };
  }
  return { top: r.bottom + 4, left, maxHeight: Math.min(Math.max(below, 180), 380) };
}

export interface SortFilterHeadProps
  extends Omit<React.ComponentProps<"th">, "children"> {
  ctl: TableHeadControls;
  /** Key into the `columns` map passed to `useTableControls`. */
  col: string;
  /** Overrides the column's `label` for display only. */
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
}

export function SortFilterHead({
  ctl,
  col,
  children,
  align = "left",
  className,
  ...props
}: SortFilterHeadProps) {
  const meta = ctl.getColumnMeta(col);
  const filter = ctl.getFilter(col);
  const active = hasActiveFilter(filter);
  const sorted = ctl.sort?.key === col ? ctl.sort.dir : null;

  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<PanelPosition | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");

  const reposition = React.useCallback(() => {
    if (triggerRef.current) setPosition(computePosition(triggerRef.current));
  }, []);

  React.useEffect(() => {
    if (!open) return;
    reposition();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // Capture phase so scrolling any ancestor (the table's own overflow
    // container included) keeps the panel glued to its header.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const options = open && meta.filter === "select" ? ctl.optionsFor(col) : [];
  const trimmedQuery = query.trim().toLowerCase();
  const visibleOptions = trimmedQuery
    ? options.filter((o) => o.toLowerCase().includes(trimmedQuery))
    : options;

  const toggleOption = (value: string) => {
    const next = filter.selected.includes(value)
      ? filter.selected.filter((v) => v !== value)
      : [...filter.selected, value];
    ctl.setFilter(col, { selected: next });
  };

  const label = children ?? meta.label;
  const interactive = meta.sortable || meta.filter !== "none";

  return (
    <TableHead
      className={cn(align === "right" && "text-right", className)}
      aria-sort={
        sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined
      }
      {...props}
    >
      <div
        ref={triggerRef}
        className={cn(
          "flex items-center gap-1",
          align === "right" && "justify-end",
          align === "center" && "justify-center"
        )}
      >
        {meta.sortable ? (
          <button
            type="button"
            onClick={() => ctl.toggleSort(col)}
            title={`Sort by ${meta.label}`}
            className="group inline-flex items-center gap-1 rounded text-inherit uppercase tracking-wider hover:text-navy-900 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span>{label}</span>
            {sorted === "asc" ? (
              <ArrowUpAZ className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            ) : sorted === "desc" ? (
              <ArrowDownAZ className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            ) : (
              // Kept faintly visible rather than hover-only: on touch there is
              // no hover, and the arrow is the only cue the header sorts.
              <ChevronsUpDown className="h-3 w-3 opacity-30 transition-opacity group-hover:opacity-70" />
            )}
          </button>
        ) : (
          <span>{label}</span>
        )}

        {meta.filter !== "none" && (
          <button
            type="button"
            onClick={() => {
              // Clearing here rather than in an effect keeps the reset out of
              // the render cascade — the panel always opens on a fresh search.
              setQuery("");
              setOpen((v) => !v);
            }}
            aria-label={`Filter by ${meta.label}`}
            aria-expanded={open}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active || open
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                : "text-gray-400 hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-gray-700/60 dark:hover:text-gray-200"
            )}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && position && interactive && (
        <FilterPanel
          ref={panelRef}
          position={position}
          title={meta.label}
          kind={meta.filter}
          sorted={sorted}
          sortable={meta.sortable}
          onSort={(dir) =>
            ctl.setSort(dir === null ? null : { key: col, dir })
          }
          filter={filter}
          options={visibleOptions}
          totalOptions={options.length}
          query={query}
          onQueryChange={setQuery}
          onToggleOption={toggleOption}
          onSelectAll={() => ctl.setFilter(col, { selected: [...options] })}
          onTextChange={(text) => ctl.setFilter(col, { text })}
          onClear={() => ctl.clearFilter(col)}
          onClose={() => setOpen(false)}
        />
      )}
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Filter panel (portalled)
// ---------------------------------------------------------------------------

interface FilterPanelProps {
  position: PanelPosition;
  title: string;
  kind: FilterKind;
  sortable: boolean;
  sorted: SortDir | null;
  onSort: (dir: SortDir | null) => void;
  filter: ColumnFilter;
  options: string[];
  totalOptions: number;
  query: string;
  onQueryChange: (q: string) => void;
  onToggleOption: (value: string) => void;
  onSelectAll: () => void;
  onTextChange: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** Nothing ever invalidates the client-only snapshot, so this never fires. */
const subscribeNoop = () => () => {};

const FilterPanel = React.forwardRef<HTMLDivElement, FilterPanelProps>(
  function FilterPanel(
    {
      position,
      title,
      kind,
      sortable,
      sorted,
      onSort,
      filter,
      options,
      totalOptions,
      query,
      onQueryChange,
      onToggleOption,
      onSelectAll,
      onTextChange,
      onClear,
      onClose,
    },
    ref
  ) {
    // `document` only exists in the browser. useSyncExternalStore reports
    // "server render" without the setState-in-effect cascade a mounted flag
    // would cost.
    const canPortal = React.useSyncExternalStore(
      subscribeNoop,
      () => true,
      () => false
    );
    if (!canPortal) return null;

    const active = hasActiveFilter(filter);

    return createPortal(
      <div
        ref={ref}
        role="dialog"
        aria-label={`${title} sort and filter`}
        style={{
          top: position.top,
          left: position.left,
          width: PANEL_WIDTH,
          maxHeight: position.maxHeight,
        }}
        className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <span className="truncate text-xs font-semibold text-navy-900 dark:text-white">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {sortable && (
          <div className="flex gap-1 border-b border-gray-100 p-2 dark:border-gray-800">
            <PanelSortButton
              active={sorted === "asc"}
              onClick={() => onSort(sorted === "asc" ? null : "asc")}
              icon={<ArrowUpAZ className="h-3.5 w-3.5" />}
              label="Asc"
            />
            <PanelSortButton
              active={sorted === "desc"}
              onClick={() => onSort(sorted === "desc" ? null : "desc")}
              icon={<ArrowDownAZ className="h-3.5 w-3.5" />}
              label="Desc"
            />
          </div>
        )}

        {kind === "text" && (
          <div className="p-2">
            <input
              autoFocus
              value={filter.text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={`Contains…`}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        )}

        {kind === "select" && (
          <>
            {totalOptions > 8 && (
              <div className="relative p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Search values…"
                  className="h-8 w-full rounded-lg border border-input bg-transparent pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
              {options.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-gray-400">
                  No values
                </p>
              ) : (
                options.map((option) => {
                  const checked = filter.selected.includes(option);
                  return (
                    <button
                      type="button"
                      key={option}
                      onClick={() => onToggleOption(option)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-input"
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{option}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-2 py-1.5 dark:border-gray-800">
          {kind === "select" ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded px-1.5 py-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Select all
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClear}
            disabled={!active}
            className="rounded px-1.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Clear
          </button>
        </div>
      </div>,
      document.body
    );
  }
);

function PanelSortButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared "filters active" chip
// ---------------------------------------------------------------------------

export function TableFilterSummary({
  ctl,
  total,
  shown,
  className,
}: {
  ctl: Pick<TableControls<unknown>, "activeFilterCount" | "clearFilters">;
  total: number;
  shown: number;
  className?: string;
}) {
  if (ctl.activeFilterCount === 0) return null;
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300",
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
        <ListFilter className="h-3 w-3" />
        {ctl.activeFilterCount} column filter
        {ctl.activeFilterCount === 1 ? "" : "s"} · {shown} of {total}
      </span>
      <button
        type="button"
        onClick={ctl.clearFilters}
        className="rounded px-1.5 py-0.5 font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
      >
        Clear all
      </button>
    </div>
  );
}
