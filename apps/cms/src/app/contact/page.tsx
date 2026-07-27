"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  MailOpen,
  Phone,
  MessageCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { adminFetch, adminPatch } from "@nkps/shared/lib/admin-api";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@nkps/shared/components/ui/dropdown-menu";
import { cn } from "@nkps/shared/lib/utils";
import { toast } from "sonner";
import type { ContactSubmission } from "@nkps/shared/types";

type Filter = "all" | "unread" | "read";

// wa.me requires a country-coded number with no symbols. Normalize the two
// common stored forms to a bare 10-digit national number, then add +91:
//   "09876543210"  → strip the STD trunk 0  → "9876543210"
//   "9876543210"   → already bare
// A 12-digit "91XXXXXXXXXX" is already country-coded and passes through. Any
// other shape (too short/long) can't be salvaged, so it's returned as-is.
function toWhatsAppNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.length === 10 ? `91${digits}` : digits;
}

export default function AdminContactPage() {
  const [messages, setMessages] = useState<ContactSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchMessages = async () => {
    try {
      const res = await adminFetch("/api/contact");
      const data = await res.json();
      if (res.ok) {
        setMessages(data.data ?? []);
      }
    } catch {
      toast.error("Failed to fetch messages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  const toggleRead = async (msg: ContactSubmission) => {
    const newValue = !msg.is_read;
    try {
      const res = await adminPatch("/api/contact", {
        id: msg.id,
        is_read: newValue,
      });
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, is_read: newValue } : m))
        );
        toast.success(newValue ? "Marked as read" : "Marked as unread");
      } else {
        toast.error("Failed to update");
      }
    } catch {
      toast.error("Failed to update");
    }
  };

  const filtered = messages.filter((m) => {
    if (filter === "unread") return !m.is_read;
    if (filter === "read") return m.is_read;
    return true;
  });

  const unreadCount = messages.filter((m) => !m.is_read).length;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: `All (${messages.length})` },
    { key: "unread", label: `Unread (${unreadCount})` },
    { key: "read", label: `Read (${messages.length - unreadCount})` },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Contact Messages
        </h1>
        {unreadCount > 0 && (
          <Badge
            variant="secondary"
            className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
          >
            {unreadCount} new
          </Badge>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              filter === key
                ? "bg-navy-900 text-white"
                : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-muted"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-card rounded-xl p-5 shadow-sm border border-gray-200 dark:border-border animate-pulse h-24"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm py-10 text-center">
          {filter === "all"
            ? "No contact messages yet."
            : `No ${filter} messages.`}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((msg) => {
            const isExpanded = expandedId === msg.id;
            return (
              <div
                key={msg.id}
                className={cn(
                  "bg-white dark:bg-card rounded-xl shadow-sm border transition-colors",
                  msg.is_read
                    ? "border-gray-200 dark:border-border"
                    : "border-blue-200 bg-blue-50/30 dark:bg-blue-950/30 dark:border-border"
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedId(isExpanded ? null : msg.id)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : msg.id);
                    }
                  }}
                  className="w-full cursor-pointer text-left p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-navy-900 dark:text-white">
                          {msg.full_name}
                        </p>
                        {!msg.is_read && (
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs"
                          >
                            New
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {msg.subject}
                      </p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {msg.email}
                        </span>
                        {msg.phone && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 rounded outline-none hover:text-blue-600 focus-visible:text-blue-600 dark:hover:text-blue-400"
                            >
                              <Phone className="h-3 w-3" />
                              {msg.phone}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenuItem
                                onClick={() => {
                                  window.location.href = `tel:${msg.phone}`;
                                }}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                Call {msg.phone}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  window.open(
                                    `https://wa.me/${toWhatsAppNumber(msg.phone)}`,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                                }}
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                Message on WhatsApp
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(msg.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 dark:border-border">
                    <p className="text-sm text-gray-700 dark:text-gray-200 mt-4 whitespace-pre-wrap leading-relaxed">
                      {msg.message}
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleRead(msg)}
                        className="text-xs"
                      >
                        {msg.is_read ? (
                          <>
                            <Mail className="h-3.5 w-3.5 mr-1.5" />
                            Mark as Unread
                          </>
                        ) : (
                          <>
                            <MailOpen className="h-3.5 w-3.5 mr-1.5" />
                            Mark as Read
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          window.location.href = `mailto:${msg.email}?subject=Re: ${msg.subject}`;
                        }}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1.5" />
                        Reply via Email
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
