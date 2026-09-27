"use client"

import * as React from "react"

import { cn } from "@nkps/shared/lib/utils"
import { useIsMobile } from "@nkps/shared/hooks/useMediaQuery"
import {
  ColumnResizeHandle,
  TableHeaderContext,
  TableResizeContext,
  useColumnResize,
} from "@nkps/shared/components/ui/table-column-resize"

export interface TableProps extends React.ComponentProps<"table"> {
  /** Set false for a layout table where dragging column edges is meaningless. */
  resizable?: boolean
  /**
   * Scopes remembered column widths. Defaults to the current pathname, which
   * is right for a page's one main table; name it when a route shows several
   * tables that happen to share their header labels.
   */
  tableId?: string
}

function Table({
  className,
  style,
  children,
  resizable = true,
  tableId,
  ...props
}: TableProps) {
  const tableRef = React.useRef<HTMLTableElement>(null)
  // Column resizing is off below `lg`, and so is adopting the widths it saved.
  //
  // The drag handles are pointer-edge targets a few pixels wide, which no
  // finger can hit — but the real problem is the restore: widths are measured
  // on whatever screen did the dragging and persisted per pathname, so a table
  // sized on a desktop came back pinned to that pixel width on the phone, where
  // it could then never reflow. A phone gets the table's natural layout.
  const isMobile = useIsMobile()
  const { colgroup, tableStyle, sized, controls, guideRef } = useColumnResize({
    enabled: resizable && !isMobile,
    tableRef,
    tableId,
  })

  return (
    <TableResizeContext.Provider value={controls}>
      <div
        data-slot="table-container"
        // overscroll-x-contain so swiping a wide table sideways doesn't also
        // trigger the browser's back gesture.
        className="relative w-full overflow-x-auto overscroll-x-contain"
      >
        <table
          ref={tableRef}
          data-slot="table"
          data-sized={sized ? "true" : undefined}
          className={cn(
            "w-full caption-bottom text-sm",
            // Once the columns carry explicit widths, a cell has to stay
            // inside its own: without this, narrowing a column just spills
            // its `whitespace-nowrap` content across the neighbour.
            sized &&
              "[&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis",
            className
          )}
          style={{ ...style, ...tableStyle }}
          {...props}
        >
          {colgroup}
          {children}
        </table>
        {/* Drop line following the column edge under the pointer. Positioned
            imperatively during the drag, so it is not React-rendered state. */}
        <div
          ref={guideRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-20 hidden w-px bg-blue-500"
        />
      </div>
    </TableResizeContext.Provider>
  )
}

function TableHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-gray-100 dark:[&_tr]:border-border bg-gray-50/60 dark:bg-muted/50", className)}
      {...props}
    >
      <TableHeaderContext.Provider value={true}>
        {children}
      </TableHeaderContext.Provider>
    </thead>
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-gray-100 dark:border-border transition-colors duration-150 hover:bg-cream-50/50 dark:hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  children,
  ...props
}: React.ComponentProps<"th">) {
  const cellRef = React.useRef<HTMLTableCellElement>(null)
  const controls = React.useContext(TableResizeContext)
  const inHeader = React.useContext(TableHeaderContext)
  const resizable = !!controls && inHeader

  return (
    <th
      ref={cellRef}
      data-slot="table-head"
      className={cn(
        "relative h-11 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-gray-500 dark:text-gray-400 [&:has([role=checkbox])]:pr-0",
        // Column separator. Sits a shade above the body rule so the edge you
        // grab to resize reads as a target rather than as ruling.
        "border-r border-gray-200/70 last:border-r-0 dark:border-border/70",
        className
      )}
      {...props}
    >
      {children}
      {resizable && (
        <ColumnResizeHandle cellRef={cellRef} controls={controls} />
      )}
    </th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-3 align-middle whitespace-nowrap text-sm [&:has([role=checkbox])]:pr-0",
        // Barely-there rule so the eye can follow a column down the page
        // without the table turning into a grid.
        "border-r border-gray-100/90 last:border-r-0 dark:border-border/40",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
