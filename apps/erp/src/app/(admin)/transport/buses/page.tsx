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
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, Bus as BusIcon, Route, Search } from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import type { Bus, BusStop, BusRouteStop, StaffMember } from "@nkps/shared/types";

interface BusWithRelations extends Bus {
  driver_name?: string;
  stop_count?: number;
  // Names of the stops this bus serves, in stop sort order — used by the
  // "Stops served" dialog.
  stop_names?: string[];
}

export default function AdminBusesPage() {
  const [buses, setBuses] = useState<BusWithRelations[]>([]);
  const [drivers, setDrivers] = useState<StaffMember[]>([]);
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingBus, setEditingBus] = useState<BusWithRelations | null>(null);

  // Form state
  const [busNumber, setBusNumber] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [driverId, setDriverId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");

  // View-stops dialog (read-only list of a bus's served stops)
  const [stopsBus, setStopsBus] = useState<BusWithRelations | null>(null);

  // Manage-route dialog
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [routeBus, setRouteBus] = useState<BusWithRelations | null>(null);
  const [routeSubmitting, setRouteSubmitting] = useState(false);
  const [routeSearch, setRouteSearch] = useState("");
  // stop_id -> route_stop_id for the bus's current route
  const [originalRouteMap, setOriginalRouteMap] = useState<Map<string, string>>(new Map());
  // currently checked stop ids
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set());

  const supabase = createClient();

  const fetchData = async () => {
    const [busesRes, driversRes, stopsRes, routeStopsRes] = await Promise.all([
      supabase
        .from("buses")
        .select("*, staff_members:driver_id(name)")
        .order("bus_number", { ascending: true }),
      supabase
        .from("staff_members")
        .select("*")
        .eq("category", "busDriver")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("bus_stops")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("bus_route_stops")
        .select("bus_id, bus_stops:bus_stop_id(name, sort_order)"),
    ]);

    if (busesRes.error) {
      toast.error("Failed to fetch buses");
    } else {
      // Group served stops per bus, ordered by the stop's sort_order so the
      // dialog lists them the way the route runs.
      type RouteStopRow = {
        bus_id: string;
        // PostgREST returns a single object for this to-one FK embed, but the
        // generated types widen it to an array — cast via unknown below.
        bus_stops: { name: string; sort_order: number } | null;
      };
      const stopsByBus = new Map<string, { name: string; sort_order: number }[]>();
      for (const row of (routeStopsRes.data as unknown as RouteStopRow[]) ?? []) {
        if (!row.bus_stops) continue;
        const list = stopsByBus.get(row.bus_id) ?? [];
        list.push(row.bus_stops);
        stopsByBus.set(row.bus_id, list);
      }
      const enriched: BusWithRelations[] = (busesRes.data ?? []).map(
        (b: Record<string, unknown>) => {
          const id = (b as unknown as Bus).id;
          const stops = (stopsByBus.get(id) ?? []).sort(
            (a, z) => a.sort_order - z.sort_order
          );
          return {
            ...(b as unknown as Bus),
            driver_name: (b.staff_members as { name: string } | null)?.name ?? "—",
            stop_count: stops.length,
            stop_names: stops.map((s) => s.name),
          };
        }
      );
      setBuses(enriched);
    }

    setDrivers((driversRes.data as StaffMember[]) ?? []);
    setBusStops((stopsRes.data as BusStop[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Header sort/filter accessors — mirror what the matching cell renders.
  const columns = useMemo<TableColumns<BusWithRelations>>(
    () => ({
      bus_number: { label: "Bus No.", value: (b) => b.bus_number, filter: "text" },
      driver: {
        label: "Driver",
        value: (b) => (b.driver_name === "—" ? null : b.driver_name),
        emptyLabel: "No driver",
      },
      capacity: { label: "Capacity", value: (b) => b.capacity, filter: "none" },
      registration: {
        label: "Reg. No.",
        value: (b) => b.registration_number || null,
        filter: "text",
      },
      stops: {
        label: "Stops served",
        value: (b) => {
          const count = b.stop_count ?? 0;
          return `${count} ${count === 1 ? "stop" : "stops"}`;
        },
        sortValue: (b) => b.stop_count ?? 0,
      },
      active: {
        label: "Active",
        value: (b) => (b.is_active ? "Active" : "Inactive"),
      },
    }),
    []
  );

  const table = useTableControls({ rows: buses, columns });

  const resetForm = () => {
    setBusNumber("");
    setRegistrationNumber("");
    setCapacity("");
    setDriverId("");
    setIsActive(true);
    setNotes("");
    setEditingBus(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (bus: BusWithRelations) => {
    setEditingBus(bus);
    setBusNumber(bus.bus_number);
    setRegistrationNumber(bus.registration_number ?? "");
    setCapacity(bus.capacity != null ? String(bus.capacity) : "");
    setDriverId(bus.driver_id ?? "");
    setIsActive(bus.is_active);
    setNotes(bus.notes ?? "");
    setDialogOpen(true);
  };

  const friendlyBusError = (error: string | undefined, fallback: string) => {
    if (error && /duplicate|unique|already exists|bus_number/i.test(error)) {
      return `Bus number "${busNumber.trim()}" already exists. Choose a different one.`;
    }
    return error || fallback;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNumber = busNumber.trim();
    if (!trimmedNumber) {
      toast.error("Bus number is required");
      return;
    }

    let capacityValue: number | null = null;
    if (capacity.trim()) {
      const parsed = Number(capacity);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        toast.error("Capacity must be a positive whole number");
        return;
      }
      capacityValue = parsed;
    }

    setSubmitting(true);

    const payload = {
      bus_number: trimmedNumber,
      registration_number: registrationNumber.trim() || null,
      capacity: capacityValue,
      driver_id: driverId || null,
      is_active: isActive,
      notes: notes.trim() || null,
    };

    const result = editingBus
      ? await adminApi({
          action: "update",
          table: "buses",
          data: payload,
          match: { column: "id", value: editingBus.id },
        })
      : await adminApi({ action: "insert", table: "buses", data: payload });

    if (!result.success) {
      toast.error(
        friendlyBusError(result.error, editingBus ? "Failed to update bus" : "Failed to create bus")
      );
    } else {
      toast.success(editingBus ? "Bus updated successfully" : "Bus created successfully");
      setDialogOpen(false);
      resetForm();
      await fetchData();
    }

    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this bus? Its route (assigned stops) will also be removed."))
      return;

    const result = await adminApi({
      action: "delete",
      table: "buses",
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to delete bus");
      return;
    }

    toast.success("Bus deleted");
    await fetchData();
  };

  const openRouteDialog = async (bus: BusWithRelations) => {
    setRouteBus(bus);
    setRouteSearch("");
    setRouteDialogOpen(true);

    const { data, error } = await supabase
      .from("bus_route_stops")
      .select("id, bus_stop_id")
      .eq("bus_id", bus.id);

    if (error) {
      toast.error("Failed to load route");
      return;
    }

    const map = new Map<string, string>();
    for (const row of (data as Pick<BusRouteStop, "id" | "bus_stop_id">[]) ?? []) {
      map.set(row.bus_stop_id, row.id);
    }
    setOriginalRouteMap(map);
    setSelectedStopIds(new Set(map.keys()));
  };

  const toggleStop = (stopId: string) => {
    setSelectedStopIds((prev) => {
      const next = new Set(prev);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  };

  const filteredStops = useMemo(() => {
    const q = routeSearch.trim().toLowerCase();
    if (!q) return busStops;
    return busStops.filter((s) => s.name.toLowerCase().includes(q));
  }, [busStops, routeSearch]);

  const handleRouteSave = async () => {
    if (!routeBus) return;
    setRouteSubmitting(true);

    // Diff against the bus's original route.
    const toInsert = [...selectedStopIds].filter((id) => !originalRouteMap.has(id));
    const toDelete = [...originalRouteMap.entries()]
      .filter(([stopId]) => !selectedStopIds.has(stopId))
      .map(([, routeStopId]) => routeStopId);

    try {
      for (const stopId of toInsert) {
        const res = await adminApi({
          action: "insert",
          table: "bus_route_stops",
          data: { bus_id: routeBus.id, bus_stop_id: stopId },
        });
        if (!res.success) throw new Error(res.error || "Failed to add a stop");
      }
      for (const routeStopId of toDelete) {
        const res = await adminApi({
          action: "delete",
          table: "bus_route_stops",
          match: { column: "id", value: routeStopId },
        });
        if (!res.success) throw new Error(res.error || "Failed to remove a stop");
      }

      toast.success(
        `Route saved (${selectedStopIds.size} stop${selectedStopIds.size === 1 ? "" : "s"})`
      );
      setRouteDialogOpen(false);
      setRouteBus(null);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save route");
    } finally {
      setRouteSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Buses &amp; Routes
        </h1>
        <Button onClick={openAdd} className="bg-navy-900 hover:bg-navy-800 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Bus
        </Button>
      </div>

      <div className="erp-table-container p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : buses.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            No buses found. Add one to get started.
          </p>
        ) : (
          <>
          <TableFilterSummary
            ctl={table}
            total={buses.length}
            shown={table.rows.length}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <SortFilterHead ctl={table} col="bus_number" />
                <SortFilterHead ctl={table} col="driver" />
                <SortFilterHead ctl={table} col="capacity" />
                <SortFilterHead ctl={table} col="registration" />
                <SortFilterHead ctl={table} col="stops" />
                <SortFilterHead ctl={table} col="active" />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-gray-500 dark:text-gray-400">
                    No buses match the column filters.
                  </TableCell>
                </TableRow>
              )}
              {table.rows.map((bus) => (
                <TableRow key={bus.id}>
                  <TableCell className="font-medium">{bus.bus_number}</TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {bus.driver_name}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {bus.capacity ?? "—"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {bus.registration_number || "—"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {bus.stop_count && bus.stop_count > 0 ? (
                      <button
                        type="button"
                        onClick={() => setStopsBus(bus)}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-50 hover:underline dark:text-amber-400 dark:hover:bg-amber-950/30"
                        title="View stops served"
                      >
                        {bus.stop_count} {bus.stop_count === 1 ? "stop" : "stops"}
                      </button>
                    ) : (
                      <span className="text-gray-400">0 stops</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {bus.is_active ? (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openRouteDialog(bus)}
                        title="Manage Route"
                        aria-label="Manage route"
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <Route className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(bus)}
                        aria-label="Edit bus"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(bus.id)}
                        aria-label="Delete bus"
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

      {/* Add / Edit Bus Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
                <BusIcon className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <DialogTitle>{editingBus ? "Edit Bus" : "Add New Bus"}</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editingBus ? "Update bus details" : "Register a new bus"}
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Bus Number *</Label>
                <Input
                  value={busNumber}
                  onChange={(e) => setBusNumber(e.target.value)}
                  placeholder="e.g. Bus 1"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Registration No.</Label>
                <Input
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="e.g. UP80 AB 1234"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Capacity</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="e.g. 40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Driver</Label>
                <Select
                  value={driverId || "none"}
                  items={[
                    { value: "none", label: "None" },
                    ...drivers.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                  onValueChange={(val) => setDriverId(!val || val === "none" ? "" : val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select driver" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" label="None">
                      None
                    </SelectItem>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id} label={d.name}>
                        {d.name}
                        {d.phone ? ` (${d.phone})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingBus ? "Update Bus" : "Create Bus"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Stops Served Dialog (read-only) */}
      <Dialog open={!!stopsBus} onOpenChange={(open) => !open && setStopsBus(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <Route className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle>Stops Served</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {stopsBus
                    ? `${stopsBus.bus_number} · ${stopsBus.stop_count} ${
                        stopsBus.stop_count === 1 ? "stop" : "stops"
                      }`
                    : ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {(stopsBus?.stop_names?.length ?? 0) === 0 ? (
              <p className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                No stops assigned yet.
              </p>
            ) : (
              stopsBus?.stop_names?.map((name, i) => (
                <div
                  key={`${name}-${i}`}
                  className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {i + 1}
                  </span>
                  {name}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStopsBus(null)}
            >
              Close
            </Button>
            {stopsBus && (
              <Button
                type="button"
                className="bg-navy-900 hover:bg-navy-800 text-white"
                onClick={() => {
                  const bus = stopsBus;
                  setStopsBus(null);
                  openRouteDialog(bus);
                }}
              >
                <Route className="h-4 w-4 mr-2" />
                Manage Route
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Route Dialog */}
      <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <Route className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <DialogTitle>Manage Route</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {routeBus ? `${routeBus.bus_number} — select the stops this bus serves` : ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={routeSearch}
                onChange={(e) => setRouteSearch(e.target.value)}
                placeholder="Search stops…"
                className="pl-8"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{selectedStopIds.size} selected</span>
              <span>
                {filteredStops.length} of {busStops.length} stops
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {filteredStops.length === 0 ? (
                <p className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                  No stops match your search.
                </p>
              ) : (
                filteredStops.map((stop) => (
                  <label
                    key={stop.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-900/40"
                  >
                    <Checkbox
                      checked={selectedStopIds.has(stop.id)}
                      onCheckedChange={() => toggleStop(stop.id)}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {stop.name}
                      {stop.area ? (
                        <span className="text-gray-400"> · {stop.area}</span>
                      ) : null}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRouteDialogOpen(false)}
              disabled={routeSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={routeSubmitting}
              onClick={handleRouteSave}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {routeSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
