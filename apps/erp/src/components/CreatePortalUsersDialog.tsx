"use client";

import { useState } from "react";
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
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import {
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Mail,
} from "lucide-react";

interface PortalItem {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
}

interface CreateResult {
  id: string;
  name: string;
  success: boolean;
  error?: string;
}

interface CreatePortalUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "student" | "staff";
  items: PortalItem[];
  onComplete: () => void;
}

export function CreatePortalUsersDialog({
  open,
  onOpenChange,
  type,
  items,
  onComplete,
}: CreatePortalUsersDialogProps) {
  const [step, setStep] = useState<"confirm" | "progress" | "results">("confirm");
  const [results, setResults] = useState<CreateResult[]>([]);
  const [summary, setSummary] = useState({ created: 0, failed: 0, total: 0 });

  const ready = items.filter((i) => i.email);
  const skipped = items.filter((i) => !i.email);
  const label = type === "student" ? "student" : "staff member";
  const labelPlural = type === "student" ? "students" : "staff members";

  const resetState = () => {
    setStep("confirm");
    setResults([]);
    setSummary({ created: 0, failed: 0, total: 0 });
  };

  const handleClose = (isOpen: boolean) => {
    if (step === "progress") return; // prevent closing during creation
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  const handleCreate = async () => {
    setStep("progress");

    try {
      const res = await adminFetch("/api/portal/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          items: ready.map((i) => ({
            id: i.id,
            email: i.email,
            fullName: i.name,
            phone: i.phone || null,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResults([{ id: "", name: "", success: false, error: data.error || "Request failed" }]);
        setSummary({ created: 0, failed: ready.length, total: ready.length });
      } else {
        setResults(data.results || []);
        setSummary({
          created: data.created || 0,
          failed: data.failed || 0,
          total: data.total || 0,
        });
      }
    } catch {
      setResults([{ id: "", name: "", success: false, error: "Network error" }]);
      setSummary({ created: 0, failed: ready.length, total: ready.length });
    }

    setStep("results");
    onComplete();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
              <UserPlus className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <DialogTitle>Create Portal Users</DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === "confirm"
                  ? `Create login accounts for selected ${labelPlural}`
                  : step === "progress"
                  ? "Creating accounts..."
                  : "Creation complete"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Mail className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium text-green-700">
                  {ready.length} {label}{ready.length === 1 ? "" : "s"} ready
                </p>
              </div>
              <p className="text-xs text-green-600">
                Portal accounts will be created and welcome emails sent with temporary passwords.
              </p>
            </div>

            {skipped.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-medium text-amber-700">
                    {skipped.length} {label}{skipped.length === 1 ? "" : "s"} skipped — no email
                  </p>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {skipped.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className="text-amber-700 truncate">{s.name}</span>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-600 text-[10px] shrink-0">
                        No email
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={ready.length === 0}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Create {ready.length} User{ready.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "progress" && (
          <div className="py-8 text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-violet-500 mx-auto" />
            <div>
              <p className="text-sm font-medium text-navy-900 dark:text-white">
                Creating portal accounts...
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Processing {ready.length} {label}{ready.length === 1 ? "" : "s"}. This may take a moment.
              </p>
            </div>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{summary.created}</p>
                <p className="text-xs text-green-600">Created</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{summary.failed}</p>
                <p className="text-xs text-red-600">Failed</p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-center">
                <p className="text-2xl font-bold text-gray-700">{skipped.length}</p>
                <p className="text-xs text-gray-500">Skipped</p>
              </div>
            </div>

            {summary.created > 0 && summary.failed === 0 && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-1" />
                <p className="text-sm font-medium text-green-700">
                  All accounts created successfully!
                </p>
              </div>
            )}

            {/* Failed items detail */}
            {summary.failed > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <p className="text-sm font-medium text-red-700">
                    {summary.failed} failed
                  </p>
                </div>
                <div className="border rounded-xl overflow-hidden">
                  <div className="overflow-y-auto max-h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results
                          .filter((r) => !r.success)
                          .map((r) => (
                            <TableRow key={r.id} className="bg-red-50/50">
                              <TableCell className="text-xs font-medium">{r.name}</TableCell>
                              <TableCell className="text-xs text-red-600">{r.error}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
