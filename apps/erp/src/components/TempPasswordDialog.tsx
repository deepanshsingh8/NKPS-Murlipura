"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Button } from "@nkps/shared/components/ui/button";
import { Badge } from "@nkps/shared/components/ui/badge";
import { toast } from "sonner";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

export interface TempPasswordTarget {
  id: string;
  full_name: string;
  email: string;
  /** True while the account has never set a password of its own. */
  must_change_password: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: TempPasswordTarget[];
  /** Refreshes the caller's profile list after a reset flips the pending flag. */
  onChanged?: () => void;
}

interface VaultStatus {
  user_id: string;
  issued_at: string;
  last_revealed_at: string | null;
  reveal_count: number;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Hands an account's temporary password back to an admin so it can be passed
 * on in person — the fallback for when the welcome email never arrived.
 *
 * Works for one user (the row action) or many (the "Pending logins" view). A
 * password is only ever shown while the account still has
 * `must_change_password` set; once the user picks their own password the
 * server drops the stored one and this dialog can only offer a full reset.
 */
export function TempPasswordDialog({
  open,
  onOpenChange,
  targets,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, VaultStatus>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);

  const ids = targets.map((t) => t.id).join(",");

  const loadStatuses = useCallback(async () => {
    if (!ids) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `/api/users/temp-password?ids=${encodeURIComponent(ids)}`
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to load password status");
        return;
      }
      const map: Record<string, VaultStatus> = {};
      for (const row of (data.credentials ?? []) as VaultStatus[]) {
        map[row.user_id] = row;
      }
      setStatuses(map);
    } catch {
      toast.error("Failed to load password status");
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    if (!open) return;
    loadStatuses();
  }, [open, loadStatuses]);

  // Closing clears the revealed plaintext. Done here rather than in an effect
  // so no render ever happens with a closed dialog still holding passwords.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRevealed({});
      setConfirmResetId(null);
    }
    onOpenChange(next);
  };

  const copy = async (value: string, label = "Password") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy — select the text and copy manually");
    }
  };

  const handleReveal = async (target: TempPasswordTarget) => {
    if (revealed[target.id]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      return;
    }

    setBusyId(target.id);
    try {
      const res = await adminFetch("/api/users/temp-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal", id: target.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to reveal the password");
        if (data.can_issue) await loadStatuses();
        return;
      }
      setRevealed((prev) => ({ ...prev, [target.id]: data.password }));
      await loadStatuses();
    } catch {
      toast.error("Failed to reveal the password");
    } finally {
      setBusyId(null);
    }
  };

  const runIssue = async (
    action: "issue" | "reset",
    targetIds: string[]
  ): Promise<boolean> => {
    const res = await adminFetch("/api/users/temp-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: targetIds }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to issue passwords");
      return false;
    }

    const next: Record<string, string> = {};
    for (const r of (data.results ?? []) as {
      id: string;
      name: string;
      password?: string;
      error?: string;
    }[]) {
      if (r.password) next[r.id] = r.password;
      else if (r.error) toast.error(`${r.name || r.id}: ${r.error}`);
    }
    setRevealed((prev) => ({ ...prev, ...next }));

    if (data.issued > 0) {
      toast.success(
        `New temporary password issued for ${data.issued} account${
          data.issued === 1 ? "" : "s"
        }`
      );
    }
    await loadStatuses();
    onChanged?.();
    return true;
  };

  const handleIssue = async (target: TempPasswordTarget) => {
    setBusyId(target.id);
    try {
      await runIssue(
        target.must_change_password ? "issue" : "reset",
        [target.id]
      );
    } finally {
      setBusyId(null);
      setConfirmResetId(null);
    }
  };

  // Accounts still waiting on a first login that have nothing readable on file
  // — the exact set created before passwords were vaulted.
  const missing = targets.filter(
    (t) => t.must_change_password && !statuses[t.id]
  );

  const handleIssueAllMissing = async () => {
    setBulkBusy(true);
    try {
      await runIssue(
        "issue",
        missing.map((t) => t.id)
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const copyAllRevealed = () => {
    const lines = targets
      .filter((t) => revealed[t.id])
      .map((t) => `${t.full_name}\t${t.email}\t${revealed[t.id]}`);
    if (lines.length === 0) return;
    copy(
      ["Name\tEmail\tTemporary password", ...lines].join("\n"),
      `${lines.length} credential${lines.length === 1 ? "" : "s"}`
    );
  };

  const revealedCount = targets.filter((t) => revealed[t.id]).length;
  const single = targets.length === 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <KeyRound className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle>
                {single ? "Temporary password" : "Temporary passwords"}
              </DialogTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                {single
                  ? targets[0].full_name
                  : `${targets.length} account${targets.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 flex gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            Share these only with the person they belong to. The password stops
            being viewable here the moment they log in and set their own — after
            that the only option is a full reset.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {targets.map((target) => {
              const status = statuses[target.id];
              const plaintext = revealed[target.id];
              const busy = busyId === target.id;
              const pending = target.must_change_password;

              return (
                <div
                  key={target.id}
                  className="rounded-xl border border-gray-200 dark:border-border p-3"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-900 dark:text-white truncate">
                        {target.full_name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {target.email}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        pending
                          ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                          : "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                      }
                    >
                      {pending ? "Has not set a password" : "Password set by user"}
                    </Badge>
                  </div>

                  {plaintext && (
                    <div className="mt-3 flex items-center gap-2">
                      <code className="flex-1 rounded-lg bg-gray-100 dark:bg-muted px-3 py-2 font-mono text-sm tracking-wide break-all">
                        {plaintext}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(plaintext)}
                        aria-label={`Copy password for ${target.full_name}`}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {pending && status && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleReveal(target)}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : plaintext ? (
                          <EyeOff className="h-4 w-4 mr-1" />
                        ) : (
                          <Eye className="h-4 w-4 mr-1" />
                        )}
                        {plaintext ? "Hide" : "Click to reveal"}
                      </Button>
                    )}

                    {pending && !status && !plaintext && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => handleIssue(target)}
                        className="bg-navy-900 hover:bg-navy-800 text-white"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <KeyRound className="h-4 w-4 mr-1" />
                        )}
                        Issue a password
                      </Button>
                    )}

                    {pending && status && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleIssue(target)}
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
                        Issue a new one
                      </Button>
                    )}

                    {!pending &&
                      (confirmResetId === target.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => handleIssue(target)}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : null}
                            Yes, reset it
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmResetId(null)}
                          >
                            Cancel
                          </Button>
                          <span className="text-xs text-red-600">
                            Their current password stops working immediately.
                          </span>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmResetId(target.id)}
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Reset password
                        </Button>
                      ))}
                  </div>

                  {pending && status && (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Issued {formatDate(status.issued_at)}
                      {status.reveal_count > 0 &&
                        ` · viewed ${status.reveal_count} time${
                          status.reveal_count === 1 ? "" : "s"
                        }, last ${formatDate(status.last_revealed_at)}`}
                    </p>
                  )}

                  {pending && !status && (
                    <p className="mt-2 text-[11px] text-gray-500">
                      No password on file — this account was created before
                      passwords were stored, so a new one has to be issued.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2 flex-wrap">
            {missing.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={handleIssueAllMissing}
              >
                {bulkBusy ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-1" />
                )}
                Issue for {missing.length} without a password
              </Button>
            )}
            {revealedCount > 1 && (
              <Button variant="outline" size="sm" onClick={copyAllRevealed}>
                <Copy className="h-4 w-4 mr-1" />
                Copy all {revealedCount}
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
