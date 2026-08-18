"use client";

import { useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
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
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Bus,
  ExternalLink,
  Check,
  X,
  ArrowRight,
} from "lucide-react";
import { adminFetch, adminPatch } from "@nkps/shared/lib/admin-api";
import type {
  BusStop,
  Bus as BusType,
  TransportChangeType,
  TransportChangeReason,
  TransportChangeStatus,
  TransportDirection,
} from "@nkps/shared/types";

const APPLICATIONS_BUCKET = "transport-applications";

const CHANGE_TYPE_LABELS: Record<TransportChangeType, string> = {
  bus_change: "Bus change",
  stop_change: "Stop change",
  direction_change: "Direction change",
  drop: "Drop transport",
  resume: "Resume transport",
};

const REASON_LABELS: Record<TransportChangeReason, string> = {
  house_shifting: "House shifting",
  rented_house_change: "Rented house change",
  bus_point_temporary_change: "Temporary bus-point change",
  facility_dropped: "Facility dropped",
  one_side_facility: "One-side facility",
  other: "Other",
};

const DIRECTION_LABELS: Record<TransportDirection, string> = {
  both: "Both sides",
  pickup_only: "Pickup only",
  drop_only: "Drop only",
};

const STATUS_STYLES: Record<TransportChangeStatus, string> = {
  pending:
    "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  applied:
    "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  approved:
    "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
  rejected:
    "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
  cancelled:
    "bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700",
};

const CHANGE_TYPE_OPTIONS: TransportChangeType[] = [
  "bus_change",
  "stop_change",
  "direction_change",
  "drop",
  "resume",
];

const REASON_OPTIONS: TransportChangeReason[] = [
  "house_shifting",
  "rented_house_change",
  "bus_point_temporary_change",
  "facility_dropped",
  "one_side_facility",
  "other",
];

const DIRECTION_OPTIONS: TransportDirection[] = [
  "both",
  "pickup_only",
  "drop_only",
];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "applied", label: "Applied" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

interface NamedRef {
  bus_number?: string;
  name?: string;
}

interface ChangeRow {
  id: string;
  change_type: TransportChangeType;
  direction: TransportDirection | null;
  effective_from: string;
  effective_to: string | null;
  reason_code: TransportChangeReason;
  reason_note: string | null;
  source: "office" | "parent";
  status: TransportChangeStatus;
  applicationSignedUrl: string | null;
  enrollment: {
    id: string;
    students: { full_name: string; admission_no: string | null } | null;
  } | null;
  previous_bus: NamedRef | null;
  amended_bus: NamedRef | null;
  previous_stop: NamedRef | null;
  amended_stop: NamedRef | null;
}

interface EnrollmentOption {
  id: string;
  full_name: string;
  admission_no: string | null;
  class_name: string | null;
}

function fromToLabel(row: ChangeRow): React.ReactNode {
  const arrow = (from: string, to: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-gray-500 dark:text-gray-400">{from}</span>
      <ArrowRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      <span className="font-medium text-navy-900 dark:text-white">{to}</span>
    </span>
  );
  switch (row.change_type) {
    case "bus_change":
      return arrow(
        row.previous_bus?.bus_number ?? "—",
        row.amended_bus?.bus_number ?? "—"
      );
    case "stop_change":
      return arrow(
        row.previous_stop?.name ?? "—",
        row.amended_stop?.name ?? "—"
      );
    case "direction_change":
      return row.direction ? DIRECTION_LABELS[row.direction] : "—";
    case "drop":
      return <span className="text-gray-500 dark:text-gray-400">Transport dropped</span>;
    case "resume":
      return <span className="text-gray-500 dark:text-gray-400">Transport resumed</span>;
    default:
      return "—";
  }
}

function effectiveLabel(row: ChangeRow): string {
  if (!row.effective_to) return `${row.effective_from} — Permanent`;
  return `${row.effective_from} → ${row.effective_to}`;
}

