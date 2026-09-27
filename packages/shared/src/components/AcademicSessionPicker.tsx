"use client";

import { CalendarRange } from "lucide-react";

import { cn } from "@nkps/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import type { AcademicSessionState } from "@nkps/shared/lib/hooks/use-academic-session";

export interface AcademicSessionPickerProps {
  state: AcademicSessionState;
  className?: string;
}

/**
 * Session selector for the year-scoped list pages.
 *
 * Viewing another session is a deliberately visible state: the trigger is
 * tinted amber when the selection is not the running session, because
 * everything on the page — counts, class labels, dues — then describes a
 * different year, and an admin who forgets that will misread the screen.
 */
export function AcademicSessionPicker({
  state,
  className,
}: AcademicSessionPickerProps) {
  const { sessions, sessionId, setSessionId, isCurrentSession, loading } =
    state;

  // Tinted whenever the selection is not the running session — past or
  // future — because in both cases the page describes a year other than
  // the one the reader is living in.
  const offCurrent = !!sessionId && !isCurrentSession;

  // Nothing to choose between until the school has run more than one session.
  if (loading || sessions.length <= 1) return null;

  const label = (s: { name: string; is_current: boolean }) =>
    s.is_current ? `${s.name} (current)` : s.name;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <CalendarRange
        className={cn(
          "h-4 w-4 shrink-0",
          offCurrent
            ? "text-amber-600 dark:text-amber-400"
            : "text-gray-400 dark:text-gray-500"
        )}
      />
      <Select
        value={sessionId ?? ""}
        items={sessions.map((s) => ({ value: s.id, label: label(s) }))}
        onValueChange={(value) => setSessionId((value as string) || "")}
      >
        <SelectTrigger
          aria-label="Academic session"
          className={cn(
            "h-9 w-[11rem]",
            offCurrent &&
              "border-amber-400 text-amber-800 dark:border-amber-500/60 dark:text-amber-300"
          )}
        >
          <SelectValue placeholder="Session" />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((s) => (
            <SelectItem key={s.id} value={s.id} label={label(s)}>
              {label(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
