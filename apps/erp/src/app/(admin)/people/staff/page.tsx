"use client";

import dynamic from "next/dynamic";
import { useMountOnceOpen } from "@nkps/shared/lib/hooks/use-mount-once-open";

import { useEffect, useState, useCallback, useMemo } from "react";
import Image from "next/image";
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
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import {
  SortFilterHead,
  TableFilterSummary,
  useTableControls,
  type TableColumns,
} from "@nkps/shared/components/ui/data-table";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Search,
  UserCog,
  Users,
  Upload,
  ChevronDown,
  UserPlus,
  UserCheck,
  GraduationCap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkps/shared/components/ui/dropdown-menu";
import { adminFetch, adminPatch, adminDelete } from "@nkps/shared/lib/admin-api";
import {
  staffCreateSchema,
  staffUpdateSchema,
} from "@nkps/shared/lib/validations";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { ImageCropper } from "@nkps/shared/components/ImageCropper";
import {
  PHOTO_SPEC,
  PHOTO_SPEC_HELPER_TEXT,
  validatePhotoFile,
} from "@nkps/shared/lib/photo-spec";
// Loaded when it is first opened, not when the page is. Bulk upload is a
// once-a-session job on a screen people open every day, and the component
// is 772 lines of it.
const StaffBulkUpload = dynamic(() =>
  import("@/components/StaffBulkUpload").then((m) => m.StaffBulkUpload)
);
import { CreatePortalUsersDialog } from "@/components/CreatePortalUsersDialog";
import { StaffAvatar } from "@/components/StaffAvatar";
import { StaffDetailDialog } from "@/components/StaffDetailDialog";
import { useIsAdmin } from "@nkps/shared/hooks/useIsAdmin";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@nkps/shared/components/ui/tabs";
import {
  staffPortalRole,
  isTeachingStaffCategory,
  staffCategoryGroup,
  type StaffGroup,
} from "@nkps/shared/lib/staff-roles";
import type { StaffMember, StaffCategory } from "@nkps/shared/types";

// One tab per staff family. The grouping itself lives in staff-roles.ts next to
// the login rules, so a category can never sit on one tab here and be treated
// as another kind of staff elsewhere.
/** A staff member's linked `teachers` row, and whether it is still active. */
interface TeacherLink {
  id: string;
  is_active: boolean;
  date_of_leaving: string | null;
}

/** A `teachers` row with no staff member behind it. */
interface OrphanTeacher {
  id: string;
  full_name: string;
  employee_id: string | null;
  is_active: boolean;
}

const STAFF_TABS: { key: StaffGroup; label: string }[] = [
  { key: "teaching", label: "Teachers" },
  { key: "office", label: "Management & Office" },
  { key: "support", label: "Drivers & Helpers" },
];

const CATEGORY_OPTIONS: { value: StaffCategory; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "admin", label: "Administration" },
  { value: "pgt", label: "PGT" },
  { value: "tgt", label: "TGT" },
  { value: "prt", label: "PRT" },
  { value: "motherTeachers", label: "Mother Teachers" },
  { value: "prePrimaryCoordinator", label: "Pre-primary Coordinator" },
  { value: "primaryCoordinator", label: "Primary Coordinator" },
  { value: "middleCoordinator", label: "Middle Coordinator" },
  { value: "seniorCoordinator", label: "Senior Coordinator" },
  { value: "additionalStaff", label: "Additional Staff" },
  { value: "busDriver", label: "Bus Drivers" },
  { value: "peon", label: "Peons" },
];

// Maps a payload key to the label the admin actually sees on the form, so a
// rejected save can say "Phone: enter a valid 10-digit Indian mobile number"
// instead of the bare "Invalid data" the API returns.
const FIELD_LABELS: Record<string, string> = {
  name: "Full Name",
  subject: "Subject / Designation",
  category: "Category",
  email: "Email",
  phone: "Phone",
  date_of_birth: "Date of Birth",
  address: "Address",
  qualifications: "Qualifications",
  license_number: "Driving License Number",
  photo_url: "Profile Photo",
  sort_order: "Sort order",
};

type StaffFieldErrors = Partial<Record<string, string>>;

// Applied to an input whose value was rejected, so the field the toast names is
// also obvious at a glance in a long scrolling dialog.
const ERROR_INPUT = "border-red-500 focus-visible:ring-red-500";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 dark:text-red-400">{message}</p>;
}

// Zod's flatten() gives every message per field; the form has room for one, so
// keep the first and drop fields whose array came back empty.
function firstErrorPerField(
  fieldErrors: Record<string, string[] | undefined>
): StaffFieldErrors {
  const out: StaffFieldErrors = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) out[key] = messages[0];
  }
  return out;
}

// One-line summary for the toast: "Phone, Date of Birth" — the inline messages
// carry the detail, this just points at which fields to look at.
function summarizeErrors(errors: StaffFieldErrors): string {
  const labels = Object.keys(errors).map((k) => FIELD_LABELS[k] ?? k);
  if (labels.length === 0) return "Please check the form and try again";
  return `Please fix: ${labels.join(", ")}`;
}

