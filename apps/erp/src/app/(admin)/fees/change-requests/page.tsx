"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@nkps/shared/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@nkps/shared/components/ui/dialog";
import { Loader2, Inbox, Check, X, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

interface ChangeRequest {
  id: string;
  target_table: string;
  target_id: string;
  action: "update" | "delete";
  current_snapshot: Record<string, unknown>;
  proposed_changes: Record<string, unknown>;
  reason: string;
  status: RequestStatus;
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
}

interface RequestDetail {
  request: ChangeRequest;
  live_row: Record<string, unknown> | null;
}

const STATUS_TABS: Array<{ value: RequestStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_COLORS: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-IN");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

function summarizeProposedChanges(
  action: "update" | "delete",
  proposed: Record<string, unknown>
): string {
  if (action === "delete") return "Delete this payment row";
  const keys = Object.keys(proposed);
  if (keys.length === 0) return "—";
  if (keys.length === 1) {
    const [k] = keys;
    return `${k}: ${formatValue(proposed[k])}`;
  }
  return keys.map((k) => `${k}: ${formatValue(proposed[k])}`).join(" · ");
}

export default function FeeChangeRequestsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userRole, setUserRole] = useState<"admin" | "editor" | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<RequestStatus>("pending");
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  // Load caller identity once. Drives admin vs editor branching for the
  // approve/reject/cancel action set.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setUserRole(data?.role === "admin" ? "admin" : "editor");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const fetchList = useCallback(
    async (status: RequestStatus) => {
      setLoading(true);
      try {
        const res = await adminFetch(
          `/api/fees/change-requests?status=${status}`
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to load change requests");
          setRequests([]);
          return;
        }
        setRequests(data.requests ?? []);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (userRole === null) return;
    fetchList(activeTab);
  }, [userRole, activeTab, fetchList]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setReviewNotes("");
    try {
      const res = await adminFetch(`/api/fees/change-requests/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load request");
        return;
      }
      setDetail(data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const doAction = useCallback(
    async (id: string, action: "approve" | "reject" | "cancel") => {
      setSubmitting(true);
      try {
        const res = await adminFetch(
          `/api/fees/change-requests/${id}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ review_notes: reviewNotes }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? `Failed to ${action} request`);
          return;
        }
        toast.success(
          action === "approve"
            ? "Request approved — change applied."
            : action === "reject"
              ? "Request rejected."
              : "Request cancelled."
        );
        setDetail(null);
        setReviewNotes("");
        fetchList(activeTab);
      } finally {
        setSubmitting(false);
      }
    },
    [reviewNotes, activeTab, fetchList]
  );

  const renderTable = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
          Loading…
        </div>
      );
    }
    if (requests.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
          <Inbox className="h-10 w-10 mb-2 opacity-50" />
          <p className="text-sm">No {activeTab} requests.</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {requests.map((r) => (
          <Card
            key={r.id}
            className="cursor-pointer hover:border-navy-300 dark:hover:border-navy-700 transition-colors"
            onClick={() => openDetail(r.id)}
          >
            <CardContent className="py-3 px-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {r.action}
                  </Badge>
                  <Badge className={`text-[10px] ${STATUS_COLORS[r.status]}`}>
                    {r.status}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {r.target_table === "fee_payments" ? "Payment" : r.target_table}
                  </span>
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                  {summarizeProposedChanges(r.action, r.proposed_changes)}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                  <span className="font-medium">Reason:</span> {r.reason}
                </p>
              </div>
              <div className="text-right text-xs text-gray-500 dark:text-gray-400 shrink-0">
                <div>{r.requested_by_name ?? "Unknown"}</div>
                <div>{formatTimestamp(r.requested_at)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  const isAdmin = userRole === "admin";
  const detailReq = detail?.request;

  // Drift detection — flag when the live row no longer matches what the
  // editor saw at request time. The admin should refresh and decide.
  const driftKeys = useMemo(() => {
    if (!detail || !detail.live_row) return [] as string[];
    const snap = detail.request.current_snapshot ?? {};
    const live = detail.live_row;
    const keys = new Set<string>([
      ...Object.keys(snap),
      ...Object.keys(live),
    ]);
    const drifted: string[] = [];
    for (const k of keys) {
      if (JSON.stringify((snap as Record<string, unknown>)[k]) !== JSON.stringify(live[k])) {
        drifted.push(k);
      }
    }
    return drifted;
  }, [detail]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-heading font-semibold text-navy-900 dark:text-white">
          Fee Change Requests
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {isAdmin
            ? "Editor-filed proposals to modify recorded fee payments. Approve to apply the change, reject to leave the original record untouched."
            : "Your requests to modify recorded fee payments. An admin reviews each request before any change applies."}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as RequestStatus)}>
        <TabsList variant="line" className="mb-4">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {STATUS_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {renderTable()}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog
        open={detail !== null || detailLoading}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setReviewNotes("");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Change Request</DialogTitle>
          </DialogHeader>
          {detailLoading || !detailReq ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="uppercase">
                  {detailReq.action}
                </Badge>
                <Badge className={STATUS_COLORS[detailReq.status]}>
                  {detailReq.status}
                </Badge>
                <span className="text-xs text-gray-500">
                  Filed by {detailReq.requested_by_name ?? "Unknown"} ·{" "}
                  {formatTimestamp(detailReq.requested_at)}
                </span>
              </div>

              {driftKeys.length > 0 && (
                <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Row drifted since this request was filed.</p>
                    <p className="mt-1">
                      {driftKeys.length} column{driftKeys.length === 1 ? "" : "s"}{" "}
                      changed: {driftKeys.join(", ")}. Approving will overwrite the
                      live values with the proposed ones. Refresh to re-check.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Reason</h3>
                <p className="text-sm whitespace-pre-wrap">{detailReq.reason}</p>
              </div>

              {detailReq.action === "update" ? (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                    Proposed change
                  </h3>
                  <div className="rounded-md border bg-gray-50 dark:bg-muted/40">
                    <div className="grid grid-cols-[1fr_auto_1fr] text-xs">
                      <div className="px-3 py-2 font-medium border-b border-r">Field</div>
                      <div className="px-3 py-2 font-medium border-b">Current</div>
                      <div className="px-3 py-2 font-medium border-b border-l">Proposed</div>
                      {Object.keys(detailReq.proposed_changes).map((k) => (
                        <DiffRow
                          key={k}
                          field={k}
                          current={
                            (detailReq.current_snapshot as Record<string, unknown>)[k]
                          }
                          proposed={detailReq.proposed_changes[k]}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-900 dark:text-red-200">
                  Approving this request will DELETE the payment row. The
                  receipt and audit trail are kept in the audit log.
                </div>
              )}

              {detailReq.status === "pending" && (
                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500 mb-1 block">
                    Review notes (optional)
                  </label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={2}
                    placeholder="Anything you want the requester to see…"
                    className="w-full rounded-md border border-gray-200 dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
                  />
                </div>
              )}

              {detailReq.status !== "pending" && detailReq.review_notes && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Review notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{detailReq.review_notes}</p>
                  {detailReq.reviewed_by_name && detailReq.reviewed_at && (
                    <p className="text-xs text-gray-500 mt-1">
                      {detailReq.reviewed_by_name} ·{" "}
                      {formatTimestamp(detailReq.reviewed_at)}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t flex-wrap">
                <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
                {detailReq.status === "pending" && (
                  <>
                    {(isAdmin || detailReq.requested_by === userId) && (
                      <Button
                        variant="outline"
                        onClick={() => doAction(detailReq.id, "cancel")}
                        disabled={submitting}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Cancel request
                      </Button>
                    )}
                    {isAdmin && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => doAction(detailReq.id, "reject")}
                          disabled={submitting}
                          className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                        >
                          <X className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          onClick={() => doAction(detailReq.id, "approve")}
                          disabled={submitting}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          {submitting ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4 mr-1" />
                          )}
                          Approve & apply
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DiffRow({
  field,
  current,
  proposed,
}: {
  field: string;
  current: unknown;
  proposed: unknown;
}) {
  const changed = JSON.stringify(current) !== JSON.stringify(proposed);
  return (
    <>
      <div className="px-3 py-2 border-b border-r text-gray-700 dark:text-gray-300">
        {field}
      </div>
      <div className="px-3 py-2 border-b text-gray-700 dark:text-gray-300">
        {formatValue(current)}
      </div>
      <div
        className={`px-3 py-2 border-b border-l ${
          changed
            ? "bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-200 font-medium"
            : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {formatValue(proposed)}
      </div>
    </>
  );
}
