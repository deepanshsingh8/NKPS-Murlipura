"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
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
import { Bus, MapPin, User, Navigation, Loader2, Users, Send } from "lucide-react";
import { toast } from "sonner";
import type {
  BusStop,
  Bus as BusType,
  TransportDirection,
  TransportChangeType,
  TransportChangeReason,
  TransportChangeStatus,
} from "@nkps/shared/types";

interface ChildOption {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
}

interface AssignedTransport {
  enrollment_id: string;
  has_transport: boolean;
  stop_name: string | null;
  bus_number: string | null;
  driver_name: string | null;
  direction: TransportDirection;
  fee_amount: number | null;
  fee_frequency: string | null;
  is_custom_fee: boolean;
}

interface ChangeRequestRow {
  id: string;
  change_type: TransportChangeType;
  effective_from: string;
  effective_to: string | null;
  reason_code: TransportChangeReason;
  status: TransportChangeStatus;
  created_at: string;
}

const CHANGE_TYPE_LABELS: Record<TransportChangeType, string> = {
  bus_change: "Bus change",
  stop_change: "Stop change",
  direction_change: "Direction change",
  drop: "Drop transport",
  resume: "Resume transport",
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

// Parent-submittable subset (direction_change / resume are office-only).
const PARENT_CHANGE_TYPES: TransportChangeType[] = ["bus_change", "stop_change", "drop"];

// Parent-selectable reasons (one_side_facility is office-only).
const PARENT_REASONS: { value: TransportChangeReason; label: string }[] = [
  { value: "house_shifting", label: "House shifting" },
  { value: "rented_house_change", label: "Rented house change" },
  { value: "bus_point_temporary_change", label: "Temporary bus-point change" },
  { value: "facility_dropped", label: "Facility dropped" },
  { value: "other", label: "Other" },
];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

export default function ParentTransportPage() {
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingChild, setLoadingChild] = useState(false);

  const [assigned, setAssigned] = useState<AssignedTransport | null>(null);
  const [requests, setRequests] = useState<ChangeRequestRow[]>([]);

  // Dropdown data
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [buses, setBuses] = useState<BusType[]>([]);

  // Form state
  const [changeType, setChangeType] = useState<TransportChangeType>("stop_change");
  const [amendedBusId, setAmendedBusId] = useState("");
  const [amendedStopId, setAmendedStopId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [reasonCode, setReasonCode] = useState<TransportChangeReason>("house_shifting");
  const [reasonNote, setReasonNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch children + static dropdowns on mount.
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("parent_id")
        .eq("id", user.id)
        .single();
      const parentId = profile?.parent_id;
      if (!parentId) {
        setLoading(false);
        return;
      }

      const [{ data: studentParents }, { data: stopsData }, { data: busesData }] =
        await Promise.all([
          supabase
            .from("student_parents")
            .select("student_id, students(id, full_name)")
            .eq("parent_id", parentId),
          supabase.from("bus_stops").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("buses").select("*").eq("is_active", true).order("bus_number"),
        ]);

      setBusStops((stopsData as BusStop[]) ?? []);
      setBuses((busesData as BusType[]) ?? []);

      if (!studentParents || studentParents.length === 0) {
        setLoading(false);
        return;
      }

      const childOptions: ChildOption[] = [];
      for (const sp of studentParents) {
        const student = sp.students as unknown as { id: string; full_name: string };
        if (!student) continue;
        const { data: enrollment } = await supabase
          .from("student_enrollments")
          .select("classes(name, section)")
          .eq("student_id", student.id)
          .order("enrollment_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const classInfo = enrollment?.classes as unknown as {
          name: string;
          section: string;
        } | null;
        childOptions.push({
          student_id: student.id,
          full_name: student.full_name,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
        });
      }

      setChildren(childOptions);
      setSelectedChild(childOptions[0]?.student_id ?? "");
      setLoading(false);
    }
    init();
  }, []);

  // Load the selected child's transport assignment + change requests.
  const loadChild = async (studentId: string) => {
    setLoadingChild(true);
    const supabase = createClient();

    const { data: enrollment } = await supabase
      .from("student_enrollments")
      .select(
        "id, has_transport, bus_stop_id, bus_id, transport_direction, transport_fee_override, academic_year_id, bus_stops(name), buses(bus_number, staff_members:driver_id(name))"
      )
      .eq("student_id", studentId)
      .order("enrollment_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!enrollment) {
      setAssigned(null);
      setRequests([]);
      setLoadingChild(false);
      return;
    }

    const stopName =
      (enrollment.bus_stops as unknown as { name: string } | null)?.name ?? null;
    const busInfo = enrollment.buses as unknown as {
      bus_number: string;
      staff_members: { name: string } | null;
    } | null;
    const direction =
      (enrollment.transport_direction as TransportDirection | null) ?? "both";
    const override = (enrollment.transport_fee_override as number | null) ?? null;

    // Monthly stop fee for the active academic year.
    let feeAmount: number | null = override;
    let feeFrequency: string | null = override != null ? "monthly" : null;
    if (override == null && enrollment.bus_stop_id && enrollment.academic_year_id) {
      const { data: stopFee } = await supabase
        .from("bus_stop_fees")
        .select("amount, frequency")
        .eq("bus_stop_id", enrollment.bus_stop_id)
        .eq("academic_year_id", enrollment.academic_year_id)
        .eq("is_active", true)
        .maybeSingle();
      if (stopFee) {
        feeAmount = Number(stopFee.amount);
        feeFrequency = (stopFee.frequency as string) ?? null;
      }
    }

    setAssigned({
      enrollment_id: enrollment.id as string,
      has_transport: Boolean(enrollment.has_transport),
      stop_name: stopName,
      bus_number: busInfo?.bus_number ?? null,
      driver_name: busInfo?.staff_members?.name ?? null,
      direction,
      fee_amount: feeAmount,
      fee_frequency: feeFrequency,
      is_custom_fee: override != null,
    });

    const { data: reqData } = await supabase
      .from("transport_change_requests")
      .select(
        "id, change_type, effective_from, effective_to, reason_code, status, created_at"
      )
      .eq("enrollment_id", enrollment.id)
      .order("created_at", { ascending: false });
    setRequests((reqData as ChangeRequestRow[]) ?? []);

    setLoadingChild(false);
  };

  useEffect(() => {
    if (!selectedChild) return;
    loadChild(selectedChild);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild]);

  const resetForm = () => {
    setChangeType("stop_change");
    setAmendedBusId("");
    setAmendedStopId("");
    setEffectiveFrom("");
    setEffectiveTo("");
    setReasonCode("house_shifting");
    setReasonNote("");
    setFile(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigned) return;
    if (!effectiveFrom) {
      toast.error("Please choose an effective-from date");
      return;
    }
    if (changeType === "bus_change" && !amendedBusId) {
      toast.error("Please select the bus you want");
      return;
    }
    if (changeType === "stop_change" && !amendedStopId) {
      toast.error("Please select the new stop");
      return;
    }
    if (reasonCode === "other" && reasonNote.trim().length < 3) {
      toast.error("Please describe your reason");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const formData = new FormData();
      formData.append("enrollment_id", assigned.enrollment_id);
      formData.append("change_type", changeType);
      formData.append("effective_from", effectiveFrom);
      if (effectiveTo) formData.append("effective_to", effectiveTo);
      formData.append("reason_code", reasonCode);
      if (reasonNote.trim()) formData.append("reason_note", reasonNote.trim());
      if (changeType === "bus_change") formData.append("amended_bus_id", amendedBusId);
      if (changeType === "stop_change") formData.append("amended_stop_id", amendedStopId);
      if (file) formData.append("file", file);

      const res = await fetch("/api/portal/transport/change-request", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to submit request");
        return;
      }
      toast.success("Request submitted for office review");
      resetForm();
      await loadChild(selectedChild);
    } catch {
      toast.error("Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
      </div>
    );
  }

  const selectedChildInfo = children.find((c) => c.student_id === selectedChild);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Transport
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            View your child&apos;s bus assignment and request changes.
          </p>
        </div>

        {children.length > 1 && (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-400" />
            <select
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-card px-3 py-2 text-sm text-navy-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
            >
              {children.map((child) => (
                <option key={child.student_id} value={child.student_id}>
                  {child.full_name}
                  {child.class_name ? ` (${child.class_name} - ${child.section})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedChildInfo && children.length <= 1 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing transport for{" "}
          <span className="font-medium text-navy-900 dark:text-white">
            {selectedChildInfo.full_name}
          </span>
          {selectedChildInfo.class_name &&
            ` | ${selectedChildInfo.class_name} - ${selectedChildInfo.section}`}
        </p>
      )}

      {loadingChild ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-navy-900 dark:text-white" />
        </div>
      ) : (
        <>
          {/* Assignment */}
          {assigned?.has_transport ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="erp-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                    <MapPin className="h-5 w-5 text-gold-500" />
                    Stop
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold text-navy-900 dark:text-white">
                    {assigned.stop_name ?? "—"}
                  </p>
                </CardContent>
              </Card>

              <Card className="erp-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                    <Bus className="h-5 w-5 text-gold-500" />
                    Bus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold text-navy-900 dark:text-white">
                    {assigned.bus_number ?? "—"}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <User className="h-3.5 w-3.5" />
                    {assigned.driver_name ?? "Driver not assigned"}
                  </p>
                </CardContent>
              </Card>

              <Card className="erp-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                    <Navigation className="h-5 w-5 text-gold-500" />
                    Direction
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold text-navy-900 dark:text-white">
                    {assigned.direction === "both"
                      ? "Both sides"
                      : DIRECTION_LABELS[assigned.direction]}
                  </p>
                </CardContent>
              </Card>

              <Card className="erp-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-navy-900 dark:text-white text-base">
                    <Bus className="h-5 w-5 text-gold-500" />
                    Monthly Fee
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold text-navy-900 dark:text-white">
                    {assigned.fee_amount != null
                      ? formatCurrency(assigned.fee_amount)
                      : "—"}
                  </p>
                  {assigned.fee_frequency && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">
                      {assigned.fee_frequency.replace("_", " ")}
                      {assigned.is_custom_fee ? " · custom" : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="erp-card">
              <CardContent className="p-10 text-center">
                <Bus className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-navy-900 dark:text-white font-medium">
                  Not availing school transport
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Contact the school office to opt in to bus transport.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Request a change */}
          {assigned && (
            <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-navy-900 dark:text-white">
                  Request a change
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Change Type</Label>
                      <Select
                        value={changeType}
                        items={PARENT_CHANGE_TYPES.map((t) => ({
                          value: t,
                          label: CHANGE_TYPE_LABELS[t],
                        }))}
                        onValueChange={(val) =>
                          val && setChangeType(val as TransportChangeType)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PARENT_CHANGE_TYPES.map((t) => (
                            <SelectItem key={t} value={t} label={CHANGE_TYPE_LABELS[t]}>
                              {CHANGE_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Reason</Label>
                      <Select
                        value={reasonCode}
                        items={PARENT_REASONS}
                        onValueChange={(val) =>
                          val && setReasonCode(val as TransportChangeReason)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PARENT_REASONS.map((r) => (
                            <SelectItem key={r.value} value={r.value} label={r.label}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {changeType === "bus_change" && (
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Requested Bus</Label>
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
                      <Label className="text-xs font-medium">Requested Stop</Label>
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <span className="text-gray-400">(optional)</span>
                      </Label>
                      <Input
                        type="date"
                        value={effectiveTo}
                        onChange={(e) => setEffectiveTo(e.target.value)}
                      />
                    </div>
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
                      placeholder="Anything the office should know"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium">
                      Application{" "}
                      <span className="text-gray-400">(optional, PDF/JPG/PNG)</span>
                    </Label>
                    <Input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="bg-navy-900 hover:bg-navy-800 text-white"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Submit Request
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* My requests */}
          <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-navy-900 dark:text-white">
                My Change Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  No change requests yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {CHANGE_TYPE_LABELS[r.change_type]}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {r.effective_to
                            ? `${r.effective_from} → ${r.effective_to}`
                            : `${r.effective_from} · Permanent`}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-300">
                          {r.created_at.slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_STYLES[r.status]}>
                            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