export default function TransportChangesPage() {
  const supabase = createClient();

  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // Dropdown data
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [buses, setBuses] = useState<BusType[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentOption[]>([]);

  // Record-change dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [changeType, setChangeType] = useState<TransportChangeType>("bus_change");
  const [amendedBusId, setAmendedBusId] = useState("");
  const [amendedStopId, setAmendedStopId] = useState("");
  const [direction, setDirection] = useState<TransportDirection>("both");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [reasonCode, setReasonCode] = useState<TransportChangeReason>("house_shifting");
  const [reasonNote, setReasonNote] = useState("");
  const [applicationFile, setApplicationFile] = useState<File | null>(null);

  const loadChanges = async () => {
    const res = await adminFetch("/api/transport/changes");
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to load change requests");
      setLoading(false);
      return;
    }
    setChanges((data.changes as ChangeRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    async function init() {
      const [stopsRes, busesRes, yearRes] = await Promise.all([
        supabase.from("bus_stops").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("buses").select("*").eq("is_active", true).order("bus_number"),
        supabase.from("academic_years").select("id").eq("is_current", true).maybeSingle(),
      ]);
      setBusStops((stopsRes.data as BusStop[]) ?? []);
      setBuses((busesRes.data as BusType[]) ?? []);

      const currentYearId = (yearRes.data as { id: string } | null)?.id ?? null;
      if (currentYearId) {
        const { data: enrollData } = await supabase
          .from("student_enrollments")
          .select("id, students(full_name, admission_no), classes(name)")
          .eq("academic_year_id", currentYearId)
          .eq("status", "active");
        const options: EnrollmentOption[] = (
          (enrollData as
            | {
                id: string;
                students: { full_name: string; admission_no: string | null } | null;
                classes: { name: string } | null;
              }[]
            | null) ?? []
        )
          .filter((e) => e.students)
          .map((e) => ({
            id: e.id,
            full_name: e.students!.full_name,
            admission_no: e.students!.admission_no ?? null,
            class_name: e.classes?.name ?? null,
          }));
        setEnrollments(options);
      }

      await loadChanges();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredChanges = useMemo(() => {
    if (statusFilter === "all") return changes;
    return changes.filter((c) => c.status === statusFilter);
  }, [changes, statusFilter]);

  // Header sort/filter accessors. `fromToLabel` renders JSX, so the From → To
  // column gets a plain-text twin here for sorting and filter options.
  const columns = useMemo<TableColumns<ChangeRow>>(
    () => ({
      student: {
        label: "Student",
        value: (r) => r.enrollment?.students?.full_name ?? null,
        filter: "text",
      },
      type: { label: "Type", value: (r) => CHANGE_TYPE_LABELS[r.change_type] },
      from_to: {
        label: "From → To",
        value: (r) => {
          switch (r.change_type) {
            case "bus_change":
              return `${r.previous_bus?.bus_number ?? "—"} → ${r.amended_bus?.bus_number ?? "—"}`;
            case "stop_change":
              return `${r.previous_stop?.name ?? "—"} → ${r.amended_stop?.name ?? "—"}`;
            case "direction_change":
              return r.direction ? DIRECTION_LABELS[r.direction] : null;
            case "drop":
              return "Transport dropped";
            default:
              return null;
          }
        },
        filter: "text",
      },
      reason: { label: "Reason", value: (r) => REASON_LABELS[r.reason_code] },
      effective: {
        label: "Effective",
        value: (r) => effectiveLabel(r),
        sortValue: (r) => r.effective_from,
      },
      source: {
        label: "Source",
        value: (r) => (r.source === "office" ? "Office" : "Parent"),
      },
      status: {
        label: "Status",
        value: (r) => r.status.charAt(0).toUpperCase() + r.status.slice(1),
      },
      application: {
        label: "Application",
        value: (r) => (r.applicationSignedUrl ? "Attached" : null),
        emptyLabel: "None",
      },
    }),
    []
  );

  const table = useTableControls({ rows: filteredChanges, columns });

  const filteredEnrollments = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return enrollments.slice(0, 30);
    return enrollments
      .filter(
        (e) =>
          e.full_name.toLowerCase().includes(q) ||
          (e.admission_no ?? "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [enrollments, studentSearch]);

  const selectedEnrollment = enrollments.find((e) => e.id === enrollmentId) ?? null;

  const handleReview = async (id: string, action: "approve" | "reject") => {
    setReviewingId(id);
    try {
      const res = await adminPatch(`/api/transport/changes/${id}`, { action });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to ${action} request`);
        return;
      }
      toast.success(action === "approve" ? "Change approved" : "Change rejected");
      await loadChanges();
    } catch {
      toast.error(`Failed to ${action} request`);
    } finally {
      setReviewingId(null);
    }
  };

  const resetForm = () => {
    setStudentSearch("");
    setEnrollmentId("");
    setChangeType("bus_change");
    setAmendedBusId("");
    setAmendedStopId("");
    setDirection("both");
    setEffectiveFrom("");
    setEffectiveTo("");
    setReasonCode("house_shifting");
    setReasonNote("");
    setApplicationFile(null);
  };

  // Direct signed-URL upload to the transport-applications bucket. Keeps the
  // original extension (the bucket rejects webp), and returns the storage
  // PATH — which is what the GET endpoint signs when it lists applications.
  const uploadApplication = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const fileName = `${enrollmentId || "office"}-${Date.now()}.${ext}`;
    const res = await adminFetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket: APPLICATIONS_BUCKET, fileName }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to prepare upload");
    }
    const { token, path } = await res.json();
    const { error } = await supabase.storage
      .from(APPLICATIONS_BUCKET)
      .uploadToSignedUrl(fileName, token, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    return (path as string) ?? fileName;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollmentId) {
      toast.error("Select a student");
      return;
    }
    if (!effectiveFrom) {
      toast.error("Effective-from date is required");
      return;
    }
    if (changeType === "bus_change" && !amendedBusId) {
      toast.error("Select the amended bus");
      return;
    }
    if (changeType === "stop_change" && !amendedStopId) {
      toast.error("Select the new stop");
      return;
    }
    if (reasonCode === "other" && reasonNote.trim().length < 3) {
      toast.error("Please describe the reason");
      return;
    }

    setSubmitting(true);
    try {
      let applicationUrl: string | undefined;
      if (applicationFile) {
        try {
          applicationUrl = await uploadApplication(applicationFile);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to upload application"
          );
          setSubmitting(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        enrollment_id: enrollmentId,
        change_type: changeType,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || undefined,
        reason_code: reasonCode,
        reason_note: reasonNote.trim() || undefined,
        application_url: applicationUrl,
      };
      if (changeType === "bus_change") payload.amended_bus_id = amendedBusId;
      if (changeType === "stop_change") payload.amended_stop_id = amendedStopId;
      if (changeType === "direction_change") payload.direction = direction;

      const res = await adminFetch("/api/transport/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to record change");
        return;
      }
      toast.success("Change recorded and applied");
      setDialogOpen(false);
      resetForm();
      await loadChanges();
    } catch {
      toast.error("Failed to record change");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Transport Change Requests
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Review parent requests and record office-initiated transport changes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select
              value={statusFilter}
              items={STATUS_FILTERS}
              onValueChange={(val) => val && setStatusFilter(val)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value} label={f.label}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
            className="bg-navy-900 hover:bg-navy-800 text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Record change
          </Button>
        </div>
      </div>

      <div className="erp-table-container p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : filteredChanges.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            No change requests
            {statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
          </p>
        ) : (
          <>
          <TableFilterSummary
            ctl={table}
            total={filteredChanges.length}
            shown={table.rows.length}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <SortFilterHead ctl={table} col="student" />
                <SortFilterHead ctl={table} col="type" />
                <SortFilterHead ctl={table} col="from_to" />
                <SortFilterHead ctl={table} col="reason" />
                <SortFilterHead ctl={table} col="effective" />
                <SortFilterHead ctl={table} col="source" />
                <SortFilterHead ctl={table} col="status" />
                <SortFilterHead ctl={table} col="application" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-gray-500 dark:text-gray-400">
                    No change requests match the column filters.
                  </TableCell>
                </TableRow>
              )}
              {table.rows.map((row) => {
                const student = row.enrollment?.students;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-navy-900 dark:text-white">
                        {student?.full_name ?? "—"}
                      </div>
                      {student?.admission_no && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {student.admission_no}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {CHANGE_TYPE_LABELS[row.change_type]}
                    </TableCell>
                    <TableCell className="text-sm">{fromToLabel(row)}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {REASON_LABELS[row.reason_code]}
                      {row.reason_note && (
                        <div className="text-xs text-gray-400 dark:text-gray-500 max-w-[180px] truncate">
                          {row.reason_note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {effectiveLabel(row)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.source === "office" ? "secondary" : "outline"}>
                        {row.source === "office" ? "Office" : "Parent"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[row.status]}>
                        {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.applicationSignedUrl ? (
                        <a
                          href={row.applicationSignedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "pending" ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reviewingId === row.id}
                            onClick={() => handleReview(row.id, "approve")}
                            className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/30"
                          >
                            {reviewingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                            <span className="ml-1">Approve</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reviewingId === row.id}
                            onClick={() => handleReview(row.id, "reject")}
                            className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <X className="h-4 w-4" />
                            <span className="ml-1">Reject</span>
                          </Button>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </>
        )}
      </div>

      {/* Record Change Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
                <Bus className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <DialogTitle>Record Transport Change</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Office changes are applied immediately.
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Student picker */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Student</Label>
              {selectedEnrollment ? (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-navy-900 dark:text-white">
                      {selectedEnrollment.full_name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {selectedEnrollment.admission_no ?? "No admission no"}
                      {selectedEnrollment.class_name
                        ? ` · ${selectedEnrollment.class_name}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEnrollmentId("");
                      setStudentSearch("");
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="Search by name or admission no"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />
                  {studentSearch.trim() && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-border divide-y divide-gray-100 dark:divide-border">
                      {filteredEnrollments.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-500">No matches</p>
                      ) : (
                        filteredEnrollments.map((e) => (
                          <button
                            type="button"
                            key={e.id}
                            onClick={() => {
                              setEnrollmentId(e.id);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5"
                          >
                            <div className="text-sm text-navy-900 dark:text-white">
                              {e.full_name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {e.admission_no ?? "No admission no"}
                              {e.class_name ? ` · ${e.class_name}` : ""}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Change type */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Change Type</Label>
              <Select
                value={changeType}
                items={CHANGE_TYPE_OPTIONS.map((t) => ({
                  value: t,
                  label: CHANGE_TYPE_LABELS[t],
                }))}
                onValueChange={(val) => val && setChangeType(val as TransportChangeType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t} label={CHANGE_TYPE_LABELS[t]}>
                      {CHANGE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conditional fields */}
            {changeType === "bus_change" && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Amended Bus</Label>
                <Select
                  value={amendedBusId}
                  items={buses.map((b) => ({ value: b.id, label: b.bus_number }))}
                  onValueChange={(val) => val && setAmendedBusId(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select bus" />
                  </SelectTrigger>
                  <SelectContent>
                    {buses.map((b) => (
                      <SelectItem key={b.id} value={b.id} label={b.bus_number}>
                        {b.bus_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {changeType === "stop_change" && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">New Stop</Label>
                <Select
                  value={amendedStopId}
                  items={busStops.map((s) => ({ value: s.id, label: s.name }))}
                  onValueChange={(val) => val && setAmendedStopId(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select stop" />
                  </SelectTrigger>
                  <SelectContent>
                    {busStops.map((s) => (
                      <SelectItem key={s.id} value={s.id} label={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {changeType === "direction_change" && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Direction</Label>
                <Select
                  value={direction}
                  items={DIRECTION_OPTIONS.map((d) => ({
                    value: d,
                    label: DIRECTION_LABELS[d],
                  }))}
                  onValueChange={(val) => val && setDirection(val as TransportDirection)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTION_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d} label={DIRECTION_LABELS[d]}>
                        {DIRECTION_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Requires a one-side custom fee already set on the Assignments page.
                </p>
              </div>
            )}

            {/* Effective dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Effective From</Label>
                <Input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Effective To{" "}
                  <span className="text-gray-400">(empty = permanent)</span>
                </Label>
                <Input
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">Reason</Label>
              <Select
                value={reasonCode}
                items={REASON_OPTIONS.map((r) => ({
                  value: r,
                  label: REASON_LABELS[r],
                }))}
                onValueChange={(val) => val && setReasonCode(val as TransportChangeReason)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r} label={REASON_LABELS[r]}>
                      {REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Note{" "}
                {reasonCode === "other" ? (
                  <span className="text-red-500">(required)</span>
                ) : (
                  <span className="text-gray-400">(optional)</span>
                )}
              </Label>
              <textarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-card px-3 py-2 text-sm text-navy-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
                placeholder="Additional details"
              />
            </div>

            {/* Optional application upload */}
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Application <span className="text-gray-400">(optional, PDF/JPG/PNG)</span>
              </Label>
              <Input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => setApplicationFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Record change
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
