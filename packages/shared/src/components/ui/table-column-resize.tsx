"use client";

import * as React from "react";
import { flushSync } from "react-dom";

import { cn } from "@nkps/shared/lib/utils";

// ---------------------------------------------------------------------------
// Drag-to-resize columns for the shared `<Table>`.
//
// Every list page in the ERP writes plain `<Table>`/`<TableHead>` markup, so
// the whole feature lives inside those two components: a page opts in by
// doing nothing. That constraint drives the design below.
//
// Sizing. A table stays in its natural `table-layout: auto` state — pixel
// identical to before this file existed — until the first drag. At that
// moment the rendered header widths are measured and become a `<colgroup>`,
// the layout switches to `fixed`, and the table's width is pinned to the sum
// of the columns so the container scrolls instead of squeezing them. Nothing
// is measured up front, so async row loads never fight a stale snapshot.
//
// Frame budget. A drag mutates the `<col>` elements and the table width
// directly and only commits to React state on pointer-up: re-rendering a
// few-hundred-row table on every pointermove is not a 60fps proposition.
// A layout effect re-asserts the in-flight widths after any render that
// lands mid-drag, so a background data refresh can't snap the column back.
//
// Identity. Widths persist per table in localStorage under a key derived
// from the path plus the header labels — there is no table id to thread
// through 50 call sites, and labels change exactly when the columns do.
// Digits are masked out of the signature so a header carrying a count
// ("Students (204)") doesn't orphan its own saved widths.
// ---------------------------------------------------------------------------

/** Below this a column is unreadable; the drag simply stops. */
const MIN_COLUMN_WIDTH = 48;
const MAX_COLUMN_WIDTH = 900;

/** Keyboard resize step, and the step when Shift is held. */
const NUDGE_STEP = 12;
const NUDGE_STEP_LARGE = 48;

const STORAGE_PREFIX = "nkps.table-columns.v1";

function clampWidth(w: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(w)));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** FNV-1a — short, stable, and never leaves the browser. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function headerRowOf(table: HTMLTableElement | null): HTMLTableRowElement | null {
  return table?.tHead?.rows[0] ?? null;
}

function headerCellsOf(table: HTMLTableElement | null): HTMLTableCellElement[] {
  const row = headerRowOf(table);
  return row ? Array.from(row.cells) : [];
}

/**
 * Storage key for the table as it currently stands, or null when there is
 * nothing worth remembering (no header, or a single column).
 */
function signatureOf(table: HTMLTableElement, tableId?: string): string | null {
  const cells = headerCellsOf(table);
  if (cells.length < 2) return null;
  const labels = cells
    .map((c) =>
      (c.textContent ?? "")
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 32)
    )
    .join("|");
  const scope =
    tableId ?? (typeof window === "undefined" ? "" : window.location.pathname);
  return `${STORAGE_PREFIX}:${scope}:${cells.length}:${hash(labels)}`;
}

function readStored(key: string, count: number): number[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== count) return null;
    if (!parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
      return null;
    }
    return (parsed as number[]).map(clampWidth);
  } catch {
    return null;
  }
}

function writeStored(key: string, widths: number[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(widths.map(Math.round)));
  } catch {
    // Private mode / quota — resizing still works, it just won't be remembered.
  }
}

function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See writeStored.
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ColumnResizeControls {
  beginResize: (
    th: HTMLTableCellElement,
    event: React.PointerEvent,
    onEnd: () => void
  ) => void;
  /** Sizes one column to its widest cell, leaving the others alone. */
  autoFit: (th: HTMLTableCellElement) => void;
  nudge: (th: HTMLTableCellElement, delta: number) => void;
  /** Drops every custom width, back to the browser's natural layout. */
  resetAll: () => void;
}

/** Null in a table that opted out, so the handles disappear with it. */
export const TableResizeContext =
  React.createContext<ColumnResizeControls | null>(null);

/** True inside `<TableHeader>`; a `<th>` elsewhere gets no handle. */
export const TableHeaderContext = React.createContext(false);

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface UseColumnResizeOptions {
  enabled: boolean;
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** Overrides the pathname when scoping saved widths. */
  tableId?: string;
}

export interface ColumnResizeResult {
  /** Rendered as the table's first child once widths exist. */
  colgroup: React.ReactNode;
  tableStyle: React.CSSProperties | undefined;
  /** True once the table carries explicit widths. */
  sized: boolean;
  controls: ColumnResizeControls | null;
  /** The vertical line shown at the column edge while dragging. */
  guideRef: React.RefObject<HTMLDivElement | null>;
}

