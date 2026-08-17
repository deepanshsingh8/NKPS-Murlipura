"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { toast } from "sonner";
import {
  Loader2,
  Bus as BusIcon,
  Search,
  Pencil,
  X,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { adminApi, adminFetch } from "@nkps/shared/lib/admin-api";
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

/** A bus that serves a stop, with the seat picture that ranks it. */
interface BusSuggestion {
  bus: Bus;
  /** Students already on this bus this year. */
  load: number;
  /** `capacity - load`, or null when the bus has no capacity recorded. */
  seatsLeft: number | null;
}

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

// "BUS-02 · 12 free". The seat count is the whole reason one candidate beats
// another, so it belongs on the option rather than behind a tooltip.
const busOptionLabel = (s: BusSuggestion) =>
  s.seatsLeft == null
    ? s.bus.bus_number
    : s.seatsLeft > 0
      ? `${s.bus.bus_number} · ${s.seatsLeft} free`
      : `${s.bus.bus_number} · full`;

const formatRupee = (amount: number | null | undefined) =>
  amount == null ? "—" : `₹${amount.toLocaleString("en-IN")}`;

// Filter-panel label for a transport row that has no bus yet. Kept as a
// constant because the dashboard's "No bus assigned" tile deep-links straight
// to this value (see `AUDIT_PRESETS`).
const NO_BUS_LABEL = "Not assigned";

// `?audit=` presets, so a dashboard stat card can open this page with the
// column filters that isolate exactly the rows it counted.
const AUDIT_PRESETS: Record<
  string,
  { filters: Record<string, { selected: string[] }>; note: string }
> = {
  no_bus: {
    filters: {
      transport: { selected: ["Yes"] },
      bus: { selected: [NO_BUS_LABEL] },
    },
    note: "Showing students on transport who have no bus assigned yet.",
  },
  using: {
    filters: { transport: { selected: ["Yes"] } },
    note: "Showing students opted in to transport.",
  },
  one_side: {
    filters: {
      transport: { selected: ["Yes"] },
      direction: { selected: ["Pickup only", "Drop only"] },
    },
    note: "Showing one-side (pickup or drop only) transport students.",
  },
};

/**
 * The Bus cell for a student who is on transport but has none assigned.
 *
 * Rather than an em dash that says only "missing", it names the bus that
 * actually serves this child's stop and assigns it in one click — which is
 * the whole job on this screen for the students the dashboard counts.
 */
function UnassignedBusCell({
  suggestion,
  hasStop,
  busy,
  onAssign,
}: {
  suggestion: BusSuggestion | null;
  hasStop: boolean;
  busy: boolean;
  onAssign: (bus: Bus) => void;
}) {
  if (!hasStop) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <TriangleAlert className="h-3.5 w-3.5" />
        No stop yet
      </span>
    );
  }
  if (!suggestion) {
    // A stop no bus route covers. Naming that is more useful than a dash:
    // the fix is to add the stop to a route, not to pick a bus here.
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
        title="No bus route includes this stop — add it to a route first"
      >
        <TriangleAlert className="h-3.5 w-3.5" />
        No route covers this stop
      </span>
    );
  }
  const full = suggestion.seatsLeft != null && suggestion.seatsLeft <= 0;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => onAssign(suggestion.bus)}
      title={
        `Assign ${suggestion.bus.bus_number} — serves this stop` +
        (suggestion.seatsLeft != null
          ? `, ${suggestion.seatsLeft} of ${suggestion.bus.capacity} seats free`
          : ", capacity not recorded")
      }
      className={
        full
          ? "h-7 border-amber-300 px-2 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-400"
          : "h-7 border-blue-200 px-2 text-xs text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-950/30"
      }
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      <span className="ml-1">{suggestion.bus.bus_number}</span>
      {suggestion.seatsLeft != null && (
        <span className="ml-1 opacity-70">
          {full ? "(full)" : `(${suggestion.seatsLeft} free)`}
        </span>
      )}
    </Button>
  );
}

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
  const [classFilter, setClassFilter] = useUrlState("class_id", "all");
  const [search, setSearch] = useUrlState("q");
  const [audit] = useUrlState("audit");

  // Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EnrollmentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quickAssigning, setQuickAssigning] = useState<string | null>(null);

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

    // Enrollments and the year-scoped fees come from /api/transport/assignments
    // (service role, gated on the `transport` grant). Reading student data
    // straight from the browser put it under RLS, where office staff matched
    // no policy and got an empty list rather than an error — see the route for
    // the full story. The fleet tables are world-readable, so they stay here
    // and load in parallel with that request.
    const [assignmentsRes, stopsRes, busesRes, routeRes] = await Promise.all([
      adminFetch("/api/transport/assignments"),
      supabase
        .from("bus_stops")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("buses")
        .select("*")
        .eq("is_active", true)
        .order("bus_number", { ascending: true }),
      supabase.from("bus_route_stops").select("*"),
    ]);

    const payload = await assignmentsRes.json().catch(() => null);

    if (!assignmentsRes.ok || !payload) {
      toast.error(payload?.error || "Failed to load enrollments");
      setLoading(false);
      return;
    }

    setActiveYear((payload.year as AcademicYear | null) ?? null);
    setEnrollments((payload.enrollments as EnrollmentRow[]) ?? []);
    setStops((stopsRes.data as BusStop[]) ?? []);
    setBuses((busesRes.data as Bus[]) ?? []);
    setRouteStops((routeRes.data as BusRouteStop[]) ?? []);

    const feeMap = new Map<string, number>();
    ((payload.fees as BusStopFee[] | null) ?? []).forEach((f) => {
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

  // The fee actually charged for a row — the one-side override when the
  // student only rides one leg, otherwise the flat stop fee.
  const feeOf = useCallback(
    (row: EnrollmentRow): number | null => {
      if (!row.has_transport) return null;
      if (row.transport_direction !== "both" && row.transport_fee_override != null) {
        return row.transport_fee_override;
      }
      return row.bus_stop_id ? feeByStop.get(row.bus_stop_id) ?? null : null;
    },
    [feeByStop]
  );

  // Column accessors for header sorting/filtering. Each mirrors exactly what
  // the matching cell renders, so a filter option always reads like the value
  // on screen — including the "—" placeholders for students off transport.
  const columns = useMemo<TableColumns<EnrollmentRow>>(
    () => ({
      name: {
        label: "Name",
        value: (r) => r.students?.full_name ?? "",
        filter: "text",
      },
      class: { label: "Class", value: (r) => classLabel(r.classes) },
      transport: { label: "Transport?", value: (r) => r.has_transport },
      stop: {
        label: "Stop",
        value: (r) =>
          r.has_transport && r.bus_stop_id
            ? stopById.get(r.bus_stop_id)?.name ?? null
            : null,
      },
      fee: {
        label: "Fee",
        value: (r) => {
          const fee = feeOf(r);
          return fee == null ? null : formatRupee(fee);
        },
        sortValue: (r) => feeOf(r),
      },
      bus: {
        label: "Bus",
        value: (r) =>
          r.has_transport && r.bus_id
            ? busById.get(r.bus_id)?.bus_number ?? null
            : null,
        // Students on transport with no bus are the ones the dashboard's
        // "No bus assigned" card counts — give them a findable label rather
        // than the bare em dash the cell shows.
        emptyLabel: NO_BUS_LABEL,
      },
      direction: {
        label: "Direction",
        value: (r) =>
          r.has_transport ? directionLabel(r.transport_direction) : null,
      },
    }),
    [stopById, busById, feeOf]
  );

  const preset = AUDIT_PRESETS[audit];

  const table = useTableControls({
    rows: filteredEnrollments,
    columns,
    initialFilters: preset?.filters,
    // `audit` is read from the URL, which the App Router only commits after
    // this page's first render — so the preset arrives a tick late and has to
    // be applied by key rather than seeded once.
    presetKey: preset ? audit : null,
  });

  // Students who opted in but have no bus yet — the queue this page exists to
  // clear. Exposed as a one-click filter so it doesn't depend on arriving via
  // the dashboard's deep-link.
  const needsBusCount = useMemo(
    () => enrollments.filter((e) => e.has_transport && !e.bus_id).length,
    [enrollments]
  );
  const needsBusFilterOn =
    table.getFilter("transport").selected.includes("Yes") &&
    table.getFilter("bus").selected.includes(NO_BUS_LABEL);
  const toggleNeedsBus = () => {
    if (needsBusFilterOn) {
      table.clearFilter("transport");
      table.clearFilter("bus");
    } else {
      table.setFilter("transport", { selected: ["Yes"] });
      table.setFilter("bus", { selected: [NO_BUS_LABEL] });
    }
  };

  // How many students each bus already carries this year, for the capacity
  // side of the suggestion below.
  const loadByBus = useMemo(() => {
    const m = new Map<string, number>();
    enrollments.forEach((e) => {
      if (e.has_transport && e.bus_id) {
        m.set(e.bus_id, (m.get(e.bus_id) ?? 0) + 1);
      }
    });
    return m;
  }, [enrollments]);

  // Which bus should this stop's students ride?
  //
  // Only buses whose route actually includes the stop are candidates — putting
  // a child on a bus that never passes their stop is the mistake this is meant
  // to prevent, so a bus that doesn't serve it is never suggested at any
  // capacity. Among those, prefer the one with the most seats left, which
  // spreads load instead of filling the first bus on the list. Buses with no
  // capacity recorded sort last: an unknown seat count can't be shown to be
  // free, and guessing it is what would overfill a route.
  const suggestBuses = useCallback(
    (stopId: string | null): BusSuggestion[] => {
      if (!stopId) return [];
      const serving = busesByStop.get(stopId);
      if (!serving || serving.size === 0) return [];
      return buses
        .filter((b) => serving.has(b.id))
        .map((b) => {
          const load = loadByBus.get(b.id) ?? 0;
          const seatsLeft = b.capacity != null ? b.capacity - load : null;
          return { bus: b, load, seatsLeft };
        })
        .sort((a, z) => {
          const aFree = a.seatsLeft ?? -Infinity;
          const zFree = z.seatsLeft ?? -Infinity;
          if (aFree !== zFree) return zFree - aFree;
          return a.bus.bus_number.localeCompare(z.bus.bus_number);
        });
    },
    [buses, busesByStop, loadByBus]
  );

  // Buses to offer for the chosen stop, best first. When no route covers the
  // stop we still list every active bus rather than blocking the assignment —
  // the office may be acting on a route change not yet recorded — but the
  // fallback is called out so nobody reads the list as "these serve the stop".
  const busChoices = useMemo(() => {
    const serving = suggestBuses(busStopId);
    if (serving.length > 0) return { list: serving, fallback: false };
    const all = buses.map((b) => {
      const load = loadByBus.get(b.id) ?? 0;
      return {
        bus: b,
        load,
        seatsLeft: b.capacity != null ? b.capacity - load : null,
      };
    });
    return { list: all, fallback: !!busStopId };
  }, [busStopId, buses, loadByBus, suggestBuses]);

  // Only a real suggestion when the shortlist came from the stop's routes.
  const topSuggestion = busChoices.fallback ? null : busChoices.list[0] ?? null;

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

  // Assign the suggested bus without opening the dialog. Only offered on rows
  // that already have a stop and no bus, so nothing else on the enrollment
  // changes — the write touches bus_id alone.
  const assignSuggested = async (row: EnrollmentRow, bus: Bus) => {
    setQuickAssigning(row.id);
    const result = await adminApi({
      action: "update",
      table: "student_enrollments",
      data: { bus_id: bus.id },
      match: { column: "id", value: row.id },
    });
    if (!result.success) {
      toast.error(result.error || "Failed to assign bus");
    } else {
      toast.success(
        `${row.students?.full_name ?? "Student"} assigned to ${bus.bus_number}`
      );
      await fetchData();
    }
    setQuickAssigning(null);
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
        {/* The one filter this page is opened for, as a button rather than
            two column-header selections. */}
        {needsBusCount > 0 && (
          <Button
            type="button"
            variant={needsBusFilterOn ? "default" : "outline"}
            onClick={toggleNeedsBus}
            className={
              needsBusFilterOn
                ? "bg-amber-500 hover:bg-amber-600 text-white sm:ml-auto"
                : "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-400 dark:hover:bg-amber-950/30 sm:ml-auto"
            }
          >
            <BusIcon className="h-4 w-4 mr-2" />
            Needs a bus ({needsBusCount})
            {needsBusFilterOn && <X className="h-3.5 w-3.5 ml-2" />}
          </Button>
        )}
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
          <>
            {preset && table.activeFilterCount > 0 && (
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {preset.note}
              </p>
            )}
            <TableFilterSummary
              ctl={table}
              total={filteredEnrollments.length}
              shown={table.rows.length}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <SortFilterHead ctl={table} col="name" />
                  <SortFilterHead ctl={table} col="class" />
                  <SortFilterHead ctl={table} col="transport" />
                  <SortFilterHead ctl={table} col="stop" />
                  <SortFilterHead ctl={table} col="fee" />
                  <SortFilterHead ctl={table} col="bus" />
                  <SortFilterHead ctl={table} col="direction" />
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-gray-500 dark:text-gray-400"
                    >
                      No students match the column filters.
                    </TableCell>
                  </TableRow>
                )}
                {table.rows.map((row) => {
                  const stop = row.bus_stop_id
                    ? stopById.get(row.bus_stop_id)
                    : undefined;
                  const bus = row.bus_id ? busById.get(row.bus_id) : undefined;
                  const displayFee = feeOf(row);
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
                        {!row.has_transport ? (
                          "—"
                        ) : bus ? (
                          bus.bus_number
                        ) : (
                          <UnassignedBusCell
                            suggestion={suggestBuses(row.bus_stop_id)[0] ?? null}
                            hasStop={!!row.bus_stop_id}
                            busy={quickAssigning === row.id}
                            onAssign={(b) => assignSuggested(row, b)}
                          />
                        )}
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
          </>
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
                      // Clear the bus if it no longer serves the new stop —
                      // silently keeping it would put the child on a route
                      // that never passes their new pickup point.
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
                  {/* Offered, not applied: the office stays the one deciding,
                      but the decision is one click when the obvious answer is
                      the right one. */}
                  {topSuggestion && busId !== topSuggestion.bus.id && (
                    <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-1.5 dark:border-blue-900/40 dark:bg-blue-950/20">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                      <p className="flex-1 text-xs text-blue-800 dark:text-blue-300">
                        <span className="font-semibold">
                          {topSuggestion.bus.bus_number}
                        </span>{" "}
                        serves this stop
                        {topSuggestion.seatsLeft != null
                          ? topSuggestion.seatsLeft > 0
                            ? ` · ${topSuggestion.seatsLeft} of ${topSuggestion.bus.capacity} seats free`
                            : " · but is at capacity"
                          : " · capacity not recorded"}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => setBusId(topSuggestion.bus.id)}
                      >
                        Use
                      </Button>
                    </div>
                  )}
                  <Select
                    value={busId || "none"}
                    items={[
                      { value: "none", label: "Not assigned" },
                      ...busChoices.list.map((c) => ({
                        value: c.bus.id,
                        label: busOptionLabel(c),
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
                      {busChoices.list.map((c) => (
                        <SelectItem
                          key={c.bus.id}
                          value={c.bus.id}
                          label={busOptionLabel(c)}
                        >
                          {busOptionLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {busStopId && busChoices.fallback && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      No bus route includes this stop — showing all active
                      buses, ordered by seats free.
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
