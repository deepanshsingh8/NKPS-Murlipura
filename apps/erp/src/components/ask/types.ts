/** Shared shapes for the Ask chat. */

export interface AskRun {
  runId: string;
  purpose: string;
  total: number;
  /** Its handle has lapsed — the chip is a label now, not a result. */
  expired?: boolean;
}

export interface TableState {
  runId: string;
  headers: string[];
  rows: (string | number | null)[][];
  total: number;
}

/**
 * One message.
 *
 * Runs, table and errors hang off the MESSAGE, not the page. They used to be
 * page-level singletons, so the answer you were reading and the table under it
 * were related only by both being the most recent thing, and asking a second
 * question wiped the first answer's table out from under it.
 */
export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;

  runs?: AskRun[];
  activeRunId?: string | null;
  table?: TableState | null;
  tableBusy?: boolean;
  rerunning?: boolean;

  /** The turn failed outright. Shown in place, with a way to try again. */
  error?: string | null;
  /** The user hit Stop. Not a failure — nothing went wrong. */
  stopped?: boolean;
  /** The words were removed by a delete, rather than never written. */
  redacted?: boolean;

  // ── Live only ────────────────────────────────────────────────────────────
  streaming?: boolean;
  /** What the model said before going off to look something up. */
  steps?: string[];
  /** The lookup in flight, for the progress line. */
  activeTool?: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  started_at: string;
  last_at: string;
  status: string;
}