export function useColumnResize({
  enabled,
  tableRef,
  tableId,
}: UseColumnResizeOptions): ColumnResizeResult {
  const [widths, setWidths] = React.useState<number[] | null>(null);

  const widthsRef = React.useRef<number[] | null>(null);
  const colRefs = React.useRef<(HTMLTableColElement | null)[]>([]);
  const guideRef = React.useRef<HTMLDivElement | null>(null);
  const storageKeyRef = React.useRef<string | null>(null);
  const pendingRef = React.useRef<number[] | null>(null);

  React.useLayoutEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  /** Current rendered header widths — the seed for the first drag. */
  const measure = React.useCallback((): number[] | null => {
    const cells = headerCellsOf(tableRef.current);
    if (cells.length === 0) return null;
    return cells.map((c) => c.getBoundingClientRect().width);
  }, [tableRef]);

  /** Writes widths straight to the DOM, bypassing React (see header note). */
  const applyToDom = React.useCallback(
    (next: number[]) => {
      const table = tableRef.current;
      if (!table) return;
      let total = 0;
      for (let i = 0; i < next.length; i++) {
        const w = Math.round(next[i]);
        total += w;
        const col = colRefs.current[i];
        if (col) col.style.width = `${w}px`;
      }
      table.style.tableLayout = "fixed";
      table.style.width = `${total}px`;
    },
    [tableRef]
  );

  const persist = React.useCallback((next: number[]) => {
    if (storageKeyRef.current) writeStored(storageKeyRef.current, next);
  }, []);

  const commit = React.useCallback(
    (next: number[]) => {
      setWidths(next);
      persist(next);
    },
    [persist]
  );

  // Re-assert an in-flight drag after any render it collided with. No dep
  // array: the point is to run on every commit.
  React.useLayoutEffect(() => {
    if (pendingRef.current) applyToDom(pendingRef.current);
  });

  // Adopt saved widths, and notice when the table's own columns change —
  // a toggled admin column or a different exam's marks grid both land here
  // as a new signature, which drops widths that no longer describe anything.
  React.useLayoutEffect(() => {
    if (!enabled || pendingRef.current) return;
    const table = tableRef.current;
    if (!table) return;
    const key = signatureOf(table, tableId);
    if (key === storageKeyRef.current) return;
    storageKeyRef.current = key;
    const count = headerCellsOf(table).length;
    setWidths(key ? readStored(key, count) : null);
  });

  // ── Interactions ─────────────────────────────────────────────────────────

  const moveGuide = React.useCallback(
    (next: number[], index: number) => {
      const guide = guideRef.current;
      const table = tableRef.current;
      if (!guide || !table) return;
      let left = table.offsetLeft;
      for (let i = 0; i <= index; i++) left += Math.round(next[i]);
      guide.style.left = `${left - 1}px`;
      guide.classList.remove("hidden");
    },
    [tableRef]
  );

  const hideGuide = React.useCallback(() => {
    guideRef.current?.classList.add("hidden");
  }, []);

  const beginResize = React.useCallback<ColumnResizeControls["beginResize"]>(
    (th, event, onEnd) => {
      const table = tableRef.current;
      if (!table) return;
      const index = th.cellIndex;
      const base = widthsRef.current ?? measure();
      if (!base || index < 0 || index >= base.length) return;

      event.preventDefault();
      const handle = event.currentTarget as HTMLElement;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the window listeners below carry the drag.
      }

      const startX = event.clientX;
      const start = base.map((w) => Math.round(w));
      let latest = start;

      // The colgroup has to exist before the first pointermove can touch it.
      pendingRef.current = start;
      flushSync(() => setWidths(start));
      applyToDom(start);
      moveGuide(start, index);

      const body = document.body;
      const prevUserSelect = body.style.userSelect;
      const prevCursor = body.style.cursor;
      body.style.userSelect = "none";
      body.style.cursor = "col-resize";

      const onMove = (e: PointerEvent) => {
        const next = start.slice();
        next[index] = clampWidth(start[index] + (e.clientX - startX));
        latest = next;
        pendingRef.current = next;
        applyToDom(next);
        moveGuide(next, index);
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        body.style.userSelect = prevUserSelect;
        body.style.cursor = prevCursor;
        pendingRef.current = null;
        hideGuide();
        commit(latest);
        onEnd();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [tableRef, measure, applyToDom, moveGuide, hideGuide, commit]
  );

  const autoFit = React.useCallback<ColumnResizeControls["autoFit"]>(
    (th) => {
      const table = tableRef.current;
      if (!table) return;
      const index = th.cellIndex;
      const base = widthsRef.current ?? measure();
      if (!base || index < 0 || index >= base.length) return;

      // Let the column size to its content, read it back, and put everything
      // where it was — all within one frame, so nothing is ever painted in
      // the intermediate state.
      const prevLayout = table.style.tableLayout;
      const prevWidth = table.style.width;
      const cols = colRefs.current;
      const prevColWidths = cols.map((c) => c?.style.width ?? "");
      table.style.tableLayout = "auto";
      table.style.width = "max-content";
      for (const col of cols) if (col) col.style.width = "";
      const natural = headerCellsOf(table).map(
        (c) => c.getBoundingClientRect().width
      );
      table.style.tableLayout = prevLayout;
      table.style.width = prevWidth;
      cols.forEach((c, i) => {
        if (c) c.style.width = prevColWidths[i];
      });

      if (natural.length !== base.length) return;
      const next = base.map((w) => Math.round(w));
      next[index] = clampWidth(natural[index]);
      applyToDom(next);
      commit(next);
    },
    [tableRef, measure, applyToDom, commit]
  );

  const nudge = React.useCallback<ColumnResizeControls["nudge"]>(
    (th, delta) => {
      const index = th.cellIndex;
      const base = widthsRef.current ?? measure();
      if (!base || index < 0 || index >= base.length) return;
      const next = base.map((w) => Math.round(w));
      next[index] = clampWidth(next[index] + delta);
      applyToDom(next);
      commit(next);
    },
    [measure, applyToDom, commit]
  );

  const resetAll = React.useCallback(() => {
    const table = tableRef.current;
    if (table) {
      table.style.tableLayout = "";
      table.style.width = "";
    }
    pendingRef.current = null;
    setWidths(null);
    if (storageKeyRef.current) clearStored(storageKeyRef.current);
  }, [tableRef]);

  const controls = React.useMemo<ColumnResizeControls | null>(
    () => (enabled ? { beginResize, autoFit, nudge, resetAll } : null),
    [enabled, beginResize, autoFit, nudge, resetAll]
  );

  // ── Output ───────────────────────────────────────────────────────────────

  React.useLayoutEffect(() => {
    colRefs.current.length = widths?.length ?? 0;
  }, [widths]);

  const colgroup = React.useMemo(() => {
    if (!widths) return null;
    return (
      <colgroup>
        {widths.map((w, i) => (
          // Position is the identity of a column here; there is nothing else
          // to key on, and the list only changes when the table's shape does.
          <col
            key={i}
            ref={(el) => {
              colRefs.current[i] = el;
            }}
            style={{ width: `${Math.round(w)}px` }}
          />
        ))}
      </colgroup>
    );
  }, [widths]);

  const tableStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!widths) return undefined;
    const total = widths.reduce((sum, w) => sum + Math.round(w), 0);
    return { tableLayout: "fixed", width: `${total}px` };
  }, [widths]);

  return { colgroup, tableStyle, sized: widths !== null, controls, guideRef };
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

