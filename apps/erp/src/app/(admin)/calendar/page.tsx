"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nkps/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Card, CardContent } from "@nkps/shared/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, CalendarDays } from "lucide-react";
import { adminApi } from "@nkps/shared/lib/admin-api";
import { formatClassName } from "@nkps/shared/lib/utils";
import { EVENT_TYPE_LABELS, EVENT_TYPE_COLORS } from "@nkps/shared/lib/constants/calendar";
import type { CalendarEvent, CalendarEventType } from "@nkps/shared/types";

const EVENT_TYPES: CalendarEventType[] = [
  "exam",
  "holiday",
  "event",
  "pta_meeting",
  "other",
];

interface ClassOption {
  id: string;
  name: string;
  section: string;
  streams?: { name: string } | null;
}

export default function AdminCalendarPage() {
  const supabase = createClient();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<CalendarEventType | "all">(
    "all"
  );
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editData, setEditData] = useState({
    title: "",
    description: "",
    event_type: "event" as CalendarEventType,
    start_date: "",
    end_date: "",
    class_id: "",
  });
  const [newEvent, setNewEvent] = useState({
    title: "",
    description: "",
    event_type: "event" as CalendarEventType,
    start_date: "",
    end_date: "",
    class_id: "",
  });

  const fetchEvents = useCallback(async () => {
    let query = supabase
      .from("calendar_events")
      .select("*")
      .order("start_date", { ascending: true });

    if (activeFilter !== "all") {
      query = query.eq("event_type", activeFilter);
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to fetch events");
      return;
    }
    setEvents((data as CalendarEvent[]) ?? []);
    setLoading(false);
  }, [supabase, activeFilter]);

  const fetchClasses = useCallback(async () => {
    const { data } = await supabase
      .from("classes")
      .select("id, name, section, streams:stream_id(name)")
      .order("name", { ascending: true });
    setClasses((data ?? []) as unknown as ClassOption[]);
  }, [supabase]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleAddEvent = async () => {
    if (!newEvent.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!newEvent.start_date) {
      toast.error("Start date is required");
      return;
    }

    setSubmitting(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      toast.error("Not authenticated");
      setSubmitting(false);
      return;
    }

    const result = await adminApi({
      action: "insert",
      table: "calendar_events",
      data: {
        title: newEvent.title,
        description: newEvent.description || null,
        event_type: newEvent.event_type,
        start_date: newEvent.start_date,
        end_date: newEvent.end_date || null,
        class_id: newEvent.class_id || null,
        created_by: session.user.id,
      },
    });

    if (!result.success) {
      toast.error(`Failed to add event: ${result.error}`);
    } else {
      toast.success("Event added");
      setAddEventOpen(false);
      setNewEvent({
        title: "",
        description: "",
        event_type: "event",
        start_date: "",
        end_date: "",
        class_id: "",
      });
      fetchEvents();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this event? This cannot be undone.")) return;

    const result = await adminApi({
      action: "delete",
      table: "calendar_events",
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error(`Failed to delete: ${result.error}`);
      return;
    }
    toast.success("Event deleted");
    fetchEvents();
  };

  const openEdit = (evt: CalendarEvent) => {
    setEditingEvent(evt);
    setEditData({
      title: evt.title,
      description: evt.description ?? "",
      event_type: evt.event_type,
      start_date: evt.start_date,
      end_date: evt.end_date ?? "",
      class_id: evt.class_id ?? "",
    });
    setEditEventOpen(true);
  };

  const handleEditEvent = async () => {
    if (!editingEvent) return;
    if (!editData.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!editData.start_date) {
      toast.error("Start date is required");
      return;
    }

    setSubmitting(true);

    const result = await adminApi({
      action: "update",
      table: "calendar_events",
      data: {
        title: editData.title,
        description: editData.description || null,
        event_type: editData.event_type,
        start_date: editData.start_date,
        end_date: editData.end_date || null,
        class_id: editData.class_id || null,
      },
      match: { column: "id", value: editingEvent.id },
    });

    if (!result.success) {
      toast.error(`Failed to update event: ${result.error}`);
    } else {
      toast.success("Event updated");
      setEditEventOpen(false);
      setEditingEvent(null);
      fetchEvents();
    }
    setSubmitting(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Calendar Management
        </h1>
        <Button
          className="bg-navy-900 hover:bg-navy-800 text-white"
          onClick={() => setAddEventOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Event
        </Button>
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setActiveFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeFilter === "all"
              ? "bg-navy-900 text-white"
              : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-muted"
          }`}
        >
          All
        </button>
        {EVENT_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setActiveFilter(type)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeFilter === type
                ? "bg-navy-900 text-white"
                : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-muted"
            }`}
          >
            {EVENT_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <Card className="bg-white dark:bg-card rounded-2xl shadow-sm">
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-navy-900" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No events found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="font-medium">
                      {evt.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          EVENT_TYPE_COLORS[evt.event_type] ??
                          EVENT_TYPE_COLORS.other
                        }
                      >
                        {EVENT_TYPE_LABELS[evt.event_type] ?? evt.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(evt.start_date)}</TableCell>
                    <TableCell>
                      {evt.end_date ? formatDate(evt.end_date) : "--"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-gray-500 dark:text-gray-400">
                      {evt.description || "--"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(evt)}
                          className="text-blue-500 hover:text-blue-700 p-1"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(evt.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Event Dialog */}
      <Dialog open={addEventOpen} onOpenChange={setAddEventOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
                <CalendarDays className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <DialogTitle>Add Calendar Event</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Schedule an event on the school calendar</p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Title</Label>
              <Input
                className="h-9"
                placeholder="Event title"
                value={newEvent.title}
                onChange={(e) =>
                  setNewEvent({ ...newEvent, title: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Description (optional)</Label>
              <Input
                className="h-9"
                placeholder="Brief description"
                value={newEvent.description}
                onChange={(e) =>
                  setNewEvent({ ...newEvent, description: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Event Type</Label>
                <select
                  value={newEvent.event_type}
                  onChange={(e) =>
                    setNewEvent({
                      ...newEvent,
                      event_type: e.target.value as CalendarEventType,
                    })
                  }
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EVENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Class (optional)</Label>
                <select
                  value={newEvent.class_id}
                  onChange={(e) =>
                    setNewEvent({ ...newEvent, class_id: e.target.value })
                  }
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                >
                  <option value="">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatClassName(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Start Date</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={newEvent.start_date}
                  onChange={(e) =>
                    setNewEvent({ ...newEvent, start_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">End Date (optional)</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={newEvent.end_date}
                  onChange={(e) =>
                    setNewEvent({ ...newEvent, end_date: e.target.value })
                  }
                />
              </div>
            </div>
            <Button
              onClick={handleAddEvent}
              disabled={submitting}
              className="w-full h-10 rounded-xl font-medium bg-navy-900 hover:bg-navy-800 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Add Event"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Event Dialog */}
      <Dialog open={editEventOpen} onOpenChange={setEditEventOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle>Edit Calendar Event</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Update event details</p>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Title</Label>
              <Input
                className="h-9"
                placeholder="Event title"
                value={editData.title}
                onChange={(e) =>
                  setEditData({ ...editData, title: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Description (optional)</Label>
              <Input
                className="h-9"
                placeholder="Brief description"
                value={editData.description}
                onChange={(e) =>
                  setEditData({ ...editData, description: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Event Type</Label>
                <select
                  value={editData.event_type}
                  onChange={(e) =>
                    setEditData({
                      ...editData,
                      event_type: e.target.value as CalendarEventType,
                    })
                  }
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EVENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Class (optional)</Label>
                <select
                  value={editData.class_id}
                  onChange={(e) =>
                    setEditData({ ...editData, class_id: e.target.value })
                  }
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                >
                  <option value="">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatClassName(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Start Date</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={editData.start_date}
                  onChange={(e) =>
                    setEditData({ ...editData, start_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">End Date (optional)</Label>
                <Input
                  className="h-9"
                  type="date"
                  value={editData.end_date}
                  onChange={(e) =>
                    setEditData({ ...editData, end_date: e.target.value })
                  }
                />
              </div>
            </div>
            <Button
              onClick={handleEditEvent}
              disabled={submitting}
              className="w-full h-10 rounded-xl font-medium bg-navy-900 hover:bg-navy-800 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Update Event"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
