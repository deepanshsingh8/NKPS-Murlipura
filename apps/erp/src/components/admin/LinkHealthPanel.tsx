"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  ShieldAlert,
  Wrench,
} from "lucide-react";

interface HealthRow {
  category: string;
  subject_id: string;
  subject_label: string | null;
  detail: string;
}

interface HealthResponse {
  total: number;
  errorCount: number;
  infoCount: number;
  groups: Record<string, HealthRow[]>;
}

const CATEGORY_LABELS: Record<string, string> = {
  orphaned_profile: "Orphaned accounts (role set, not linked)",
  role_link_mismatch: "Role / link mismatch",
  duplicate_teacher_claim: "Duplicate teacher claims",
  duplicate_student_claim: "Duplicate student claims",
  duplicate_parent_claim: "Duplicate parent claims",
  unclaimed_student: "Students yet to claim their login",
  parent_without_children: "Parent records with no children",
  student_without_guardian_account: "Students with no guardian login",
};

const ERROR_CATEGORIES = new Set([
  "orphaned_profile",
  "role_link_mismatch",
  "duplicate_teacher_claim",
  "duplicate_student_claim",
  "duplicate_parent_claim",
]);

/**
 * Surfaces cross-role linking anomalies from the profile_link_health view so an
 * admin can SEE and fix the silent failures (e.g. a parent stuck unlinked) that
 * used to be invisible. Self-contained: fetches its own data.
 */
export function LinkHealthPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/link-health");
      if (res.ok) setData(await res.json());
    } catch {
      /* surfaced by the empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const repairOrphanParent = async (profileId: string) => {
    setRepairing(profileId);
    try {
      const res = await adminFetch("/api/admin/link-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Repair failed");
        return;
      }
      toast.success(json.note || "Account link repaired.");
      await load();
      onChanged?.();
    } catch {
      toast.error("Repair failed");
    } finally {
      setRepairing(null);
    }
  };

  if (loading) {
    return (
      <Card className="erp-card">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking account links…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // All clear.
  if (data.total === 0) {
    return (
      <Card className="erp-card border-green-200 dark:border-green-900/40">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" /> All accounts are correctly linked.
        </CardContent>
      </Card>
    );
  }

  const categories = Object.keys(data.groups).sort((a, b) => {
    const ae = ERROR_CATEGORIES.has(a) ? 0 : 1;
    const be = ERROR_CATEGORIES.has(b) ? 0 : 1;
    return ae - be;
  });

  return (
    <Card className="erp-card border-amber-200 dark:border-amber-900/40">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardTitle className="flex items-center justify-between text-navy-900 dark:text-white">
          <span className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Account link health
          </span>
          <span className="flex items-center gap-2">
            {data.errorCount > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {data.errorCount} to fix
              </Badge>
            )}
            {data.infoCount > 0 && (
              <Badge className="bg-gray-100 text-gray-600 dark:bg-muted dark:text-gray-300">
                {data.infoCount} info
              </Badge>
            )}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-5">
          {categories.map((cat) => {
            const rows = data.groups[cat];
            const isError = ERROR_CATEGORIES.has(cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  {isError ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-gray-400" />
                  )}
                  <h4 className="text-sm font-medium text-navy-900 dark:text-white">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </h4>
                  <Badge className="bg-gray-100 text-gray-600 dark:bg-muted dark:text-gray-300 text-xs">
                    {rows.length}
                  </Badge>
                </div>
                <ul className="space-y-1.5 pl-6">
                  {rows.slice(0, 25).map((row) => (
                    <li
                      key={`${cat}:${row.subject_id}`}
                      className="flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-400"
                    >
                      <span>
                        <span className="font-medium text-navy-900 dark:text-gray-200">
                          {row.subject_label || row.subject_id}
                        </span>{" "}
                        — {row.detail}
                      </span>
                      {(cat === "role_link_mismatch" ||
                        (cat === "orphaned_profile" &&
                          row.detail.includes("parent"))) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs shrink-0"
                          disabled={repairing === row.subject_id}
                          onClick={() => repairOrphanParent(row.subject_id)}
                        >
                          {repairing === row.subject_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wrench className="h-3 w-3" />
                          )}
                          Fix
                        </Button>
                      )}
                    </li>
                  ))}
                  {rows.length > 25 && (
                    <li className="text-xs text-gray-400">
                      …and {rows.length - 25} more
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
