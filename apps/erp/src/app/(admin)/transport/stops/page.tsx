"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
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
import {
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MapPin,
  IndianRupee,
  Search,
} from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import type { BusStop, BusStopFee, AcademicYear } from "@nkps/shared/types";

interface BusStopWithFee extends BusStop {
  fee?: BusStopFee;
}

export default function TransportStopsPage() {
  const [stops, setStops] = useState<BusStopWithFee[]>([]);
  const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Stop add/edit dialog state
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [editingStop, setEditingStop] = useState<BusStopWithFee | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState("true");

  // Fee dialog state
  const [feeDialogOpen, setFeeDialogOpen] = useState(false);
  const [feeTargetStop, setFeeTargetStop] = useState<BusStopWithFee | null>(null);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeSubmitting, setFeeSubmitting] = useState(false);

  const supabase = createClient();

  const fetchData = async () => {
    setLoading(true);

    // Resolve the active academic year: prefer is_current, else newest by name.
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

    // Load stops and this year's fees in parallel.
    const [stopsRes, feesRes] = await Promise.all([
      supabase
        .from("bus_stops")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      year
        ? supabase
            .from("bus_stop_fees")
            .select("*")
            .eq("academic_year_id", year.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (stopsRes.error) {
      toast.error("Failed to load bus stops");
      setLoading(false);
      return;
    }

    const feeByStop = new Map<string, BusStopFee>();
    ((feesRes.data as BusStopFee[] | null) ?? []).forEach((fee) => {
      feeByStop.set(fee.bus_stop_id, fee);
    });

    const enriched: BusStopWithFee[] = ((stopsRes.data as BusStop[]) ?? []).map(
      (stop) => ({ ...stop, fee: feeByStop.get(stop.id) })
    );

    setStops(enriched);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredStops = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stops;
    return stops.filter((s) => s.name.toLowerCase().includes(q));
  }, [stops, search]);

  const resetStopForm = () => {
    setName("");
    setIsActive("true");
  };

  const openAddStop = () => {
    setEditingStop(null);
    resetStopForm();
    setStopDialogOpen(true);
  };

  const openEditStop = (stop: BusStopWithFee) => {
    setEditingStop(stop);
    setName(stop.name);
    setIsActive(stop.is_active ? "true" : "false");
    setStopDialogOpen(true);
  };

  const handleStopSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Stop name is required");
      return;
    }
    setSubmitting(true);

    const payload = {
      name: trimmedName,
      is_active: isActive === "true",
    };

    const result = editingStop
      ? await adminApi({
          action: "update",
          table: "bus_stops",
          data: payload,
          match: { column: "id", value: editingStop.id },
        })
      : await adminApi({
          action: "insert",
          table: "bus_stops",
          data: payload,
        });

    if (!result.success) {
      toast.error(
        result.error || `Failed to ${editingStop ? "update" : "create"} stop`
      );
    } else {
      toast.success(`Stop ${editingStop ? "updated" : "created"}`);
      setStopDialogOpen(false);
      setEditingStop(null);
      resetStopForm();
      await fetchData();
    }
    setSubmitting(false);
  };

  const handleDeleteStop = async (stop: BusStopWithFee) => {
    if (
      !confirm(
        `Delete stop "${stop.name}"? This also removes its fee for all years.`
      )
    )
      return;

    const result = await adminApi({
      action: "delete",
      table: "bus_stops",
      match: { column: "id", value: stop.id },
    });

    if (!result.success) {
      toast.error(result.error || "Failed to delete stop");
      return;
    }
    toast.success("Stop deleted");
    await fetchData();
  };

  const openFeeDialog = (stop: BusStopWithFee) => {
    setFeeTargetStop(stop);
    setFeeAmount(stop.fee ? String(stop.fee.amount) : "");
    setFeeDialogOpen(true);
  };

  const handleFeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feeTargetStop) return;
    if (!activeYear) {
      toast.error("No active academic year found");
      return;
    }
    const amount = Number(feeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    setFeeSubmitting(true);

    const existingFee = feeTargetStop.fee;
    const result = existingFee
      ? await adminApi({
          action: "update",
          table: "bus_stop_fees",
          data: { amount },
          match: { column: "id", value: existingFee.id },
        })
      : await adminApi({
          action: "insert",
          table: "bus_stop_fees",
          data: {
            bus_stop_id: feeTargetStop.id,
            academic_year_id: activeYear.id,
            amount,
            frequency: "monthly",
            is_active: true,
          },
        });

    if (!result.success) {
      toast.error(result.error || "Failed to save fee");
    } else {
      toast.success("Fee saved");
      setFeeDialogOpen(false);
      setFeeTargetStop(null);
      await fetchData();
    }
    setFeeSubmitting(false);
  };

  const formatFee = (fee?: BusStopFee) =>
    fee ? `₹${fee.amount.toLocaleString("en-IN")}` : "—";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Stops & Fees
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Monthly fees shown for{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {activeYear ? activeYear.name : "—"}
            </span>
          </p>
        </div>
        <Button
          onClick={openAddStop}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Stop
        </Button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="erp-table-container p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : filteredStops.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            {stops.length === 0
              ? "No bus stops found. Add one to get started."
              : "No stops match your search."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stop Name</TableHead>
                <TableHead>Monthly Fee</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStops.map((stop) => (
                <TableRow key={stop.id}>
                  <TableCell className="font-medium">{stop.name}</TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {formatFee(stop.fee)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        stop.is_active
                          ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400"
                          : "inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }
                    >
                      {stop.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openFeeDialog(stop)}
                        title="Set monthly fee"
                        aria-label="Set monthly fee"
                        className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                      >
                        <IndianRupee className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditStop(stop)}
                        aria-label="Edit stop"
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteStop(stop)}
                        aria-label="Delete stop"
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
        )}
      </div>

      {/* Add / Edit Stop Dialog */}
      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
                <MapPin className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <DialogTitle>
                  {editingStop ? "Edit Stop" : "Add New Stop"}
                </DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editingStop
                    ? "Update stop details"
                    : "Create a new bus stop"}
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleStopSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Stop Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Model Town Chowk"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Status</Label>
              <Select
                value={isActive}
                items={[
                  { value: "true", label: "Active" },
                  { value: "false", label: "Inactive" },
                ]}
                onValueChange={(val) => val && setIsActive(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true" label="Active">
                    Active
                  </SelectItem>
                  <SelectItem value="false" label="Inactive">
                    Inactive
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStopDialogOpen(false)}
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
                {editingStop ? "Update Stop" : "Create Stop"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Fee Dialog */}
      <Dialog open={feeDialogOpen} onOpenChange={setFeeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10">
                <IndianRupee className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <DialogTitle>Set Monthly Fee</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {feeTargetStop ? feeTargetStop.name : ""}
                  {activeYear ? ` — ${activeYear.name}` : ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleFeeSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Monthly Fee (₹)</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder="e.g. 1200"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFeeDialogOpen(false)}
                disabled={feeSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={feeSubmitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {feeSubmitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Fee
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
