"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, Star, CalendarDays } from "lucide-react";
import { adminApi, adminFetch, fetchRowDependencies } from "@nkps/shared/lib/admin-api";
import { describeDependencies } from "@nkps/shared/lib/row-dependencies";
import type { AcademicYear } from "@nkps/shared/types";

/** Per-session headline numbers, keyed by academic_year_id. */
type SessionStats = Record<
  string,
  {
    students: number;
    classes: number;
    left: number;
    collected: number | null;
  }
>;

export default function AdminAcademicYearsPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [stats, setStats] = useState<SessionStats>({});
  const [unattributedPayments, setUnattributedPayments] = useState(0);
  // False for an editor without the `fees` grant: the column is then absent
  // rather than shown full of dashes, which would read as "nothing collected".
  const [showFees, setShowFees] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const supabase = createClient();

  const fetchYears = async () => {
    const { data, error } = await supabase
      .from("academic_years")
      .select("*")
      .order("start_date", { ascending: false });

    if (error) {
      toast.error("Failed to fetch academic years");
      return;
    }

    setYears((data as AcademicYear[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchYears();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setName("");
    setStartDate("");
    setEndDate("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) {
      toast.error("All fields are required");
      return;
    }
    setSubmitting(true);

    const result = await adminApi({
      action: "insert",
      table: "academic_years",
      data: {
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
        is_current: false,
      },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to create academic year");
    } else {
      toast.success("Academic year created successfully");
      setDialogOpen(false);
      resetForm();
      await fetchYears();
    }

    setSubmitting(false);
  };

  const handleSetCurrent = async (id: string) => {
    // First, unset all as not current
    // We need to update each year individually via the proxy
    for (const year of years) {
      if (year.is_current) {
        await adminApi({
          action: "update",
          table: "academic_years",
          data: { is_current: false },
          match: { column: "id", value: year.id },
        });
      }
    }

    // Set selected as current
    const result = await adminApi({
      action: "update",
      table: "academic_years",
      data: { is_current: true },
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to set as current");
      return;
    }

    toast.success("Academic year set as current");
    await fetchYears();
  };

  // A year is the spine of every record filed under it, and most of those FKs
  // have no ON DELETE action at all — the delete used to just fail with
  // "Failed to delete academic year" and no reason. Name the reason.
  const handleDelete = async (year: AcademicYear) => {
    if (year.is_current) {
      toast.error(
        `${year.name} is the current academic year. Make another year current before deleting this one.`
      );
      return;
    }

    const deps = await fetchRowDependencies("academic_years", year.id);
    if (deps && deps.blockingTotal > 0) {
      toast.error(
        `${year.name} still has ${describeDependencies(deps.blocking)} filed under it. A year that has been used cannot be deleted — it is the historical record.`,
        { duration: 10000 }
      );
      return;
    }

    const willRemove = deps ? describeDependencies(deps.cascade) : "";
    if (
      !confirm(
        `Delete the academic year "${year.name}"?${willRemove ? `\n\nThis also removes ${willRemove}.` : ""}\n\nThis cannot be undone.`
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "academic_years",
      match: { column: "id", value: year.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to delete academic year", { duration: 10000 });
      return;
    }

    toast.success("Academic year deleted");
    await fetchYears();
  };

  const openEdit = (year: AcademicYear) => {
    setEditingYear(year);
    setName(year.name);
    setStartDate(year.start_date);
    setEndDate(year.end_date);
    setEditDialogOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingYear || !name.trim() || !startDate || !endDate) {
      toast.error("All fields are required");
      return;
    }
    setSubmitting(true);

    const result = await adminApi({
      action: "update",
      table: "academic_years",
      data: {
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
      },
      match: { column: "id", value: editingYear.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to update");
    } else {
      toast.success("Academic year updated");
      setEditDialogOpen(false);
      setEditingYear(null);
      await fetchYears();
    }
    setSubmitting(false);
  };

  // The archive numbers. Fetched separately from the year rows so a failure
  // here leaves the page usable — the list of sessions is the point, the
  // counts are the enrichment.
  useEffect(() => {
    let cancelled = false;
    adminFetch("/api/academic-years/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data) return;
        const next: SessionStats = {};
        for (const row of json.data as {
          academic_year_id: string;
          students: number;
          classes: number;
          left: number;
          collected: number | null;
        }[]) {
          next[row.academic_year_id] = {
            students: row.students,
            classes: row.classes,
            left: row.left,
            collected: row.collected,
          };
        }
        setStats(next);
        setUnattributedPayments(json.unattributed_payments ?? 0);
        setShowFees(Boolean(json.includes_fees));
      })
      .catch(() => {
        // Non-fatal: the sessions still list, just without their numbers.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Header sort/filter accessors — mirror what the matching cell renders.
  const columns = useMemo<TableColumns<AcademicYear>>(
    () => ({
      name: { label: "Name", value: (y) => y.name, filter: "text" },
      start_date: {
        label: "Start Date",
        value: (y) => new Date(y.start_date).toLocaleDateString(),
        sortValue: (y) => new Date(y.start_date).getTime(),
      },
      end_date: {
        label: "End Date",
        value: (y) => new Date(y.end_date).toLocaleDateString(),
        sortValue: (y) => new Date(y.end_date).getTime(),
      },
      status: {
        label: "Status",
        value: (y) => (y.is_current ? "Current" : null),
        emptyLabel: "Past",
      },
      // The archive figures. Sortable, so "which was our biggest intake?" is
      // one click rather than a spreadsheet.
      students: {
        label: "Students",
        value: (y) => stats[y.id]?.students ?? null,
        sortValue: (y) => stats[y.id]?.students ?? -1,
        exportFormat: "number",
        emptyLabel: "—",
      },
      classes: {
        label: "Classes",
        value: (y) => stats[y.id]?.classes ?? null,
        sortValue: (y) => stats[y.id]?.classes ?? -1,
        exportFormat: "number",
        emptyLabel: "—",
      },
      left: {
        label: "Left",
        value: (y) => stats[y.id]?.left ?? null,
        sortValue: (y) => stats[y.id]?.left ?? -1,
        exportFormat: "number",
        emptyLabel: "—",
      },
      ...(showFees
        ? {
            collected: {
              label: "Fees Collected",
              value: (y: AcademicYear) =>
                stats[y.id]?.collected == null
                  ? null
                  : new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 0,
                    }).format(stats[y.id].collected as number),
              sortValue: (y: AcademicYear) => stats[y.id]?.collected ?? -1,
              exportFormat: "currency" as const,
              emptyLabel: "—",
            },
          }
        : {}),
    }),
    [stats, showFees]
  );

  const table = useTableControls({ rows: years, columns });

  return (
    <div>
      <div className="erp-page-bar mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Academic Sessions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Every session the school has run, with its headline numbers. Open a
            session name to work in that year&apos;s records.
            {showFees && unattributedPayments > 0 && (
              <>
                {" "}
                <span className="text-amber-700 dark:text-amber-400">
                  {unattributedPayments} payment
                  {unattributedPayments === 1 ? "" : "s"} carry no session and
                  are excluded from the collected totals.
                </span>
              </>
            )}
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setDialogOpen(true);
          }}
          className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Academic Year
        </Button>
      </div>

      <div className="erp-table-container p-4 sm:p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : years.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            No academic years found. Add one to get started.
          </p>
        ) : (
          <>
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <TableFilterSummary
              ctl={table}
              total={years.length}
              shown={table.rows.length}
              className="mb-0 mr-auto"
            />
            <TableExportButton
              ctl={table}
              filename="academic-years"
              title="Academic Years"
              featureKey="academic_years"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <SortFilterHead ctl={table} col="name" />
                <SortFilterHead ctl={table} col="start_date" />
                <SortFilterHead ctl={table} col="end_date" />
                <SortFilterHead ctl={table} col="status" />
                <SortFilterHead ctl={table} col="students" align="right" />
                <SortFilterHead ctl={table} col="classes" align="right" />
                <SortFilterHead ctl={table} col="left" align="right" />
                {showFees && (
                  <SortFilterHead ctl={table} col="collected" align="right" />
                )}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showFees ? 9 : 8} className="py-10 text-center text-gray-500 dark:text-gray-400">
                    No years match the column filters.
                  </TableCell>
                </TableRow>
              )}
              {table.rows.map((year) => (
                <TableRow key={year.id}>
                  <TableCell className="font-medium">
                    {/* The session name is the way into that session: the
                        students list opens already scoped to it, which is what
                        makes this an archive rather than a list of dates. */}
                    <Link
                      href={`/people/students?session=${year.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      title={`Open the ${year.name} student list`}
                    >
                      {year.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {new Date(year.start_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {new Date(year.end_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {year.is_current ? (
                      <Badge
                        variant="secondary"
                        className="bg-gold-300/30 text-gold-600"
                      >
                        Current
                      </Badge>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stats[year.id]?.students ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {stats[year.id]?.classes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stats[year.id] === undefined ? (
                      "—"
                    ) : stats[year.id].left > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {stats[year.id].left}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">0</span>
                    )}
                  </TableCell>
                  {showFees && (
                    <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {stats[year.id]?.collected == null
                        ? "—"
                        : new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency: "INR",
                            maximumFractionDigits: 0,
                          }).format(stats[year.id].collected as number)}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!year.is_current && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetCurrent(year.id)}
                          className="gap-1"
                        >
                          <Star className="h-3 w-3" />
                          Set Current
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit academic year"
                        onClick={() => openEdit(year)}
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete academic year"
                        onClick={() => handleDelete(year)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </div>

      {/* Add Academic Year Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <CalendarDays className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <DialogTitle>Add Academic Year</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Define a new academic year period</p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="yearName" className="text-xs font-medium">Name</Label>
              <Input
                id="yearName"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2025-26"
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="startDate" className="text-xs font-medium">Start Date</Label>
                <Input
                  id="startDate"
                  className="h-9"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="endDate" className="text-xs font-medium">End Date</Label>
                <Input
                  id="endDate"
                  className="h-9"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Edit Academic Year Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>Edit Academic Year</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Update academic year details</p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="editYearName" className="text-xs font-medium">Name</Label>
              <Input
                id="editYearName"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2025-26"
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="editStartDate" className="text-xs font-medium">Start Date</Label>
                <Input
                  id="editStartDate"
                  className="h-9"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="editEndDate" className="text-xs font-medium">End Date</Label>
                <Input
                  id="editEndDate"
                  className="h-9"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Update
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