// Filter dropdown = the active tab's categories plus an "all" sentinel; derived
// from CATEGORY_OPTIONS so the two lists can never drift out of sync.
function categoriesForGroup(
  group: StaffGroup
): { value: StaffCategory | "all"; label: string }[] {
  return [
    { value: "all", label: "All Categories" },
    ...CATEGORY_OPTIONS.filter((c) => staffCategoryGroup(c.value) === group),
  ];
}

// Staff categories used to carry thirteen hand-picked hues — purple, red,
// blue, emerald, amber, violet, pink, sky, lime, indigo, teal, orange, gray —
// and five of those families existed in the whole repo for this map alone.
// None of them carried information: the badge always renders its own label
// beside the colour, so nobody was reading "pink" to mean "Pre-Primary
// Coordinator", they were reading the words. And nobody holds thirteen
// colour-to-category mappings anyway.
//
// It was also the worst dark-mode bug in the app: not one of the thirteen had
// a `dark:` pair, so every badge rendered as a near-white chip on the dark
// table. The Badge's own `secondary` variant is theme-aware, which is the
// whole reason it exists.
//
// If these ever want colour again, the axis worth colouring is the group —
// teaching / coordination / office / support — not the thirteen leaves.

export default function AdminStaffPage() {
  // Creating portal login accounts is admin-only (enforced server-side in
  // /api/portal/bulk-create). Editors granted `staff` can manage staff records
  // but not provision logins, so hide the "Create Users" action from them.
  const isAdmin = useIsAdmin();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which staff family is showing. Kept in the URL (?group=) so the tab is
  // linkable — the transport Drivers page points straight at the drivers tab.
  const [groupParam, setGroupParam] = useUrlState("group");
  const activeGroup: StaffGroup = STAFF_TABS.some((t) => t.key === groupParam)
    ? (groupParam as StaffGroup)
    : "teaching";
  const groupCategories = useMemo(
    () => categoriesForGroup(activeGroup),
    [activeGroup]
  );
  // First real category of the active tab — what "Add Staff" pre-selects, so
  // adding from the drivers tab doesn't default to PGT.
  const defaultCategory = (groupCategories[1]?.value ?? "pgt") as StaffCategory;
  const [filterCategory, setFilterCategory] = useState<StaffCategory | "all">("all");
  const [search, setSearch] = useState("");
  // Row whose read-only detail view is open (opened from the name).
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const showStaffBulkUpload = useMountOnceOpen(bulkUploadOpen);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  // Every teaching staff member's `teachers` row, keyed by staff_member_id.
  // This used to be a Set of ids answering only "already linked?", which was
  // all the Convert action needed. The Teacher record column needs to know
  // whether that row is active or retired as well.
  const [teacherByStaffId, setTeacherByStaffId] = useState<
    Map<string, TeacherLink>
  >(new Map());
  // `teachers` rows pointing at no staff member at all. These are the ghosts:
  // invisible on this page before, still active, still offered in every
  // timetable and assignment picker. They have no staff row to hang off, so
  // they get their own banner rather than a table row.
  const [orphanTeachers, setOrphanTeachers] = useState<OrphanTeacher[]>([]);
  const [orphanDialogOpen, setOrphanDialogOpen] = useState(false);
  // The list was hard-filtered to active staff, with no way to see the rest —
  // so a deactivated staff member could not be found, let alone reactivated,
  // and the Active column below could only ever print "Yes". Folding the
  // teacher lifecycle in here made that matter: bringing back a retired
  // teacher means finding their row first.
  const [showInactive, setShowInactive] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  // Lowercased emails of staff members who already have a portal login, so the
  // per-row "Create login" action can hide for anyone already provisioned.
  const [staffLoginEmails, setStaffLoginEmails] = useState<Set<string>>(
    new Set()
  );
  const [creatingLoginId, setCreatingLoginId] = useState<string | null>(null);

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // A category filter or selection from one tab means nothing on another, so
  // both reset with the tab.
  const switchGroup = (group: string) => {
    setGroupParam(group);
    setFilterCategory("all");
    setSelectedIds(new Set());
  };

  // Form state
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<StaffCategory>("pgt");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);
  // Per-field validation messages, keyed by payload field name. Populated
  // either by the client-side schema check in handleSubmit or from the API's
  // `details.fieldErrors` when the server rejects the save.
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});

  // Crop state
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);

  const supabase = createClient();

  const fetchStaff = useCallback(async () => {
    const [staffRes, teacherLinkRes] = await Promise.all([
      (showInactive
        ? supabase.from("staff_members").select("*")
        : supabase.from("staff_members").select("*").eq("is_active", true)
      )
        .order("category")
        .order("sort_order")
        .order("name"),
      // Every teacher row, linked or not. The linked ones drive the Teacher
      // record column; the unlinked ones are the ghosts the banner warns about.
      supabase
        .from("teachers")
        .select("id, full_name, employee_id, is_active, date_of_leaving, staff_member_id"),
    ]);

    if (staffRes.error) {
      console.error("Failed to fetch staff:", staffRes.error);
      toast.error("Failed to load staff members");
    } else {
      const rows = (staffRes.data as StaffMember[]) || [];
      setStaff(rows);
      // Which staff already have a portal login? Both teacher- and staff-role
      // logins carry the staff member's email, so an email match against
      // profiles tells us who's already provisioned. (Auth normalizes emails
      // to lowercase, so we compare lowercased.)
      const emails = Array.from(
        new Set(
          rows
            .map((r) => r.email?.trim().toLowerCase())
            .filter((e): e is string => !!e)
        )
      );
      if (emails.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("email")
          .in("email", emails);
        setStaffLoginEmails(
          new Set(
            (profs ?? [])
              .map((p) => (p.email as string | null)?.toLowerCase())
              .filter((e): e is string => !!e)
          )
        );
      } else {
        setStaffLoginEmails(new Set());
      }
    }
    if (!teacherLinkRes.error) {
      const byStaff = new Map<string, TeacherLink>();
      const orphans: OrphanTeacher[] = [];
      for (const row of teacherLinkRes.data ?? []) {
        const sid = row.staff_member_id as string | null;
        if (sid) {
          byStaff.set(sid, {
            id: row.id as string,
            is_active: row.is_active !== false,
            date_of_leaving: (row.date_of_leaving as string | null) ?? null,
          });
        } else if (row.is_active !== false) {
          // Only ACTIVE orphans are worth flagging. A retired one with no staff
          // row is simply someone who left and was tidied up properly.
          orphans.push({
            id: row.id as string,
            full_name: (row.full_name as string) ?? "—",
            employee_id: (row.employee_id as string | null) ?? null,
            is_active: true,
          });
        }
      }
      orphans.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setTeacherByStaffId(byStaff);
      setOrphanTeachers(orphans);
    }
    setLoading(false);
  }, [supabase, showInactive]);

  // Retire or bring back a teacher record. This is the lifecycle the standalone
  // People → Teachers page used to own; it lives here now so one person is one
  // row on one screen. The route is unchanged, so the rules it enforces —
  // retire, never delete, because deleting someone who has ever been
  // timetabled fails outright and would erase who taught what — still apply.
  const setTeacherActive = async (
    link: TeacherLink,
    name: string,
    active: boolean
  ) => {
    if (
      !active &&
      !confirm(
        `Retire ${name}'s teacher record? They stop appearing in every timetable and subject-assignment dropdown. Their history is kept, and you can bring them back here.`
      )
    ) {
      return;
    }
    setConvertingId(link.id);
    try {
      const res = await adminFetch("/api/teachers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          active
            ? { id: link.id, is_active: true }
            : {
                id: link.id,
                is_active: false,
                date_of_leaving: new Date().toISOString().slice(0, 10),
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not update the teacher record");
        return;
      }
      toast.success(
        active ? `${name} is a teacher again` : `${name}'s teacher record retired`
      );
      await fetchStaff();
    } finally {
      setConvertingId(null);
    }
  };

  // H16-B — promote a staff_members row to also be a teachers row. The
  // helper is idempotent, so a stale UI click on an already-linked row
  // resolves to "already linked" rather than failing.
  const handleConvertToTeacher = useCallback(
    async (member: StaffMember) => {
      if (
        !confirm(
          `Convert "${member.name}" to a teacher? This creates a teachers record (linked to this staff entry) so they can be assigned classes/subjects, mark attendance, etc.`
        )
      ) {
        return;
      }
      setConvertingId(member.id);
      try {
        const res = await adminFetch(
          `/api/staff/${member.id}/convert-to-teacher`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to convert to teacher");
          return;
        }
        if (data.created === false) {
          toast.message("Already linked to a teacher record");
        } else {
          toast.success("Teacher record created and linked");
        }
        await fetchStaff();
      } catch {
        toast.error("Network error");
      } finally {
        setConvertingId(null);
      }
    },
    [fetchStaff]
  );

  // Provision a single portal login for a staff member. Routes through the same
  // category-aware bulk-create endpoint (with one item) so the role logic
  // (teaching → teacher, office → staff) lives in exactly one place.
  const handleCreateLogin = useCallback(
    async (member: StaffMember) => {
      if (!member.email?.trim()) return;
      const role = staffPortalRole(member.category);
      const roleLabel = role === "teacher" ? "teacher" : "staff";
      if (
        !confirm(
          `Create a ${roleLabel} login for "${member.name}"? A welcome email with temporary credentials will be sent to ${member.email}.`
        )
      ) {
        return;
      }
      setCreatingLoginId(member.id);
      try {
        const res = await adminFetch("/api/portal/bulk-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "staff",
            items: [
              {
                id: member.id,
                email: member.email.trim(),
                fullName: member.name.trim(),
                phone: member.phone || null,
              },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to create login");
          return;
        }
        if (data.created > 0) {
          toast.success("Login created — welcome email sent");
        } else {
          const reason = data.results?.[0]?.error ?? "Could not create login";
          toast.error(reason);
        }
        await fetchStaff();
      } catch {
        toast.error("Network error");
      } finally {
        setCreatingLoginId(null);
      }
    },
    [fetchStaff]
  );

  // Does this staff member already have a portal login? (email present + a
  // matching profiles row).
  const hasLogin = useCallback(
    (member: StaffMember) =>
      !!member.email?.trim() &&
      staffLoginEmails.has(member.email.trim().toLowerCase()),
    [staffLoginEmails]
  );

  useEffect(() => {
    fetchStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setName("");
    setSubject("");
    setCategory(defaultCategory);
    setEmail("");
    setPhone("");
    setDateOfBirth("");
    setAddress("");
    setQualifications("");
    setLicenseNumber("");
    setPhotoFile(null);
    setExistingPhotoUrl(null);
    if (croppedPreviewUrl) URL.revokeObjectURL(croppedPreviewUrl);
    setCroppedPreviewUrl(null);
    setEditingId(null);
    setRawImageSrc(null);
    setShowCropper(false);
    setFieldErrors({});
  };

  // Clearing as soon as the admin edits the offending field keeps a stale
  // message from sitting under an input they've already corrected.
  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleFileSelected = (files: FileList | File | null) => {
    const file = files instanceof FileList ? files[0] : files;
    if (!file) {
      setPhotoFile(null);
      setRawImageSrc(null);
      setShowCropper(false);
      return;
    }
    const result = validatePhotoFile(file);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    // Create object URL and show cropper at 4:5 portrait
    const url = URL.createObjectURL(file);
    setRawImageSrc(url);
    setShowCropper(true);
  };

  const handleCropComplete = (croppedFile: File) => {
    setPhotoFile(croppedFile);
    // Create a stable preview URL for the cropped image
    if (croppedPreviewUrl) URL.revokeObjectURL(croppedPreviewUrl);
    setCroppedPreviewUrl(URL.createObjectURL(croppedFile));
    setShowCropper(false);
    // Clean up the raw image object URL
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc(null);
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (member: StaffMember) => {
    setEditingId(member.id);
    setName(member.name);
    setSubject(member.subject);
    setCategory(member.category);
    setEmail(member.email || "");
    setPhone(member.phone || "");
    setDateOfBirth(member.date_of_birth || "");
    setAddress(member.address || "");
    setQualifications(member.qualifications || "");
    setLicenseNumber(member.license_number || "");
    setPhotoFile(null);
    setExistingPhotoUrl(member.photo_url);
    setFieldErrors({});
    setDialogOpen(true);
  };

  // The API answers a schema rejection with `{ error: "Invalid data", details:
  // <flattened zod error> }`. The details used to be dropped on the floor, so
  // the admin saw only "Invalid data". Pin them to the inputs instead and hand
  // back a readable summary for the toast; returns null when the body carries
  // no field detail (e.g. a 409 duplicate) so the caller falls back to
  // `data.error`.
  const applyServerFieldErrors = (body: unknown): string | null => {
    const details = (body as { details?: { fieldErrors?: Record<string, string[]> } })
      ?.details;
    if (!details?.fieldErrors) return null;
    const errors = firstErrorPerField(details.fieldErrors);
    if (Object.keys(errors).length === 0) return null;
    setFieldErrors(errors);
    return summarizeErrors(errors);
  };

  const handleSubmit = async () => {
    const extraFields = {
      email: email.trim() || null,
      phone: phone.trim() || null,
      date_of_birth: dateOfBirth || null,
      address: address.trim() || null,
      qualifications: qualifications.trim() || null,
      // License applies only to bus drivers; clear it for any other category
      // so a stale value can't linger if the category is changed.
      license_number:
        category === "busDriver" ? licenseNumber.trim() || null : null,
    };

    // An open cropper means the chosen photo hasn't been turned into a File
    // yet, so saving now would quietly store the record with no photo and
    // still report success. Make the admin finish (or cancel) the crop first.
    if (showCropper) {
      toast.error('Finish the photo crop first — click "Confirm Crop", or cancel it.');
      return;
    }

    // Validate with the very schema the API will apply, before uploading
    // anything. Two reasons this runs first:
    //  - The admin gets the failure pinned to the offending input instead of a
    //    bare "Invalid data" toast with no clue which field is wrong.
    //  - A rejected save no longer leaves an orphaned photo in storage, which
    //    is what used to happen on every retry.
    const draft = {
      name: name.trim(),
      subject: subject.trim(),
      category,
      photo_url: existingPhotoUrl,
      ...extraFields,
    };
    // sort_order is optional on the schema and computed below, so it is left
    // out of the draft rather than guessed here.
    const check = editingId
      ? staffUpdateSchema.safeParse({ ...draft, id: editingId })
      : staffCreateSchema.safeParse(draft);
    if (!check.success) {
      const errors = firstErrorPerField(check.error.flatten().fieldErrors);
      setFieldErrors(errors);
      toast.error(summarizeErrors(errors));
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      let photoUrl = existingPhotoUrl;

      // Upload new photo if selected
      if (photoFile) {
        const ext = photoFile.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        photoUrl = await uploadToStorage("staff-photos", fileName, photoFile);
      }

      if (editingId) {
        // Update existing
        const res = await adminPatch("/api/staff", {
          id: editingId,
          name: name.trim(),
          subject: subject.trim(),
          category,
          photo_url: photoUrl,
          old_photo_url: photoFile && existingPhotoUrl ? existingPhotoUrl : undefined,
          ...extraFields,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(
            applyServerFieldErrors(data) ||
              data.error ||
              "Failed to update staff member"
          );
        }
        toast.success("Staff member updated");
      } else {
        // Create new
        const currentCount = staff.filter((s) => s.category === category).length;
        const res = await adminFetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            subject: subject.trim(),
            category,
            photo_url: photoUrl,
            sort_order: currentCount,
            ...extraFields,
          }),
        });

        const resData = await res.json();
        if (!res.ok) {
          throw new Error(
            applyServerFieldErrors(resData) ||
              resData.error ||
              "Failed to add staff member"
          );
        }
        if (resData.userCreated) {
          toast.success("Staff member added — portal account created & login email sent");
        } else {
          toast.success("Staff member added");
        }
        // Follow the new person to their tab, so a driver added from the
        // Teachers tab doesn't vanish the moment the dialog closes.
        const group = staffCategoryGroup(category);
        if (group !== activeGroup) switchGroup(group);
      }

      setDialogOpen(false);
      resetForm();
      fetchStaff();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (member: StaffMember) => {
    if (!confirm(`Remove "${member.name}" from staff? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await adminDelete("/api/staff", {
        id: member.id,
        photo_url: member.photo_url,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }

      toast.success("Staff member removed");
      fetchStaff();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // Everyone on the active tab, before the category/search filters below.
  const groupStaff = useMemo(
    () => staff.filter((m) => staffCategoryGroup(m.category) === activeGroup),
    [staff, activeGroup]
  );
  const tabCounts = useMemo(() => {
    const counts: Record<StaffGroup, number> = { teaching: 0, office: 0, support: 0 };
    for (const m of staff) counts[staffCategoryGroup(m.category)]++;
    return counts;
  }, [staff]);

  // Filter and search
  const filtered = groupStaff.filter((member) => {
    const matchesCategory = filterCategory === "all" || member.category === filterCategory;
    const matchesSearch = member.name.toLowerCase().includes(search.toLowerCase()) ||
      member.subject.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Header sort/filter accessors — mirror what the matching cell renders.
  const columns = useMemo<TableColumns<StaffMember>>(
    () => ({
      name: { label: "Name", value: (m) => m.name, filter: "text" },
      subject: {
        label: "Subject / Designation",
        value: (m) => m.subject || null,
        filter: "text",
      },
      category: {
        label: "Category",
        value: (m) => getCategoryLabel(m.category),
      },
      // Already in the payload — the table just never showed them, which made
      // a three-column list of the entire staff harder to use than it needed
      // to be, and left a contact sheet impossible to produce.
      email: {
        label: "Email",
        value: (m) => m.email || null,
        filter: "text",
      },
      phone: {
        label: "Phone",
        value: (m) => m.phone || null,
        filter: "text",
      },
      is_active: {
        label: "Active",
        value: (m) => m.is_active,
      },
      // Whether this person can be given classes, subjects and timetable
      // periods. Distinct from the Active column above, which is about their
      // employment: `staff_members` is the HR record, `teachers` is the row
      // every assignment dropdown reads, and they can disagree. That gap is
      // exactly what let three departed teachers keep appearing in pickers.
      teacher_record: {
        label: "Teacher record",
        value: (m) => {
          const link = teacherByStaffId.get(m.id);
          if (!link) return staffPortalRole(m.category) === "teacher" ? "Not created" : null;
          return link.is_active ? "Active" : "Retired";
        },
        filter: "select",
      },
      date_of_birth: {
        label: "Date of Birth",
        value: (m) =>
          m.date_of_birth
            ? new Date(m.date_of_birth).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : null,
        sortValue: (m) => m.date_of_birth,
        exportFormat: "date",
        // Offered in exports (a birthday list is a real request) without
        // adding a ninth column to an already-wide table.
        exportOnly: true,
      },
      qualifications: {
        label: "Qualifications",
        value: (m) => m.qualifications || null,
        filter: "text",
        exportOnly: true,
      },
      address: {
        label: "Address",
        value: (m) => m.address || null,
        filter: "text",
        exportOnly: true,
      },
    }),
    // teacher_record reads this map; with [] the column would render against
    // the empty one captured on the first pass.
    [teacherByStaffId]
  );

  const table = useTableControls({ rows: filtered, columns });
  const visible = table.rows;

  // Selection helpers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === visible.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((m) => m.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} staff member${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`
      )
    )
      return;

    setBulkDeleting(true);
    try {
      const res = await adminDelete("/api/staff", {
        ids: Array.from(selectedIds),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }

      toast.success(`Deleted ${selectedIds.size} staff member${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      fetchStaff();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
    }
  };

  const getCategoryLabel = (cat: StaffCategory) =>
    CATEGORY_OPTIONS.find((c) => c.value === cat)?.label || cat;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="erp-page-bar">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserCog className="h-6 w-6" />
            Staff Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Add, edit, and manage school staff members and their profile photos
          </p>
        </div>
        <div className="erp-page-actions">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="gap-2" />}
            >
              Actions
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setBulkUploadOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={openAddDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Staff
          </Button>
        </div>
      </div>

      {/* Group tabs */}
      <Tabs
        value={activeGroup}
        onValueChange={(v: unknown) => v && switchGroup(String(v))}
      >
        <TabsList variant="line">
          {STAFF_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {tabCounts[t.key]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Teacher records with nobody behind them. These are the ghosts: a staff
          member was deleted, the ON DELETE SET NULL cut the link, and the
          teacher row carried on — active, invisible on this page, and still
          offered in every timetable and assignment dropdown. Three departed
          teachers were reported by name before anyone worked out why. They have
          no staff row to sit on, so they get a banner. */}
      {activeGroup === "teaching" && orphanTeachers.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
          <GraduationCap className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="text-xs text-amber-900 dark:text-amber-300">
            <p>
              <span className="font-medium">
                {orphanTeachers.length} teacher{" "}
                {orphanTeachers.length === 1 ? "record has" : "records have"} no
                staff profile.
              </span>{" "}
              They are still offered in every timetable and subject-assignment
              dropdown. This usually means the staff member was deleted rather
              than marked inactive.
            </p>
            <button
              type="button"
              onClick={() => setOrphanDialogOpen(true)}
              className="mt-1 font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-200"
            >
              Review {orphanTeachers.length === 1 ? "it" : "them"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or subject..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedIds(new Set()); }}
            className="pl-9"
          />
        </div>
        <Select
          value={filterCategory}
          onValueChange={(val) => { if (val) { setFilterCategory(val as StaffCategory | "all"); setSelectedIds(new Set()); } }}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupCategories.map((c) => (
              <SelectItem key={c.value} value={c.value} label={c.label}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(v: boolean) => {
              setShowInactive(v === true);
              setSelectedIds(new Set());
            }}
          />
          Show inactive
        </label>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-gray-500">
        <span>{filtered.length} of {groupStaff.length} on this tab</span>
        {filterCategory !== "all" && (
          <button
            onClick={() => setFilterCategory("all")}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200">
          <span className="text-sm font-medium text-red-700 dark:text-red-400">
            {selectedIds.size} selected
          </span>
          {isAdmin && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPortalDialogOpen(true)}
                className="gap-1"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create Users
              </Button>
              <div className="w-px h-6 bg-red-200 dark:bg-red-900/30" />
            </>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={bulkDeleting}
            onClick={handleBulkDelete}
          >
            {bulkDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Users className="h-10 w-10 mb-3" />
          <p className="text-sm font-medium">
            {groupStaff.length === 0 ? "Nobody on this tab yet" : "No results found"}
          </p>
          <p className="text-xs mt-1">
            {groupStaff.length === 0
              ? "Click 'Add Staff' to get started"
              : "Try adjusting your search or filter"}
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <TableFilterSummary
              ctl={table}
              total={filtered.length}
              shown={visible.length}
              className="mb-0 mr-auto"
            />
            <TableExportButton
              ctl={table}
              filename="staff"
              title="Staff"
              featureKey="staff"
            />
          </div>
          <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={visible.length > 0 && selectedIds.size === visible.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-16">Photo</TableHead>
                <SortFilterHead ctl={table} col="name" />
                <SortFilterHead ctl={table} col="subject" />
                <SortFilterHead ctl={table} col="category" />
                <SortFilterHead ctl={table} col="email" />
                <SortFilterHead ctl={table} col="phone" />
                <SortFilterHead ctl={table} col="is_active" />
                {activeGroup === "teaching" && (
                  <SortFilterHead ctl={table} col="teacher_record" />
                )}
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeGroup === "teaching" ? 10 : 9} className="py-10 text-center text-gray-500 dark:text-gray-400">
                    No staff match the column filters.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((member) => (
                <TableRow key={member.id} className={selectedIds.has(member.id) ? "bg-red-50/50" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(member.id)}
                      onCheckedChange={() => toggleSelection(member.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <StaffAvatar name={member.name} photoUrl={member.photo_url} />
                  </TableCell>
                  <TableCell>
                    {/* The name opens the full read-only profile; Edit stays
                        on the actions side so viewing never risks a change. */}
                    <button
                      type="button"
                      onClick={() => setDetailMember(member)}
                      className="text-left font-medium text-navy-900 hover:text-blue-600 hover:underline underline-offset-2 dark:text-gray-100 dark:hover:text-blue-400"
                    >
                      {member.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-gray-500">{member.subject}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {getCategoryLabel(member.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {member.email || "—"}
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {member.phone || "—"}
                  </TableCell>
                  <TableCell>
                    {member.is_active ? (
                      "Yes"
                    ) : (
                      <span className="text-gray-400">No</span>
                    )}
                  </TableCell>
                  {/* Can this person be given classes and timetable periods?
                      Separate from Active above, which is about employment. */}
                  {activeGroup === "teaching" && (
                    <TableCell>
                      {(() => {
                        const link = teacherByStaffId.get(member.id);
                        if (!link) {
                          return (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              Not created
                            </span>
                          );
                        }
                        return link.is_active ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                              Active
                            </Badge>
                            <button
                              type="button"
                              onClick={() =>
                                setTeacherActive(link, member.name, false)
                              }
                              disabled={convertingId === link.id}
                              className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-red-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-red-400"
                            >
                              Retire
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="text-gray-500 dark:text-gray-400"
                            >
                              Retired
                              {link.date_of_leaving
                                ? ` ${link.date_of_leaving}`
                                : ""}
                            </Badge>
                            <button
                              type="button"
                              onClick={() =>
                                setTeacherActive(link, member.name, true)
                              }
                              disabled={convertingId === link.id}
                              className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-navy-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
                            >
                              Bring back
                            </button>
                          </span>
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Portal login (admins only, and only for categories
                          that get a login — bus drivers/peons don't):
                          - green check when a login already exists;
                          - "Create login" action when there's an email;
                          - a muted "No email" hint when there isn't, so the
                            missing action is explained rather than just absent. */}
                      {hasLogin(member) ? (
                        <span
                          title="Has a portal login"
                          className="inline-flex h-9 w-9 items-center justify-center text-green-600 dark:text-green-400"
                        >
                          <UserCheck className="h-4 w-4" />
                        </span>
                      ) : isAdmin && staffPortalRole(member.category) !== null ? (
                        member.email?.trim() ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCreateLogin(member)}
                            disabled={creatingLoginId === member.id}
                            aria-label="Create login"
                            title={`Create ${
                              staffPortalRole(member.category) === "teacher"
                                ? "teacher"
                                : "staff"
                            } login (sends a welcome email)`}
                            className="text-green-600 dark:text-green-400 hover:text-green-700 hover:bg-green-50"
                          >
                            {creatingLoginId === member.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserPlus className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span
                            title="Add an email (Edit) to create a login"
                            className="whitespace-nowrap px-1 text-[11px] italic text-gray-400"
                          >
                            No email
                          </span>
                        )
                      ) : null}
                      {/* Convert-to-teacher: only for teaching categories that
                          aren't already linked to a teachers row. */}
                      {isTeachingStaffCategory(member.category) &&
                        !teacherByStaffId.has(member.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleConvertToTeacher(member)}
                          disabled={convertingId === member.id}
                          aria-label="Convert to teacher"
                          title="Convert to teacher (creates a linked teachers record)"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50"
                        >
                          {convertingId === member.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <GraduationCap className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(member)}
                        aria-label="Edit staff member"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(member)}
                        aria-label="Delete staff member"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Staff Member" : "Add Staff Member"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[70dvh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                placeholder="e.g. Jasvindar Singh Bhatiya"
                value={name}
                className={fieldErrors.name ? ERROR_INPUT : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError("name");
                }}
              />
              <FieldError message={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label>Subject / Designation *</Label>
              <Input
                placeholder="e.g. Biology, Principal, Mother Teacher"
                value={subject}
                className={fieldErrors.subject ? ERROR_INPUT : undefined}
                onChange={(e) => {
                  setSubject(e.target.value);
                  clearFieldError("subject");
                }}
              />
              <FieldError message={fieldErrors.subject} />
            </div>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={category}
                onValueChange={(val) => val && setCategory(val as StaffCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value} label={c.label}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={email}
                  className={fieldErrors.email ? ERROR_INPUT : undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError("email");
                  }}
                />
                <FieldError message={fieldErrors.email} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  inputMode="tel"
                  placeholder="e.g. +91-9876543210"
                  value={phone}
                  className={fieldErrors.phone ? ERROR_INPUT : undefined}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearFieldError("phone");
                  }}
                />
                <FieldError message={fieldErrors.phone} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={dateOfBirth}
                  className={fieldErrors.date_of_birth ? ERROR_INPUT : undefined}
                  onChange={(e) => {
                    setDateOfBirth(e.target.value);
                    clearFieldError("date_of_birth");
                  }}
                />
                <FieldError message={fieldErrors.date_of_birth} />
              </div>
              <div className="space-y-2">
                <Label>Qualifications</Label>
                <Input
                  placeholder="e.g. M.Sc., B.Ed."
                  value={qualifications}
                  className={fieldErrors.qualifications ? ERROR_INPUT : undefined}
                  onChange={(e) => {
                    setQualifications(e.target.value);
                    clearFieldError("qualifications");
                  }}
                />
                <FieldError message={fieldErrors.qualifications} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                placeholder="Home address"
                value={address}
                className={fieldErrors.address ? ERROR_INPUT : undefined}
                onChange={(e) => {
                  setAddress(e.target.value);
                  clearFieldError("address");
                }}
              />
              <FieldError message={fieldErrors.address} />
            </div>

            {category === "busDriver" && (
              <div className="space-y-2">
                <Label>Driving License Number</Label>
                <Input
                  placeholder="e.g. UP32 20230001234"
                  value={licenseNumber}
                  className={fieldErrors.license_number ? ERROR_INPUT : undefined}
                  onChange={(e) => {
                    setLicenseNumber(e.target.value);
                    clearFieldError("license_number");
                  }}
                />
                <FieldError message={fieldErrors.license_number} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Profile Photo</Label>

              {/* Show cropper when a raw image is selected */}
              {showCropper && rawImageSrc ? (
                <ImageCropper
                  imageSrc={rawImageSrc}
                  onCropComplete={handleCropComplete}
                  onCancel={handleCropCancel}
                  fileName={`staff-${Date.now()}.jpg`}
                  cropShape="rect"
                  aspect={PHOTO_SPEC.aspectRatio}
                />
              ) : (
                <>
                  {/* Show cropped preview or existing photo at 4:5 portrait */}
                  {photoFile && croppedPreviewUrl ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-16 aspect-[4/5] overflow-hidden relative border-2 border-green-400 rounded-md bg-gray-50 dark:bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={croppedPreviewUrl}
                          alt="Cropped preview"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-green-600 dark:text-green-400 font-medium">Photo cropped & ready</p>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoFile(null);
                            if (croppedPreviewUrl) URL.revokeObjectURL(croppedPreviewUrl);
                            setCroppedPreviewUrl(null);
                            setRawImageSrc(null);
                          }}
                          className="text-xs text-gray-500 hover:text-red-500 mt-0.5"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : editingId && existingPhotoUrl ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-14 aspect-[4/5] overflow-hidden relative rounded-md bg-gray-50 dark:bg-muted">
                        <Image
                          src={existingPhotoUrl}
                          alt="Current photo"
                          fill
                          className="object-contain"
                          sizes="56px"
                        />
                      </div>
                      <span className="text-xs text-gray-500">Current photo. Upload a new one to replace.</span>
                    </div>
                  ) : null}

                  <p className="text-xs text-gray-500 mb-1">{PHOTO_SPEC_HELPER_TEXT}</p>
                  <FileDropZone
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    maxSizeMB={PHOTO_SPEC.maxSizeMB}
                    acceptedMimeTypes={PHOTO_SPEC.acceptedFormats}
                    acceptedExtensions={PHOTO_SPEC.acceptedExtensions}
                    onChange={handleFileSelected}
                    onReject={(reason) => toast.error(reason)}
                    value={null}
                    label="Drop photo here or click to browse"
                    hint={PHOTO_SPEC_HELPER_TEXT}
                    icon="image"
                  />
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || showCropper}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only detail view, opened from the name */}
      <StaffDetailDialog
        member={detailMember}
        onClose={() => setDetailMember(null)}
        onEdit={(m) => {
          setDetailMember(null);
          openEditDialog(m);
        }}
        hasLogin={detailMember ? hasLogin(detailMember) : false}
        teacherLinked={detailMember ? teacherByStaffId.has(detailMember.id) : false}
        categoryLabel={detailMember ? getCategoryLabel(detailMember.category) : ""}
      />

      {/* Bulk Upload Dialog */}
      {showStaffBulkUpload && (
      <StaffBulkUpload
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onSuccess={fetchStaff}
      />
      )}

      {/* Create Portal Users Dialog */}
      <CreatePortalUsersDialog
        open={portalDialogOpen}
        onOpenChange={setPortalDialogOpen}
        type="staff"
        items={filtered
          .filter(
            (m) =>
              selectedIds.has(m.id) &&
              // Skip anyone who already has a login or whose category doesn't
              // get one (bus drivers, peons) — no point offering them.
              !hasLogin(m) &&
              staffPortalRole(m.category) !== null
          )
          .map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone }))}
        onComplete={fetchStaff}
      />

      {/* The ghosts, listed. Retiring is the only exit offered: deleting a
          teacher who has ever been timetabled fails outright, and if it
          succeeded it would erase the record of who taught what. */}
      <Dialog open={orphanDialogOpen} onOpenChange={setOrphanDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Teacher records with no staff profile</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Each of these can still be picked in the timetable and in subject
            assignments. Retire anyone who has left — their history stays, and
            they disappear from every dropdown. If someone here still works at
            the school, add them back under Staff instead and the records will
            re-link.
          </p>
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {orphanTeachers.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-border"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-navy-900 dark:text-white">
                    {t.full_name}
                  </div>
                  {t.employee_id && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t.employee_id}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={convertingId === t.id}
                  onClick={() =>
                    setTeacherActive(
                      { id: t.id, is_active: true, date_of_leaving: null },
                      t.full_name,
                      false
                    )
                  }
                >
                  {convertingId === t.id && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  Retire
                </Button>
              </div>
            ))}
            {orphanTeachers.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                All clear — every teacher record has a staff profile.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrphanDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
