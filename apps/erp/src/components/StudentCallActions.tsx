"use client";

import { useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ContactType = "father" | "mother" | "guardian" | "student";

interface CallableStudent {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  father_name?: string | null;
  father_mobile?: string | null;
  mother_name?: string | null;
  mother_mobile?: string | null;
  guardian_name?: string | null;
  guardian_mobile?: string | null;
}

interface Contact {
  type: ContactType;
  label: string;
  number: string;
}

// Build the callable contacts from whatever numbers exist on the student.
// We show the person's name/relation as the label — never the raw number.
function contactsFor(s: CallableStudent): Contact[] {
  const raw: { type: ContactType; label: string; number: string | null | undefined }[] = [
    { type: "father", label: s.father_name?.trim() || "Father", number: s.father_mobile },
    { type: "mother", label: s.mother_name?.trim() || "Mother", number: s.mother_mobile },
    { type: "guardian", label: s.guardian_name?.trim() || "Guardian", number: s.guardian_mobile },
    { type: "student", label: s.full_name?.trim() || "Student", number: s.phone },
  ];
  return raw
    .filter((c): c is Contact => Boolean(c.number && String(c.number).trim()))
    .map((c) => ({ type: c.type, label: c.label, number: c.number }));
}

export function StudentCallActions({ student }: { student: CallableStudent }) {
  const contacts = contactsFor(student);
  const [calling, setCalling] = useState<ContactType | null>(null);
  // When the caller has no calling number on file, we surface an inline form
  // (not a nested dialog — base-ui nested dialogs are fiddly) and retry the
  // pending contact once saved.
  const [needsNumber, setNeedsNumber] = useState(false);
  const [pending, setPending] = useState<Contact | null>(null);
  const [numberInput, setNumberInput] = useState("");
  const [savingNumber, setSavingNumber] = useState(false);

  async function placeCall(contact: Contact) {
    setCalling(contact.type);
    try {
      const res = await adminFetch("/api/telephony/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, contact: contact.type }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Ringing your phone — pick up to connect to ${contact.label}.`);
      } else if (json.code === "NO_CALLER_NUMBER") {
        setPending(contact);
        setNeedsNumber(true);
        toast.info("Set your calling number to place calls.");
      } else if (json.code === "NOT_CONFIGURED") {
        toast.error("Calling isn't set up yet. Ask an admin to configure Exotel.");
      } else {
        toast.error(json.error || "Could not place the call.");
      }
    } catch {
      toast.error("Could not place the call.");
    } finally {
      setCalling(null);
    }
  }

  async function saveNumber() {
    setSavingNumber(true);
    try {
      const res = await adminFetch("/api/telephony/my-number", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: numberInput }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Calling number saved.");
        setNeedsNumber(false);
        setNumberInput("");
        const retry = pending;
        setPending(null);
        if (retry) await placeCall(retry);
      } else {
        toast.error(json.error || "Failed to save number.");
      }
    } catch {
      toast.error("Failed to save number.");
    } finally {
      setSavingNumber(false);
    }
  }

  if (contacts.length === 0) {
    return (
      <p className="text-xs text-gray-400">No phone numbers on file to call.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {contacts.map((c) => (
          <Button
            key={c.type}
            variant="outline"
            size="sm"
            disabled={calling !== null}
            onClick={() => placeCall(c)}
          >
            {calling === c.type ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Phone className="h-4 w-4 mr-2" />
            )}
            Call {c.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        Your phone rings first — pick up and we connect you. The parent sees the
        school&apos;s number, never yours.
      </p>

      {needsNumber && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
          <Label className="text-xs">Your calling number (Exotel rings this)</Label>
          <div className="flex gap-2">
            <Input
              value={numberInput}
              onChange={(e) => setNumberInput(e.target.value)}
              placeholder="10-digit mobile"
              inputMode="numeric"
              className="h-9"
            />
            <Button
              size="sm"
              onClick={saveNumber}
              disabled={savingNumber || numberInput.trim().length < 10}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {savingNumber ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
