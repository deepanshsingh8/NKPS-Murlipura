import type { CalendarEventType } from "@nkps/shared/types";

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  exam: "Exam",
  holiday: "Holiday",
  event: "Event",
  pta_meeting: "PTA Meeting",
  sports: "Sports",
  cultural: "Cultural",
  other: "Other",
};

export const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  exam: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  holiday: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  event: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  pta_meeting: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800",
  sports: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800",
  cultural: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/30 dark:text-pink-400 dark:border-pink-800",
  other: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-muted dark:text-gray-300 dark:border-border",
};
