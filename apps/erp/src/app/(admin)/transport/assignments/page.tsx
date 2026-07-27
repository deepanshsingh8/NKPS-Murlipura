"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
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
import { toast } from "sonner";
import { Loader2, Bus as BusIcon, Search, Pencil } from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import type {
  AcademicYear,
  BusStop,
  BusStopFee,
  Bus,
  BusRouteStop,
  TransportDirection,
} from "@nkps/shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrollmentRow {
  id: string;
  student_id: string;
  class_id: string;
  has_transport: boolean;
  bus_stop_id: string | null;
  bus_id: string | null;
  transport_direction: TransportDirection;
  transport_fee_override: number | null;
  pickup_address: string | null;
  students: { full_name: string; admission_no: string | null } | null;
  classes: {
    name: string;
    section: string;
    streams: { name: string } | null;
  } | null;
}

// "XI — A · Science" — appends the stream so same class+section rows for
// different streams aren't indistinguishable.
function classLabel(
  c: { name: string; section: string; streams: { name: string } | null } | null
): string {
  if (!c) return "—";
  const base = `${c.name} — ${c.section}`;
  return c.streams?.name ? `${base} · ${c.streams.name}` : base;
}

const DIRECTION_OPTIONS: { value: TransportDirection; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "pickup_only", label: "Pickup only" },
  { value: "drop_only", label: "Drop only" },
];

const directionLabel = (dir: TransportDirection) =>
  DIRECTION_OPTIONS.find((d) => d.value === dir)?.label ?? "—";

const formatRupee = (amount: number | null | undefined) =>
  amount == null ? "—" : `₹${amount.toLocaleString("en-IN")}`;

