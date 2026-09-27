"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@nkps/shared/lib/supabase/client";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";

/**
 * Which academic session a list page is showing.
 *
 * Most of the ERP's data is year-scoped — a class, a roll number, a fee
 * structure and a bus stop assignment all belong to one session — but the
 * list pages have had no way to say which one, so they implicitly show
 * "roughly now" and last year's cohort is unreachable. That is tolerable
 * while you are only looking; it stops being tolerable the moment the page
 * can produce a file, because a downloaded "Class XI list" that quietly
 * mixes sessions is simply wrong and nothing in the file says so.
 *
 * The selection lives in the URL so it survives back-navigation and can be
 * shared, matching how the other list filters behave.
 */
export interface AcademicSessionOption {
  id: string;
  name: string;
  start_date: string;
  is_current: boolean;
}

export interface AcademicSessionState {
  sessions: AcademicSessionOption[];
  /** Null only before the sessions have loaded. */
  sessionId: string | null;
  setSessionId: (id: string) => void;
  session: AcademicSessionOption | null;
  currentSessionId: string | null;
  /** The selection IS the running session. */
  isCurrentSession: boolean;
  /**
   * The selected session has already finished. Its records are history: the
   * UI shows them read-only and warns that they describe a year that ended.
   */
  isPastSession: boolean;
  /**
   * The selected session has not started yet — next year, being set up in
   * advance. Fully editable, and emphatically NOT read-only: preparing it is
   * the entire reason for selecting it.
   */
  isFutureSession: boolean;
  loading: boolean;
}

const URL_KEY = "session";

export function useAcademicSession(): AcademicSessionState {
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlValue, setUrlValue] = useUrlState(URL_KEY);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("academic_years")
      .select("id, name, start_date, is_current")
      // Newest first: the session an admin wants is almost always the most
      // recent one, and the picker should not make them scroll to it.
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setSessions((data as AcademicSessionOption[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentSessionId = useMemo(
    () => sessions.find((s) => s.is_current)?.id ?? sessions[0]?.id ?? null,
    [sessions]
  );

  // A stale or hand-edited ?session= must not leave the page showing nothing;
  // fall back to the current session rather than an empty list.
  const sessionId = useMemo(() => {
    if (urlValue && sessions.some((s) => s.id === urlValue)) return urlValue;
    return currentSessionId;
  }, [urlValue, sessions, currentSessionId]);

  const setSessionId = useCallback(
    (id: string) => {
      // Drop the param when it names the current session, so the default
      // view keeps a clean URL.
      setUrlValue(id === currentSessionId ? "" : id);
    },
    [setUrlValue, currentSessionId]
  );

  const session = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId]
  );

  // Past and future are NOT the same thing, and conflating them into
  // "not current" gets both wrong: a future session would be labelled as
  // ended and locked against the very edits it exists to receive.
  // Ordered by start_date, which is what the server compares too.
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId]
  );
  const isCurrentSession = !!sessionId && sessionId === currentSessionId;
  const isPastSession =
    !!session &&
    !!currentSession &&
    !isCurrentSession &&
    session.start_date < currentSession.start_date;
  const isFutureSession =
    !!session &&
    !!currentSession &&
    !isCurrentSession &&
    session.start_date > currentSession.start_date;

  return {
    sessions,
    sessionId,
    setSessionId,
    session,
    currentSessionId,
    isCurrentSession,
    isPastSession,
    isFutureSession,
    loading,
  };
}
