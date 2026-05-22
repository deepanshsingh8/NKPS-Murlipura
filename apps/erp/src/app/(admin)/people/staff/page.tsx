"use client";

import { useEffect, useState, useCallback } from "react";
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
  Download,
  ChevronDown,
  UserPlus,
  GraduationCap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkps/shared/components/ui/dropdown-menu";
import { adminFetch, adminPatch, adminDelete } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { ImageCropper } from "@nkps/shared/components/ImageCropper";
import {
  PHOTO_SPEC,
  PHOTO_SPEC_HELPER_TEXT,
  validatePhotoFile,
} from "@nkps/shared/lib/photo-spec";
import { StaffBulkUpload } from "@/components/StaffBulkUpload";
import { CreatePortalUsersDialog } from "@/components/CreatePortalUsersDialog";
import type { StaffMember, StaffCategory } from "@nkps/shared/types";
import { downloadCSV, STAFF_CSV_COLUMNS } from "@/lib/csv-export";

const CATEGORIES: { value: StaffCategory | "all"; label: string }[] = [
  { value: "all", label: "All Categories" },
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

const categoryBadgeColors: Record<StaffCategory, string> = {
  management: "bg-purple-100 text-purple-700",
  admin: "bg-red-100 text-red-700",
  pgt: "bg-blue-100 text-blue-700",
  tgt: "bg-emerald-100 text-emerald-700",
  prt: "bg-amber-100 text-amber-700",
  motherTeachers: "bg-violet-100 text-violet-700",
  prePrimaryCoordinator: "bg-pink-100 text-pink-700",
  primaryCoordinator: "bg-sky-100 text-sky-700",
  middleCoordinator: "bg-lime-100 text-lime-700",
  seniorCoordinator: "bg-indigo-100 text-indigo-700",
  additionalStaff: "bg-teal-100 text-teal-700",
  busDriver: "bg-orange-100 text-orange-700",
  peon: "bg-gray-100 text-gray-700",
};

const AVATAR_COLORS = [
  "from-navy-800 to-navy-900",
  "from-blue-500 to-blue-700",
  "from-gold-500 to-gold-600",
  "from-emerald-500 to-emerald-700",
  "from-violet-500 to-violet-700",
  "from-rose-500 to-rose-700",
  "from-cyan-500 to-cyan-700",
  "from-amber-500 to-amber-700",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<StaffCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  // H16-B — track which staff_members are already linked to a teachers row
  // so the "Convert to teacher" action can hide for already-linked rows.
  const [teacherLinkedIds, setTeacherLinkedIds] = useState<Set<string>>(
    new Set()
  );
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<StaffCategory>("pgt");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);

  // Crop state
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);

  const supabase = createClient();

  const fetchStaff = useCallback(async () => {
    const [staffRes, teacherLinkRes] = await Promise.all([
      supabase
        .from("staff_members")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order")
        .order("name"),
      // H16-B — every teacher row links back to a staff_members row via
      // staff_member_id; this set tells us which staff already have a
      // linked teacher so we can hide the "Convert to teacher" action.
      supabase
        .from("teachers")
        .select("staff_member_id")
        .not("staff_member_id", "is", null),
    ]);

    if (staffRes.error) {
      console.error("Failed to fetch staff:", staffRes.error);
      toast.error("Failed to load staff members");
    } else {
      setStaff((staffRes.data as StaffMember[]) || []);
    }
    if (!teacherLinkRes.error) {
      const ids = new Set<string>();
      for (const row of teacherLinkRes.data ?? []) {
        const sid = row.staff_member_id as string | null;
        if (sid) ids.add(sid);
      }
      setTeacherLinkedIds(ids);
    }
    setLoading(false);
  }, [supabase]);

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

  useEffect(() => {
    fetchStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setName("");
    setSubject("");
    setCategory("pgt");
    setEmail("");
    setPhone("");
    setDateOfBirth("");
    setAddress("");
    setQualifications("");
    setPhotoFile(null);
    setExistingPhotoUrl(null);
    if (croppedPreviewUrl) URL.revokeObjectURL(croppedPreviewUrl);
    setCroppedPreviewUrl(null);
    setEditingId(null);
    setRawImageSrc(null);
    setShowCropper(false);
  };

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
    setPhotoFile(null);
    setExistingPhotoUrl(member.photo_url);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !subject.trim()) {
      toast.error("Name and subject/designation are required");
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl = existingPhotoUrl;

      // Upload new photo if selected
      if (photoFile) {
        const ext = photoFile.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        photoUrl = await uploadToStorage("staff-photos", fileName, photoFile);
      }

      const extraFields = {
        email: email.trim() || null,
        phone: phone.trim() || null,
        date_of_birth: dateOfBirth || null,
        address: address.trim() || null,
        qualifications: qualifications.trim() || null,
      };

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
          throw new Error(data.error || "Failed to update staff member");
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
          throw new Error(resData.error || "Failed to add staff member");
        }
        if (resData.userCreated) {
          toast.success("Staff member added — portal account created & login email sent");
        } else {
          toast.success("Staff member added");
        }
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

  // Filter and search
  const filtered = staff.filter((member) => {
    const matchesCategory = filterCategory === "all" || member.category === filterCategory;
    const matchesSearch = member.name.toLowerCase().includes(search.toLowerCase()) ||
      member.subject.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

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
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((m) => m.id)));
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="h-6 w-6" />
            Staff Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Add, edit, and manage school staff members and their profile photos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="gap-2" />}
            >
              Actions
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                disabled={filtered.length === 0}
                onClick={() => {
                  downloadCSV(filtered, STAFF_CSV_COLUMNS, `staff-${new Date().toISOString().split("T")[0]}`);
                  toast.success(`Downloaded ${filtered.length} staff members`);
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </DropdownMenuItem>
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
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value} label={c.label}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-gray-500">
        <span>{filtered.length} of {staff.length} staff members</span>
        {filterCategory !== "all" && (
          <button
            onClick={() => setFilterCategory("all")}
            className="text-blue-600 hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
          <span className="text-sm font-medium text-red-700">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPortalDialogOpen(true)}
            className="gap-1"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Create Users
          </Button>
          <div className="w-px h-6 bg-red-200" />
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
            {staff.length === 0 ? "No staff members yet" : "No results found"}
          </p>
          <p className="text-xs mt-1">
            {staff.length === 0
              ? "Click 'Add Staff' to get started"
              : "Try adjusting your search or filter"}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-16">Photo</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Subject / Designation</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => (
                <TableRow key={member.id} className={selectedIds.has(member.id) ? "bg-red-50/50" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(member.id)}
                      onCheckedChange={() => toggleSelection(member.id)}
                    />
                  </TableCell>
                  <TableCell>
                    {member.photo_url ? (
                      <div className="w-10 aspect-[4/5] rounded-md overflow-hidden relative bg-gray-50">
                        <Image
                          src={member.photo_url}
                          alt={member.name}
                          fill
                          className="object-contain"
                          sizes="40px"
                        />
                      </div>
                    ) : (
                      <div
                        className={`w-10 aspect-[4/5] rounded-md bg-gradient-to-br flex items-center justify-center ${getAvatarColor(member.name)}`}
                      >
                        <span className="text-xs font-bold text-white">
                          {getInitials(member.name)}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-gray-500">{member.subject}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={categoryBadgeColors[member.category]}
                    >
                      {getCategoryLabel(member.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* H16-B — convert-to-teacher action. Hidden when the
                          staff_member already has a linked teachers row. */}
                      {!teacherLinkedIds.has(member.id) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleConvertToTeacher(member)}
                          disabled={convertingId === member.id}
                          aria-label="Convert to teacher"
                          title="Convert to teacher (creates a linked teachers record)"
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
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
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Staff Member" : "Add Staff Member"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                placeholder="e.g. Jasvindar Singh Bhatiya"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Subject / Designation *</Label>
              <Input
                placeholder="e.g. Biology, Principal, Mother Teacher"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  placeholder="e.g. +91-9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Qualifications</Label>
                <Input
                  placeholder="e.g. M.Sc., B.Ed."
                  value={qualifications}
                  onChange={(e) => setQualifications(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                placeholder="Home address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

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
                      <div className="w-16 aspect-[4/5] overflow-hidden relative border-2 border-green-400 rounded-md bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={croppedPreviewUrl}
                          alt="Cropped preview"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-green-600 font-medium">Photo cropped & ready</p>
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
                      <div className="w-14 aspect-[4/5] overflow-hidden relative rounded-md bg-gray-50">
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
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <StaffBulkUpload
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onSuccess={fetchStaff}
      />

      {/* Create Portal Users Dialog */}
      <CreatePortalUsersDialog
        open={portalDialogOpen}
        onOpenChange={setPortalDialogOpen}
        type="staff"
        items={filtered
          .filter((m) => selectedIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone }))}
        onComplete={fetchStaff}
      />
    </div>
  );
}