export default function StudentTransportAssignmentsPage() {
  const supabase = createClient();

  const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [feeByStop, setFeeByStop] = useState<Map<string, number>>(new Map());
  const [buses, setBuses] = useState<Bus[]>([]);
  const [routeStops, setRouteStops] = useState<BusRouteStop[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [classFilter, setClassFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EnrollmentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [hasTransport, setHasTransport] = useState(false);
  const [busStopId, setBusStopId] = useState<string>("");
  const [busId, setBusId] = useState<string>("");
  const [direction, setDirection] = useState<TransportDirection>("both");
  const [overrideFee, setOverrideFee] = useState<string>("");
  const [pickupAddress, setPickupAddress] = useState<string>("");
  const [errors, setErrors] = useState<{ stop?: string; override?: string }>({});

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const fetchData = async () => {
    setLoading(true);

    // Resolve active academic year: prefer is_current, else newest by name.
    const { data: yearsData, error: yearsError } = await supabase
      .from("academic_years")
      .select("*")
      .order("name", { ascending: false });

    if (yearsError) {
      toast.error("Failed to load academic years");
      setLoading(false);
      return;
    }

    const years = (yearsData as AcademicYear[]) ?? [];
    const year = years.find((y) => y.is_current) ?? years[0] ?? null;
    setActiveYear(year);

    if (!year) {
      setEnrollments([]);
      setLoading(false);
      return;
    }

    const [enrollRes, stopsRes, feesRes, busesRes, routeRes] = await Promise.all([
      supabase
        .from("student_enrollments")
        .select(
          "id, student_id, class_id, has_transport, bus_stop_id, bus_id, transport_direction, transport_fee_override, pickup_address, students(full_name, admission_no), classes(name, section, streams(name))"
        )
        .eq("academic_year_id", year.id),
      supabase
        .from("bus_stops")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("bus_stop_fees")
        .select("*")
        .eq("academic_year_id", year.id)
        .eq("is_active", true),
      supabase
        .from("buses")
        .select("*")
        .eq("is_active", true)
        .order("bus_number", { ascending: true }),
      supabase.from("bus_route_stops").select("*"),
    ]);

    if (enrollRes.error) {
      toast.error("Failed to load enrollments");
      setLoading(false);
      return;
    }

    setEnrollments((enrollRes.data as unknown as EnrollmentRow[]) ?? []);
    setStops((stopsRes.data as BusStop[]) ?? []);
    setBuses((busesRes.data as Bus[]) ?? []);
    setRouteStops((routeRes.data as BusRouteStop[]) ?? []);

    const feeMap = new Map<string, number>();
    ((feesRes.data as BusStopFee[] | null) ?? []).forEach((f) => {
      feeMap.set(f.bus_stop_id, f.amount);
    });
    setFeeByStop(feeMap);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Derived lookups
  // -------------------------------------------------------------------------

  const stopById = useMemo(() => {
    const m = new Map<string, BusStop>();
    stops.forEach((s) => m.set(s.id, s));
    return m;
  }, [stops]);

  const busById = useMemo(() => {
    const m = new Map<string, Bus>();
    buses.forEach((b) => m.set(b.id, b));
    return m;
  }, [buses]);

  // bus_stop_id -> set of bus_ids that serve it
  const busesByStop = useMemo(() => {
    const m = new Map<string, Set<string>>();
    routeStops.forEach((rs) => {
      if (!m.has(rs.bus_stop_id)) m.set(rs.bus_stop_id, new Set());
      m.get(rs.bus_stop_id)!.add(rs.bus_id);
    });
    return m;
  }, [routeStops]);

  // Class filter options derived from the loaded enrollments.
  const classOptions = useMemo(() => {
    const m = new Map<string, string>();
    enrollments.forEach((e) => {
      if (e.classes) {
        m.set(e.class_id, classLabel(e.classes));
      }
    });
    return Array.from(m.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [enrollments]);

  const filteredEnrollments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrollments
      .filter((e) => (classFilter === "all" ? true : e.class_id === classFilter))
      .filter((e) => {
        if (!q) return true;
        const name = e.students?.full_name?.toLowerCase() ?? "";
        const adm = e.students?.admission_no?.toLowerCase() ?? "";
        return name.includes(q) || adm.includes(q);
      })
      .sort((a, b) =>
        (a.students?.full_name ?? "").localeCompare(b.students?.full_name ?? "")
      );
  }, [enrollments, classFilter, search]);

  // Buses to offer for the chosen stop: those serving it, else fall back to all.
  const busChoices = useMemo(() => {
    if (!busStopId) return { list: buses, fallback: false };
    const serving = busesByStop.get(busStopId);
    if (serving && serving.size > 0) {
      const list = buses.filter((b) => serving.has(b.id));
      if (list.length > 0) return { list, fallback: false };
    }
    return { list: buses, fallback: true };
  }, [busStopId, buses, busesByStop]);

  const selectedStopFee = busStopId ? feeByStop.get(busStopId) : undefined;

  // -------------------------------------------------------------------------
  // Dialog handlers
  // -------------------------------------------------------------------------

  const openEdit = (row: EnrollmentRow) => {
    setEditing(row);
    setHasTransport(row.has_transport);
    setBusStopId(row.bus_stop_id ?? "");
    setBusId(row.bus_id ?? "");
    setDirection(row.transport_direction ?? "both");
    setOverrideFee(
      row.transport_fee_override != null ? String(row.transport_fee_override) : ""
    );
    setPickupAddress(row.pickup_address ?? "");
    setErrors({});
    setDialogOpen(true);
  };

  const validate = (): boolean => {
    const next: { stop?: string; override?: string } = {};
    if (hasTransport) {
      if (!busStopId) {
        next.stop = "Select a bus stop for a student on transport.";
      }
      if (direction !== "both") {
        const amt = Number(overrideFee);
        if (!Number.isFinite(amt) || amt <= 0) {
          next.override = "A one-side fee greater than 0 is required.";
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!validate()) return;

    setSubmitting(true);

    let data: Record<string, unknown>;
    if (!hasTransport) {
      // Clearing transport — reset all dependent fields so DB checks pass.
      data = {
        has_transport: false,
        bus_stop_id: null,
        bus_id: null,
        transport_direction: "both",
        transport_fee_override: null,
        pickup_address: pickupAddress.trim() || null,
      };
    } else {
      data = {
        has_transport: true,
        bus_stop_id: busStopId,
        bus_id: busId || null,
        transport_direction: direction,
        transport_fee_override:
          direction === "both" ? null : Number(overrideFee),
        pickup_address: pickupAddress.trim() || null,
      };
    }

    const result = await adminApi({
      action: "update",
      table: "student_enrollments",
      data,
      match: { column: "id", value: editing.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to save transport assignment");
    } else {
      toast.success("Transport assignment saved");
      setDialogOpen(false);
      setEditing(null);
      await fetchData();
    }
    setSubmitting(false);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Student Transport Assignments
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Assign stops, buses & directions for{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {activeYear ? activeYear.name : "—"}
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-4">
        <div className="w-full sm:w-56">
          <Select
            value={classFilter}
            items={[
              { value: "all", label: "All classes" },
              ...classOptions,
            ]}
            onValueChange={(val) => val && setClassFilter(val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label="All classes">
                All classes
              </SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c.value} value={c.value} label={c.label}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or admission no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="erp-table-container p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : filteredEnrollments.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            {enrollments.length === 0
              ? "No enrollments found for the active academic year."
              : "No students match your filters."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Transport?</TableHead>
                <TableHead>Stop</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Bus</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEnrollments.map((row) => {
                const stop = row.bus_stop_id
                  ? stopById.get(row.bus_stop_id)
                  : undefined;
                const bus = row.bus_id ? busById.get(row.bus_id) : undefined;
                const displayFee = row.has_transport
                  ? row.transport_direction !== "both" &&
                    row.transport_fee_override != null
                    ? row.transport_fee_override
                    : row.bus_stop_id
                      ? feeByStop.get(row.bus_stop_id)
                      : undefined
                  : undefined;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.students?.full_name ?? "—"}
                      {row.students?.admission_no ? (
                        <span className="ml-1 text-xs text-gray-400">
                          ({row.students.admission_no})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {classLabel(row.classes)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.has_transport
                            ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400"
                            : "inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }
                      >
                        {row.has_transport ? "Yes" : "No"}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {row.has_transport ? stop?.name ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {row.has_transport ? formatRupee(displayFee) : "—"}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {row.has_transport ? bus?.bus_number ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-300">
                      {row.has_transport
                        ? directionLabel(row.transport_direction)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(row)}
                        aria-label="Edit transport assignment"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Edit Assignment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
                <BusIcon className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <DialogTitle>Transport Assignment</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editing?.students?.full_name ?? ""}
                  {editing?.classes ? ` — ${classLabel(editing.classes)}` : ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Has transport toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={hasTransport}
                onCheckedChange={(checked) => {
                  setHasTransport(checked === true);
                  setErrors({});
                }}
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Uses school transport
              </span>
            </label>

            {hasTransport && (
              <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                {/* Bus stop */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Bus Stop</Label>
                  <Select
                    value={busStopId}
                    items={stops.map((s) => ({ value: s.id, label: s.name }))}
                    onValueChange={(val) => {
                      const next = val ?? "";
                      setBusStopId(next);
                      // Clear bus if it no longer serves the new stop.
                      if (busId) {
                        const serving = busesByStop.get(next);
                        if (serving && serving.size > 0 && !serving.has(busId)) {
                          setBusId("");
                        }
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a stop" />
                    </SelectTrigger>
                    <SelectContent>
                      {stops.map((s) => (
                        <SelectItem key={s.id} value={s.id} label={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {busStopId && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Monthly stop fee:{" "}
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {selectedStopFee != null
                          ? formatRupee(selectedStopFee)
                          : "not set"}
                      </span>
                    </p>
                  )}
                  {errors.stop && (
                    <p className="text-xs text-red-600">{errors.stop}</p>
                  )}
                </div>

                {/* Bus */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Bus (optional)</Label>
                  <Select
                    value={busId || "none"}
                    items={[
                      { value: "none", label: "Not assigned" },
                      ...busChoices.list.map((b) => ({
                        value: b.id,
                        label: b.bus_number,
                      })),
                    ]}
                    onValueChange={(val) =>
                      setBusId(!val || val === "none" ? "" : val)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a bus" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" label="Not assigned">
                        Not assigned
                      </SelectItem>
                      {busChoices.list.map((b) => (
                        <SelectItem key={b.id} value={b.id} label={b.bus_number}>
                          {b.bus_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {busStopId && busChoices.fallback && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      No bus is mapped to this stop — showing all active buses.
                    </p>
                  )}
                </div>

                {/* Direction */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Direction</Label>
                  <Select
                    value={direction}
                    items={DIRECTION_OPTIONS}
                    onValueChange={(val) => {
                      if (!val) return;
                      const next = val as TransportDirection;
                      setDirection(next);
                      if (next === "both") setOverrideFee("");
                      setErrors((prev) => ({ ...prev, override: undefined }));
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIRECTION_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value} label={d.label}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* One-side override fee */}
                {direction !== "both" && (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">
                      Custom one-side fee (₹)
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={overrideFee}
                      onChange={(e) => setOverrideFee(e.target.value)}
                      placeholder="e.g. 700"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Required for one-way transport since the flat stop fee
                      covers both legs.
                    </p>
                    {errors.override && (
                      <p className="text-xs text-red-600">{errors.override}</p>
                    )}
                  </div>
                )}

                {/* Pickup address */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Pickup landmark (optional)
                  </Label>
                  <Input
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    placeholder="e.g. Near Model Town gate"
                  />
                </div>
              </div>
            )}

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
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