export interface ColumnResizeHandleProps {
  cellRef: React.RefObject<HTMLTableCellElement | null>;
  controls: ColumnResizeControls;
}

/**
 * The grab strip at a header cell's right edge.
 *
 * It sits *inside* the cell rather than straddling the border: once a table
 * is sized its cells clip their overflow, and anything hanging past the edge
 * would be cut in half.
 */
export function ColumnResizeHandle({
  cellRef,
  controls,
}: ColumnResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      tabIndex={0}
      title="Drag to resize · Double-click to fit contents · Shift + double-click to reset all"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const th = cellRef.current;
        if (!th) return;
        setDragging(true);
        controls.beginResize(th, e, () => setDragging(false));
      }}
      onDoubleClick={(e) => {
        const th = cellRef.current;
        if (!th) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) controls.resetAll();
        else controls.autoFit(th);
      }}
      // The header behind the handle usually sorts on click; a resize is not
      // a sort.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const th = cellRef.current;
        if (!th) return;
        const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          controls.nudge(th, -step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          controls.nudge(th, step);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          controls.autoFit(th);
        }
      }}
      className="group/resize absolute top-0 right-0 z-10 flex h-full w-2 cursor-col-resize touch-none items-stretch justify-end select-none focus-visible:outline-none print:hidden"
    >
      <span
        className={cn(
          "my-1.5 w-0.5 rounded-full transition-colors",
          dragging
            ? "bg-blue-500"
            : "bg-transparent group-hover/resize:bg-blue-500/70 group-focus-visible/resize:bg-blue-500"
        )}
      />
    </div>
  );
}
