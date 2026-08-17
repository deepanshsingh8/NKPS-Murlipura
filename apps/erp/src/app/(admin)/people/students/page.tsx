"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@nkps/shared/lib/supabase/client";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
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
import { toast } from "sonner";
import {
  Plus,
  Upload,
  Trash2,
  Pencil,
  Loader2,
  Search,
  Users,
  GraduationCap,
  ArrowUpCircle,
  Download,
  ChevronDown,
  UserPlus,
  Receipt,
  User,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkps/shared/components/ui/dropdown-menu";
import { StudentBulkUpload } from "@/components/StudentBulkUpload";
import {
  StudentFormFields,
  type StudentFormState,
  buildStudentPayload,
  emptyStudentForm,
  studentToForm,
} from "@/components/StudentFormFields";
import {
  STUDENT_TEMPLATE_FIELDS,
  type StudentTemplateField,
  formatFieldValue,
  getTemplateField,
  indianNationalFromNationality,
} from "@nkps/shared/lib/student-template";
import { CreatePortalUsersDialog } from "@/components/CreatePortalUsersDialog";
import { StudentCallActions } from "@/components/StudentCallActions";
import { useIsAdmin } from "@nkps/shared/hooks/useIsAdmin";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { formatClassName } from "@nkps/shared/lib/utils";
import { downloadCSV, STUDENT_CSV_COLUMNS } from "@/lib/csv-export";
import type { Student, Stream, EnrollmentStatus } from "@nkps/shared/types";

interface ClassOption {
  id: string;
  name: string;
  section: string;
  stream_id: string | null;
  stream_name: string | null;
}

interface AcademicYear {
  id: string;
  name: string;
  is_current: boolean;
}

interface StudentRow extends Student {
  roll_number: number | null;
  roll_number_manual?: boolean;
  enrollment_id: string | null;
  class_id?: string | null;
  stream_id?: string | null;
  enrollment_status?: EnrollmentStatus | null;
  class_name?: string;
  class_section?: string;
  // Transport columns surfaced for the dashboard deep-link filter
  // (?has_transport). Stop-based model (migration 074).
  has_transport?: boolean | null;
  bus_stop_id?: string | null;
  transport_direction?: string | null;
}

const ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  "active", "passed", "failed", "terminated", "exited",
];

// Passed to the row's <Select> so the wrapper can skip its recursive
// collectSelectItems() walk over the children on every render.
const ENROLLMENT_STATUS_ITEMS = ENROLLMENT_STATUSES.map((st) => ({
  value: st,
  label: st.charAt(0).toUpperCase() + st.slice(1),
}));

const STATUS_BADGE_STYLES: Record<EnrollmentStatus, string> = {
  active: "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  passed: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  failed: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  terminated: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  exited: "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400",
};

function classLabel(c: ClassOption): string {
  return formatClassName(c);
}

function DetailField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | number | null;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </p>
      {children ?? (
        <p className="text-sm text-gray-800 dark:text-gray-100 break-words">
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

/** Registry-driven read-only view of one template section (General/Enrolment).
 *  Empty fields are skipped so short records don't render a wall of "—". */
function ProfileDetailSection({
  title,
  section,
  student,
  streams,
}: {
  title: string;
  section: "general" | "enrolment";
  student: StudentRow;
  streams: Stream[];
}) {
  const valueFor = (field: StudentTemplateField): string => {
    switch (field.key) {
      case "class_name":
        return student.class_name ?? "";
      case "section":
        return student.class_section ?? "";
      case "stream":
        return streams.find((s) => s.id === student.stream_id)?.name ?? "";
      case "subjects":
      case "roll_number":
        return ""; // subjects aren't in the list payload; roll no is shown above
      case "indian_national":
        return formatFieldValue(
          field,
          indianNationalFromNationality(student.nationality)
        );
      default:
        return formatFieldValue(
          field,
          (student as unknown as Record<string, unknown>)[field.key]
        );
    }
  };

  const rows = STUDENT_TEMPLATE_FIELDS
    .filter((f) => f.section === section)
    .sort((a, b) => a.particular - b.particular)
    .map((f) => ({ field: f, value: valueFor(f) }))
    .filter((r) => r.value !== "");

  return (
    <div>
      <p className="text-sm font-semibold text-navy-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-1 mb-3">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">No details recorded</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {rows.map(({ field, value }) => (
            <DetailField
              key={field.key}
              label={field.exportLabel ?? field.label}
              value={value}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One row of the students table, memoised.
//
// The Add/Edit dialog keeps its form state in this page component, so every
// keystroke re-renders the page — and the table sits mounted underneath the
// dialog. Each row carries a base-ui Select plus 4-5 icon buttons, so a class
// of 40 students meant ~1,600 elements rebuilt per character typed, which is
// what made text lag behind the keyboard on mobile.
//
// Memoising works only because every prop is a primitive or a stable
// reference: `actions` is built once (see `actions` in the page) and reads its
// handlers through a ref, so it never changes identity while still calling the
// latest logic. A keystroke in the dialog now re-renders zero rows.
interface StudentRowActions {
  onOpenDetail: (student: StudentRow) => void;
  onToggleSelect: (studentId: string) => void;
  onEdit: (student: StudentRow) => void;
  onFees: (studentId: string) => void;
  onInvite: (student: StudentRow) => void;
  onDelete: (student: StudentRow) => void;
  onStatusChange: (enrollmentId: string, status: EnrollmentStatus) => void;
}

const StudentTableRow = memo(function StudentTableRow({
  student,
  selected,
  showClassColumn,
  isAdmin,
  actions,
}: {
  student: StudentRow;
  selected: boolean;
  showClassColumn: boolean;
  isAdmin: boolean;
  actions: StudentRowActions;
}) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-muted/30"
      onClick={() => actions.onOpenDetail(student)}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => actions.onToggleSelect(student.id)}
        />
      </TableCell>
      <TableCell className="font-medium">{student.admission_no}</TableCell>
      <TableCell>{student.full_name}</TableCell>
      {showClassColumn && (
        <TableCell className="text-gray-600 dark:text-gray-300">
          {student.class_name ? (
            <span>
              {student.class_name}
              {student.class_section ? `-${student.class_section}` : ""}
            </span>
          ) : (
            <Badge
              variant="secondary"
              className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/50"
              onClick={(e) => {
                e.stopPropagation();
                actions.onEdit(student);
              }}
              title="Click to assign a class"
            >
              Unassigned
            </Badge>
          )}
        </TableCell>
      )}
      {!showClassColumn && (
        <TableCell className="text-gray-600 dark:text-gray-300">
          {student.roll_number ?? "—"}
        </TableCell>
      )}
      <TableCell className="text-gray-600 dark:text-gray-300">
        {student.father_name || "—"}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {student.enrollment_id ? (
          <Select
            value={student.enrollment_status || "active"}
            items={ENROLLMENT_STATUS_ITEMS}
            onValueChange={(val) => {
              if (val && student.enrollment_id) {
                actions.onStatusChange(student.enrollment_id, val as EnrollmentStatus);
              }
            }}
          >
            <SelectTrigger className="h-7 w-[110px] text-xs border-0 bg-transparent p-0 pr-6">
              <Badge
                variant="secondary"
                className={STATUS_BADGE_STYLES[student.enrollment_status || "active"]}
              >
                {(student.enrollment_status || "active").charAt(0).toUpperCase() +
                  (student.enrollment_status || "active").slice(1)}
              </Badge>
            </SelectTrigger>
            <SelectContent>
              {ENROLLMENT_STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge
            variant="secondary"
            className={
              student.enrollment_status
                ? STATUS_BADGE_STYLES[student.enrollment_status]
                : student.is_active
                  ? STATUS_BADGE_STYLES.active
                  : STATUS_BADGE_STYLES.exited
            }
          >
            {student.enrollment_status
              ? student.enrollment_status.charAt(0).toUpperCase() + student.enrollment_status.slice(1)
              : student.is_active ? "Active" : "Inactive"}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.onEdit(student)}
            aria-label="Edit student"
            className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
            title="Edit student"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.onFees(student.id)}
            aria-label="View fees / record payment"
            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            title="View fees / record payment"
          >
            <Receipt className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onInvite(student)}
              aria-label="Invite guardian"
              className="text-violet-500 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              title="Invite parent/guardian"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.onDelete(student)}
            aria-label="Delete student"
            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            title="Delete student"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

export default function AdminStudentsPage() {
  // These actions are admin-only (enforced server-side): creating portal login
  // accounts (/api/portal/bulk-create), inviting a guardian (/api/parents/invite)
  // and reverting alumni (/api/students/revert-alumni). Editors granted
  // `students` manage records but can't perform them, so hide the triggers.
  const isAdmin = useIsAdmin();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [search, setSearch] = useUrlState("q");
  // Transport filter set by the dashboard's Transport tile. Stacks
  // multiplicatively with the existing class + name search so admins can
  // narrow further from the deep-linked starting point.
  const [auditHasTransport, setAuditHasTransport] = useUrlState("has_transport");

  // Dialogs
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatusValue, setBulkStatusValue] = useState<string>("");
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Promote dialog state
  const [targetAcademicYearId, setTargetAcademicYearId] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{
    promoted: number;
    retained: number;
    graduated: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  } | null>(null);

  // H16-C — alumni manager dialog. Lists rows with is_alumni=true so admins
  // can revert mistakes (e.g., a student wrongly marked as graduated during
  // promotion). The revert action calls /api/erp/students/revert-alumni.
  interface AlumniRow {
    id: string;
    full_name: string;
    admission_no: string;
    father_name: string | null;
    alumni_passing_year: string | null;
  }
  const [alumniDialogOpen, setAlumniDialogOpen] = useState(false);
  const [alumniRows, setAlumniRows] = useState<AlumniRow[]>([]);
  const [alumniLoading, setAlumniLoading] = useState(false);
  const [alumniSearch, setAlumniSearch] = useState("");
  const [revertDialog, setRevertDialog] = useState<{
    open: boolean;
    target: AlumniRow | null;
  }>({ open: false, target: null });
  const [revertForm, setRevertForm] = useState({
    reason: "",
    reactivate_class_id: "",
    reactivate_academic_year_id: "",
  });
  const [reverting, setReverting] = useState(false);

  // Detail view dialog (read-only quick peek, separate from edit)
  const [detailStudent, setDetailStudent] = useState<StudentRow | null>(null);

  // Invite-guardian dialog (creates a parent portal account AND links it to
  // this student in one shot — the guaranteed-link path, /api/parents/invite)
  const [inviteStudent, setInviteStudent] = useState<StudentRow | null>(null);
  const [inviteForm, setInviteForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    relationship: "guardian" as "father" | "mother" | "guardian",
  });
  const [inviting, setInviting] = useState(false);

  // Form state — General/Enrolment profile fields live in formData.fields,
  // keyed by the shared template registry (see StudentFormFields).
  const [editingStudent, setEditingStudent] = useState<StudentRow | null>(null);
  const [formData, setFormData] = useState<StudentFormState>(emptyStudentForm());
  // Server-side validation errors keyed by field key, highlighted inline in
  // the form (set on a 400 from POST/PATCH, cleared on reset/next submit).
  const [formErrors, setFormErrors] = useState<Record<string, string[]>>({});

  const supabase = createClient();
  const router = useRouter();

  const fetchClasses = useCallback(async () => {
    // Streams and the academic-year list don't depend on the current year, so
    // they're kicked off immediately and awaited later — only the classes
    // query has to wait for the current-year lookup. Previously all four ran
    // back to back, costing four serial round trips on every page load.
    const streamsPromise = supabase
      .from("streams")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    const allYearsPromise = supabase
      .from("academic_years")
      .select("id, name, is_current")
      .order("name", { ascending: false });

    // Fetch classes for the current academic year
    const { data: years } = await supabase
      .from("academic_years")
      .select("id")
      .eq("is_current", true)
      .single();

    let query = supabase
      .from("classes")
      .select("id, name, section, stream_id, streams(name)")
      .order("sort_order", { ascending: true });

    if (years) {
      query = query.eq("academic_year_id", years.id);
    }

    const { data } = await query;
    const classOptions: ClassOption[] = (data ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      name: c.name as string,
      section: c.section as string,
      stream_id: c.stream_id as string | null,
      stream_name: (c.streams as { name: string } | null)?.name ?? null,
    }));
    setClasses(classOptions);

    // Streams (for higher-class enrolment) and the academic-year list (for
    // promotion) were requested above and are already in flight.
    const [{ data: streamsData }, { data: allYears }] = await Promise.all([
      streamsPromise,
      allYearsPromise,
    ]);
    setStreams((streamsData as Stream[]) ?? []);
    setAcademicYears((allYears as AcademicYear[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStudents = useCallback(async () => {
    setLoading(true);

    try {
      const url = selectedClassId
        ? `/api/students?class_id=${selectedClassId}`
        : `/api/students`;
      const res = await adminFetch(url);
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Failed to fetch students");
        setStudents([]);
        setLoading(false);
        return;
      }

      setStudents((json.data as StudentRow[]) ?? []);
    } catch {
      toast.error("Failed to fetch students");
      setStudents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  // Fetch all students on initial load, and re-fetch when class changes
  useEffect(() => {
    fetchStudents();
    setSelectedIds(new Set()); // Clear selection on class change
  }, [selectedClassId, fetchStudents]);

  // H16-C — fetch alumni when the dialog opens. Direct supabase query is
  // fine here: alumni rows are flagged via is_alumni and excluded from the
  // regular students endpoint (which filters out is_alumni rows).
  const fetchAlumni = useCallback(async () => {
    setAlumniLoading(true);
    try {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, admission_no, father_name, alumni_passing_year")
        .eq("is_alumni", true)
        .order("alumni_passing_year", { ascending: false, nullsFirst: false })
        .order("full_name", { ascending: true });
      if (error) {
        toast.error("Failed to load alumni");
        setAlumniRows([]);
      } else {
        setAlumniRows((data as AlumniRow[]) ?? []);
      }
    } finally {
      setAlumniLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (alumniDialogOpen) fetchAlumni();
  }, [alumniDialogOpen, fetchAlumni]);

  const handleConfirmRevert = useCallback(async () => {
    if (!revertDialog.target) return;
    const reason = revertForm.reason.trim();
    if (reason.length < 5) {
      toast.error("Reason is required (min 5 chars)");
      return;
    }
    setReverting(true);
    try {
      const res = await adminFetch("/api/students/revert-alumni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: revertDialog.target.id,
          reason,
          ...(revertForm.reactivate_class_id &&
          revertForm.reactivate_academic_year_id
            ? {
                reactivate_class_id: revertForm.reactivate_class_id,
                reactivate_academic_year_id:
                  revertForm.reactivate_academic_year_id,
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to revert alumni");
        return;
      }
      toast.success(
        data.reenrolled
          ? "Reverted and re-enrolled"
          : "Reverted to active student"
      );
      setRevertDialog({ open: false, target: null });
      setRevertForm({
        reason: "",
        reactivate_class_id: "",
        reactivate_academic_year_id: "",
      });
      await fetchAlumni();
      await fetchStudents();
    } catch {
      toast.error("Network error");
    } finally {
      setReverting(false);
    }
  }, [revertDialog, revertForm, fetchAlumni, fetchStudents]);

  const auditFilterActive = auditHasTransport === "1";

  const filteredStudents = students.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      const matches =
        s.full_name.toLowerCase().includes(q) ||
        s.admission_no.toLowerCase().includes(q) ||
        (s.father_name && s.father_name.toLowerCase().includes(q));
      if (!matches) return false;
    }
    if (auditHasTransport === "1" && !s.has_transport) return false;
    return true;
  });

  const clearAuditFilters = () => {
    setAuditHasTransport("");
  };

  // Header sort/filter accessors. Each mirrors what the matching cell renders
  // so the filter options read exactly like the column on screen — including
  // the "Unassigned" badge for students without a class.
  const columns = useMemo<TableColumns<StudentRow>>(
    () => ({
      admission_no: {
        label: "Adm No",
        value: (s) => s.admission_no,
        filter: "text",
      },
      full_name: { label: "Name", value: (s) => s.full_name, filter: "text" },
      class: {
        label: "Class",
        value: (s) =>
          s.class_name
            ? `${s.class_name}${s.class_section ? `-${s.class_section}` : ""}`
            : null,
        emptyLabel: "Unassigned",
      },
      roll_number: {
        label: "Roll No",
        value: (s) => s.roll_number,
        filter: "none",
      },
      father_name: {
        label: "Father's Name",
        value: (s) => s.father_name || null,
        filter: "text",
      },
      status: {
        label: "Status",
        value: (s) => {
          const status =
            s.enrollment_status ??
            (s.enrollment_id ? "active" : s.is_active ? "active" : "exited");
          return status.charAt(0).toUpperCase() + status.slice(1);
        },
      },
    }),
    []
  );

  const table = useTableControls({ rows: filteredStudents, columns });
  // Everything downstream of the header filters — selection, the count badge,
  // CSV export — works on what the user can actually see.
  const visibleStudents = table.rows;

  const resetForm = () => {
    setFormData(emptyStudentForm(selectedClassId));
    setFormErrors({});
    setEditingStudent(null);
  };

  // Open the Add dialog with the next admission number pre-filled (highest
  // numeric admission no + 1 — still editable, server rejects duplicates).
  const openAddDialog = async () => {
    resetForm();
    setAddDialogOpen(true);
    try {
      const res = await adminFetch("/api/students/next-admission-no");
      const data = await res.json();
      if (res.ok && data.next) {
        setFormData((prev) =>
          prev.fields.admission_no
            ? prev
            : { ...prev, fields: { ...prev.fields, admission_no: data.next } }
        );
      }
    } catch {
      // Suggestion only — the field stays manually fillable.
    }
  };

  // Turn a 400's zod fieldErrors into inline highlights + a readable toast
  // instead of a bare "Invalid data".
  const applyServerErrors = (
    data: { error?: string; details?: { fieldErrors?: Record<string, string[]> } },
    fallback: string
  ) => {
    const fieldErrors = data.details?.fieldErrors;
    if (fieldErrors && Object.keys(fieldErrors).length > 0) {
      setFormErrors(fieldErrors);
      const entries = Object.entries(fieldErrors);
      const shown = entries
        .slice(0, 3)
        .map(([k, v]) => `${getTemplateField(k)?.label ?? k}: ${v[0]}`)
        .join(" · ");
      toast.error(
        `Please fix: ${shown}${entries.length > 3 ? ` (+${entries.length - 3} more)` : ""}`
      );
    } else {
      toast.error(data.error || fallback);
    }
  };

  const openInviteDialog = (student: StudentRow) => {
    setInviteForm({
      full_name: student.father_name || student.mother_name || "",
      email: "",
      phone: student.phone ?? "",
      relationship: student.father_name ? "father" : "guardian",
    });
    setInviteStudent(student);
  };

  const handleInvite = async () => {
    if (!inviteStudent) return;
    if (!inviteForm.full_name.trim() || !inviteForm.email.trim()) {
      toast.error("Guardian name and email are required");
      return;
    }
    setInviting(true);
    try {
      const res = await adminFetch("/api/parents/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: inviteStudent.id,
          full_name: inviteForm.full_name.trim(),
          email: inviteForm.email.trim(),
          phone: inviteForm.phone.trim(),
          relationship: inviteForm.relationship,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to invite guardian");
        return;
      }
      if (json.link_warning) {
        toast.warning(json.link_warning);
      } else {
        toast.success(
          `Invited ${inviteForm.full_name.trim()} as ${inviteForm.relationship} of ${inviteStudent.full_name}. A welcome email with login details was sent.`
        );
      }
      setInviteStudent(null);
    } catch {
      toast.error("Failed to invite guardian");
    } finally {
      setInviting(false);
    }
  };

  const openEditDialog = (student: StudentRow) => {
    setEditingStudent(student);
    setFormData(studentToForm(student, selectedClassId));
    setEditDialogOpen(true);
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fields.admission_no || !formData.fields.full_name) {
      toast.error("Admission number and name are required");
      return;
    }
    if (!formData.class_id) {
      toast.error("Please select a class");
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminFetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: formData.class_id,
          roll_number: formData.roll_number || undefined,
          roll_number_manual: formData.roll_number_manual,
          stream_id: formData.stream_id || undefined,
          ...buildStudentPayload(formData),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        applyServerErrors(data, "Failed to add student");
        return;
      }

      setFormErrors({});
      if (data.warning) {
        toast.warning(data.warning);
      }

      toast.success("Student added successfully");
      // Switch to the class the student was added to
      if (formData.class_id !== selectedClassId) {
        setSelectedClassId(formData.class_id);
      }
      resetForm();
      setAddDialogOpen(false);
      await fetchStudents();
    } catch {
      toast.error("Failed to add student");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;

    setSubmitting(true);
    try {
      const res = await adminFetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingStudent.id,
          enrollment_id: editingStudent.enrollment_id,
          class_id: formData.class_id || undefined,
          stream_id: formData.stream_id,
          roll_number: formData.roll_number || undefined,
          roll_number_manual: formData.roll_number_manual,
          ...buildStudentPayload(formData),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        applyServerErrors(data, "Failed to update student");
        return;
      }

      setFormErrors({});
      toast.success("Student updated successfully");
      resetForm();
      setEditDialogOpen(false);
      await fetchStudents();
    } catch {
      toast.error("Failed to update student");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (student: StudentRow) => {
    if (
      !confirm(
        `Are you sure you want to delete ${student.full_name}? This cannot be undone.`
      )
    )
      return;

    const res = await adminFetch("/api/students", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: student.id }),
    });

    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || "Failed to delete student");
      return;
    }

    toast.success("Student deleted");
    await fetchStudents();
  };

  // Download one student's full profile as the template-formatted xlsx
  const handleDownloadProfile = async (student: StudentRow) => {
    try {
      const res = await adminFetch(`/api/students/${student.id}/export`);
      if (!res.ok) {
        toast.error("Failed to export student profile");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `student-profile-${student.admission_no}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export student profile");
    }
  };

  // Status update for a single student
  const handleStatusChange = async (enrollmentId: string, status: EnrollmentStatus) => {
    try {
      const res = await adminFetch("/api/students/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ enrollment_id: enrollmentId, status }],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update status");
        return;
      }

      // Update locally for instant feedback
      setStudents((prev) =>
        prev.map((s) =>
          s.enrollment_id === enrollmentId
            ? { ...s, enrollment_status: status }
            : s
        )
      );
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
    }
  };

  // Bulk status update
  const handleBulkStatusUpdate = async () => {
    if (!bulkStatusValue || selectedIds.size === 0) return;

    setApplyingBulk(true);
    try {
      const updates = Array.from(selectedIds)
        .map((studentId) => {
          const student = students.find((s) => s.id === studentId);
          return student?.enrollment_id
            ? { enrollment_id: student.enrollment_id, status: bulkStatusValue as EnrollmentStatus }
            : null;
        })
        .filter(Boolean);

      if (updates.length === 0) {
        toast.error("No valid enrollments selected");
        return;
      }

      const res = await adminFetch("/api/students/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update statuses");
        return;
      }

      toast.success(`Updated ${data.updated} student(s)`);
      setSelectedIds(new Set());
      setBulkStatusValue("");
      await fetchStudents();
    } catch {
      toast.error("Failed to update statuses");
    } finally {
      setApplyingBulk(false);
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} student${selectedIds.size === 1 ? "" : "s"}? This will also remove their enrollments and linked portal accounts. This cannot be undone.`
      )
    )
      return;

    setApplyingBulk(true);
    try {
      const res = await adminFetch("/api/students", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to delete students");
        return;
      }

      toast.success(`Deleted ${selectedIds.size} student${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      await fetchStudents();
    } catch {
      toast.error("Failed to delete students");
    } finally {
      setApplyingBulk(false);
    }
  };

  // Toggle selection
  const toggleSelection = (studentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  // Row callbacks, stabilised via a ref. The handlers above are redefined on
  // every render (they close over page state), which would defeat the memo on
  // StudentTableRow. Routing them through a ref gives the rows one permanently
  // stable `actions` object that still invokes the newest handler — no stale
  // closures and no dependency arrays to keep in sync.
  const rowHandlersRef = useRef<StudentRowActions | null>(null);
  useEffect(() => {
    rowHandlersRef.current = {
      onOpenDetail: (student) => setDetailStudent(student),
      onToggleSelect: (studentId) => toggleSelection(studentId),
      onEdit: (student) => openEditDialog(student),
      onFees: (studentId) => router.push(`/fees/payments?student_id=${studentId}`),
      onInvite: (student) => openInviteDialog(student),
      onDelete: (student) => handleDelete(student),
      onStatusChange: (enrollmentId, status) => handleStatusChange(enrollmentId, status),
    };
  });
  const rowActions = useMemo<StudentRowActions>(
    () => ({
      onOpenDetail: (student) => rowHandlersRef.current?.onOpenDetail(student),
      onToggleSelect: (studentId) => rowHandlersRef.current?.onToggleSelect(studentId),
      onEdit: (student) => rowHandlersRef.current?.onEdit(student),
      onFees: (studentId) => rowHandlersRef.current?.onFees(studentId),
      onInvite: (student) => rowHandlersRef.current?.onInvite(student),
      onDelete: (student) => rowHandlersRef.current?.onDelete(student),
      onStatusChange: (enrollmentId, status) =>
        rowHandlersRef.current?.onStatusChange(enrollmentId, status),
    }),
    []
  );


  const toggleSelectAll = () => {
    if (selectedIds.size === visibleStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleStudents.map((s) => s.id)));
    }
  };

  // Promote handler
  const handlePromote = async () => {
    if (!selectedClassId || !targetAcademicYearId) return;

    setPromoting(true);
    setPromoteResult(null);

    try {
      const res = await adminFetch("/api/students/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: selectedClassId,
          target_academic_year_id: targetAcademicYearId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Promotion failed");
        return;
      }

      setPromoteResult(data.summary);
      toast.success("Promotion completed");
      await fetchStudents();
    } catch {
      toast.error("Promotion failed");
    } finally {
      setPromoting(false);
    }
  };

  // Status counts for the currently loaded students
  const statusCounts = students.reduce(
    (acc, s) => {
      const st = s.enrollment_status || "active";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Get current class info for promote dialog
  const currentClass = classes.find((c) => c.id === selectedClassId);

  // Student form used in both Add and Edit dialogs — the field sections
  // (General Profile / Enrolment Profile) live in StudentFormFields.
  const renderStudentForm = (
    onSubmit: (e: React.FormEvent) => void,
    isEdit: boolean
  ) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <StudentFormFields
        formData={formData}
        setFormData={setFormData}
        classes={classes}
        streams={streams}
        errors={formErrors}
      />

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            resetForm();
            isEdit ? setEditDialogOpen(false) : setAddDialogOpen(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Update Student" : "Add Student"}
        </Button>
      </DialogFooter>
    </form>
  );


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-navy-900 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Students</h1>
            <p className="erp-page-subtitle">Manage student records and enrollments</p>
          </div>
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
              {selectedClassId && (
                <DropdownMenuItem
                  onClick={() => {
                    setPromoteResult(null);
                    setTargetAcademicYearId("");
                    setPromoteDialogOpen(true);
                  }}
                >
                  <ArrowUpCircle className="h-4 w-4 mr-2" />
                  Promote Class
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={visibleStudents.length === 0}
                onClick={() => {
                  const rows = visibleStudents.map((s) => ({
                    ...s,
                    class_name: s.class_name ?? "",
                    class_section: s.class_section ?? "",
                    enrollment_status: s.enrollment_status ?? "active",
                  }));
                  downloadCSV(rows, STUDENT_CSV_COLUMNS, `students-${new Date().toISOString().split("T")[0]}`);
                  toast.success(`Downloaded ${rows.length} students`);
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Excel
              </DropdownMenuItem>
              {/* H16-C — alumni revert manager. Admin-only (revert endpoint). */}
              {isAdmin && (
                <DropdownMenuItem onClick={() => setAlumniDialogOpen(true)}>
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Manage Alumni
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={openAddDialog}
            className="bg-navy-900 hover:bg-navy-800 text-white shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Student
          </Button>
        </div>
      </div>

      <div className="erp-table-container p-6">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="w-full sm:w-64">
            <Select
              value={selectedClassId || "all"}
              items={[{ value: "all", label: "All Classes" }, ...classes.map((c) => ({ value: c.id, label: classLabel(c) }))]}
              onValueChange={(val) => setSelectedClassId(!val || val === "all" ? "" : val)}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id} label={classLabel(c)}>
                    {classLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Search by name or admission number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900/20"
            />
          </div>
          <div className="flex items-center">
            <Badge variant="secondary" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
              <Users className="h-3 w-3 mr-1" />
              {visibleStudents.length} student
              {visibleStudents.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>

        {/* Active transport chip — set by the dashboard's Transport
            deep-link. Clear all collapses back to the normal class+search
            view. */}
        {auditFilterActive && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300 mr-1">
              Transport filter:
            </span>
            {auditHasTransport === "1" && (
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                Has transport
                <button
                  onClick={() => setAuditHasTransport("")}
                  className="ml-1.5 hover:opacity-70"
                  aria-label="Clear has-transport filter"
                >
                  ×
                </button>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAuditFilters}
              className="ml-auto h-7 text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-100/50 dark:hover:bg-amber-900/30"
            >
              Clear all
            </Button>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              {selectedIds.size} selected
            </span>
            <div className="w-40">
              <Select
                value={bulkStatusValue || "choose"}
                onValueChange={(val) => setBulkStatusValue(!val || val === "choose" ? "" : val)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Set status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="choose">Set status...</SelectItem>
                  {ENROLLMENT_STATUSES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {st.charAt(0).toUpperCase() + st.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!bulkStatusValue || applyingBulk}
              onClick={handleBulkStatusUpdate}
              className="bg-navy-900 hover:bg-navy-800 text-white"
            >
              {applyingBulk && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Apply
            </Button>
            {isAdmin && (
              <>
                <div className="w-px h-6 bg-blue-200 dark:bg-blue-700" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPortalDialogOpen(true)}
                  className="gap-1"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Create Users
                </Button>
              </>
            )}
            <div className="w-px h-6 bg-blue-200 dark:bg-blue-700" />
            <Button
              size="sm"
              variant="destructive"
              disabled={applyingBulk}
              onClick={handleBulkDelete}
            >
              {applyingBulk && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Delete Selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedIds(new Set());
                setBulkStatusValue("");
              }}
            >
              Clear
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">No students found.</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Upload an Excel file or add students individually.
            </p>
          </div>
        ) : (
          <>
            <TableFilterSummary
              ctl={table}
              total={filteredStudents.length}
              shown={visibleStudents.length}
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === visibleStudents.length && visibleStudents.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <SortFilterHead ctl={table} col="admission_no" />
                    <SortFilterHead ctl={table} col="full_name" />
                    {!selectedClassId && <SortFilterHead ctl={table} col="class" />}
                    {selectedClassId && <SortFilterHead ctl={table} col="roll_number" />}
                    <SortFilterHead ctl={table} col="father_name" />
                    <SortFilterHead ctl={table} col="status" />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-10 text-center text-gray-500 dark:text-gray-400"
                      >
                        No students match the column filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleStudents.map((student) => (
                    <StudentTableRow
                      key={student.id}
                      student={student}
                      selected={selectedIds.has(student.id)}
                      showClassColumn={!selectedClassId}
                      isAdmin={!!isAdmin}
                      actions={rowActions}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Add Student Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <GraduationCap className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <DialogTitle>Add New Student</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Enroll a new student into the system</p>
              </div>
            </div>
          </DialogHeader>
          {renderStudentForm(handleAddStudent, false)}
        </DialogContent>
      </Dialog>

      {/* Edit Student Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle>Edit Student</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Update student information</p>
              </div>
            </div>
          </DialogHeader>
          {renderStudentForm(handleEditStudent, true)}
        </DialogContent>
      </Dialog>

      {/* Student Detail Dialog (read-only quick peek) */}
      <Dialog
        open={!!detailStudent}
        onOpenChange={(open) => {
          if (!open) setDetailStudent(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {detailStudent && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-900/10 dark:bg-navy-900/30">
                    <User className="h-5 w-5 text-navy-900 dark:text-gold-400" />
                  </div>
                  <div>
                    <DialogTitle>{detailStudent.full_name}</DialogTitle>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Admission No: {detailStudent.admission_no}
                      {detailStudent.class_name
                        ? ` • Class ${detailStudent.class_name}${detailStudent.class_section ? `-${detailStudent.class_section}` : ""}`
                        : " • Unassigned"}
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <DetailField label="Roll Number" value={detailStudent.roll_number ?? "—"} />
                  <DetailField label="Status">
                    <Badge
                      variant="secondary"
                      className={
                        detailStudent.enrollment_status
                          ? STATUS_BADGE_STYLES[detailStudent.enrollment_status]
                          : detailStudent.is_active
                            ? STATUS_BADGE_STYLES.active
                            : STATUS_BADGE_STYLES.exited
                      }
                    >
                      {detailStudent.enrollment_status
                        ? detailStudent.enrollment_status.charAt(0).toUpperCase() +
                          detailStudent.enrollment_status.slice(1)
                        : detailStudent.is_active
                          ? "Active"
                          : "Inactive"}
                    </Badge>
                  </DetailField>
                </div>
                <ProfileDetailSection
                  title="General Profile"
                  section="general"
                  student={detailStudent}
                  streams={streams}
                />
                <ProfileDetailSection
                  title="Enrolment Profile"
                  section="enrolment"
                  student={detailStudent}
                  streams={streams}
                />
                <div>
                  <p className="text-sm font-semibold text-navy-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-1 mb-3">
                    Call
                  </p>
                  <StudentCallActions student={detailStudent} />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => detailStudent && handleDownloadProfile(detailStudent)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Profile
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const s = detailStudent;
                      setDetailStudent(null);
                      openInviteDialog(s);
                    }}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite guardian
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    const s = detailStudent;
                    setDetailStudent(null);
                    openEditDialog(s);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  onClick={() => setDetailStudent(null)}
                  className="bg-navy-900 hover:bg-navy-800 text-white"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Invite Guardian Dialog — creates the parent account AND the link */}
      <Dialog
        open={!!inviteStudent}
        onOpenChange={(open) => {
          if (!open) setInviteStudent(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {inviteStudent && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                    <UserPlus className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <DialogTitle>Invite a guardian</DialogTitle>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Creates a parent login linked to {inviteStudent.full_name} (
                      {inviteStudent.admission_no}) and emails them their credentials.
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invite_name" className="text-xs font-medium">
                    Guardian name *
                  </Label>
                  <Input
                    id="invite_name"
                    value={inviteForm.full_name}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, full_name: e.target.value }))
                    }
                    placeholder="e.g. Ramesh Kumar"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite_email" className="text-xs font-medium">
                    Email *
                  </Label>
                  <Input
                    id="invite_email"
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, email: e.target.value }))
                    }
                    placeholder="guardian@example.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite_phone" className="text-xs font-medium">
                      Phone
                    </Label>
                    <Input
                      id="invite_phone"
                      value={inviteForm.phone}
                      onChange={(e) =>
                        setInviteForm((f) => ({ ...f, phone: e.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Relationship</Label>
                    <Select
                      value={inviteForm.relationship}
                      onValueChange={(val) =>
                        val &&
                        setInviteForm((f) => ({
                          ...f,
                          relationship: val as "father" | "mother" | "guardian",
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="father">Father</SelectItem>
                        <SelectItem value="mother">Mother</SelectItem>
                        <SelectItem value="guardian">Guardian</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInviteStudent(null)}
                  disabled={inviting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleInvite}
                  disabled={inviting}
                  className="bg-navy-900 hover:bg-navy-800 text-white"
                >
                  {inviting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Inviting…
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Send invite
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Promote Dialog */}
      <Dialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <ArrowUpCircle className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <DialogTitle>Promote Class</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  {currentClass
                    ? `${currentClass.name} - ${currentClass.section}`
                    : "Select a class first"}
                </p>
              </div>
            </div>
          </DialogHeader>

          {promoteResult ? (
            <div className="space-y-4">
              <h3 className="font-medium text-sm">Promotion Complete</h3>
              <div className="grid grid-cols-2 gap-3">
                {promoteResult.promoted > 0 && (
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">{promoteResult.promoted}</p>
                    <p className="text-xs text-green-600 dark:text-green-500">Promoted</p>
                  </div>
                )}
                {promoteResult.retained > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{promoteResult.retained}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">Retained (Failed)</p>
                  </div>
                )}
                {promoteResult.graduated > 0 && (
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{promoteResult.graduated}</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500">Graduated (Alumni)</p>
                  </div>
                )}
                {promoteResult.skipped > 0 && (
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-muted">
                    <p className="text-2xl font-bold text-gray-700 dark:text-gray-400">{promoteResult.skipped}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-500">Skipped</p>
                  </div>
                )}
              </div>
              {promoteResult.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400">
                  <p className="font-medium mb-1">Warnings:</p>
                  <ul className="list-disc pl-4 space-y-1 text-xs">
                    {promoteResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {promoteResult.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 text-sm text-red-700 dark:text-red-400">
                  <p className="font-medium mb-1">Errors:</p>
                  <ul className="list-disc pl-4 space-y-1 text-xs">
                    {promoteResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPromoteDialogOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Status summary */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/20">
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{statusCounts.passed || 0}</p>
                  <p className="text-[10px] text-blue-600 dark:text-blue-500">Passed</p>
                </div>
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{statusCounts.failed || 0}</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-500">Failed</p>
                </div>
                <div className="p-2 rounded bg-red-50 dark:bg-red-950/20">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{(statusCounts.terminated || 0) + (statusCounts.exited || 0)}</p>
                  <p className="text-[10px] text-red-600 dark:text-red-500">Term/Exit</p>
                </div>
                <div className="p-2 rounded bg-green-50 dark:bg-green-950/20">
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">{statusCounts.active || 0}</p>
                  <p className="text-[10px] text-green-600 dark:text-green-500">Active</p>
                </div>
              </div>

              {(statusCounts.active || 0) > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400">
                  <strong>{statusCounts.active}</strong> student(s) still have &quot;active&quot; status.
                  Please mark all students as passed/failed/terminated/exited before promoting.
                </div>
              )}

              <div>
                <Label className="text-xs font-medium">Promote to Academic Year *</Label>
                <Select
                  value={targetAcademicYearId || "choose"}
                  items={[
                    { value: "choose", label: "Select academic year..." },
                    ...academicYears.map((y) => ({ value: y.id, label: y.name + (y.is_current ? " (Current)" : "") })),
                  ]}
                  onValueChange={(val) => setTargetAcademicYearId(!val || val === "choose" ? "" : val)}
                >
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Select target academic year..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="choose">Select academic year...</SelectItem>
                    {academicYears.map((y) => (
                      <SelectItem
                        key={y.id}
                        value={y.id}
                        label={`${y.name}${y.is_current ? " (Current)" : ""}`}
                      >
                        {y.name}{y.is_current ? " (Current)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {currentClass && (
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  {currentClass.name === "XII" ? (
                    <p>Passed students will be <strong>graduated as alumni</strong>.</p>
                  ) : (
                    <p>Passed students will be promoted to the next grade with the same section.</p>
                  )}
                  <p>Failed students will be re-enrolled in the same class.</p>
                  <p>Terminated/Exited students will be skipped.</p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setPromoteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={promoting || !targetAcademicYearId || (statusCounts.active || 0) > 0}
                  onClick={handlePromote}
                  className="bg-navy-900 hover:bg-navy-800 text-white"
                >
                  {promoting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Promote Students
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* H16-C · Alumni manager dialog */}
      <Dialog open={alumniDialogOpen} onOpenChange={setAlumniDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Alumni</DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Revert a graduated student back to active status. Use this when
              promotion was applied in error or when an alumnus is returning
              for an additional year.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={alumniSearch}
                onChange={(e) => setAlumniSearch(e.target.value)}
                placeholder="Search by name, admission no, or year"
                className="pl-9"
              />
            </div>
            {alumniLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : alumniRows.length === 0 ? (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-12">
                No alumni records.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-32">Admission</TableHead>
                    <TableHead>Father</TableHead>
                    <TableHead className="w-28">Passed</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alumniRows
                    .filter((r) => {
                      if (!alumniSearch) return true;
                      const q = alumniSearch.toLowerCase();
                      return (
                        r.full_name.toLowerCase().includes(q) ||
                        r.admission_no.toLowerCase().includes(q) ||
                        (r.alumni_passing_year ?? "").toLowerCase().includes(q)
                      );
                    })
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.full_name}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                          {r.admission_no}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.father_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.alumni_passing_year ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRevertForm({
                                reason: "",
                                reactivate_class_id: "",
                                reactivate_academic_year_id: "",
                              });
                              setRevertDialog({ open: true, target: r });
                            }}
                          >
                            Revert
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* H16-C · Revert alumni form dialog */}
      <Dialog
        open={revertDialog.open}
        onOpenChange={(o) =>
          setRevertDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Revert {revertDialog.target?.full_name ?? "alumni"}?
            </DialogTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This clears the alumni flags so the student can be enrolled
              again. Re-enrollment is optional — leave the class fields blank
              to flip the flags only and assign a class later.
            </p>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Reason *</Label>
              <Input
                value={revertForm.reason}
                onChange={(e) =>
                  setRevertForm((p) => ({ ...p, reason: e.target.value }))
                }
                placeholder="Why is this revert happening?"
              />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Reactivate Academic Year (optional)
                </Label>
                <Select
                  value={revertForm.reactivate_academic_year_id}
                  items={academicYears.map((y) => ({
                    value: y.id,
                    label: y.name,
                  }))}
                  onValueChange={(v) =>
                    setRevertForm((p) => ({
                      ...p,
                      reactivate_academic_year_id: v ?? "",
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick year" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYears.map((y) => (
                      <SelectItem key={y.id} value={y.id} label={y.name}>
                        {y.name}
                        {y.is_current ? " (current)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  Reactivate Class (optional)
                </Label>
                <Select
                  value={revertForm.reactivate_class_id}
                  items={classes
                    .filter(
                      (c) =>
                        !revertForm.reactivate_academic_year_id ||
                        true /* class list isn't year-filtered here; keep flexible */
                    )
                    .map((c) => ({
                      value: c.id,
                      label: formatClassName(c),
                    }))}
                  onValueChange={(v) =>
                    setRevertForm((p) => ({
                      ...p,
                      reactivate_class_id: v ?? "",
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick class (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id} label={formatClassName(c)}>
                        {formatClassName(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setRevertDialog({ open: false, target: null })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmRevert}
              disabled={reverting || revertForm.reason.trim().length < 5}
              className="bg-navy-900 text-white hover:bg-navy-900/90"
            >
              {reverting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <StudentBulkUpload
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onSuccess={fetchStudents}
      />

      {/* Create Portal Users Dialog */}
      <CreatePortalUsersDialog
        open={portalDialogOpen}
        onOpenChange={setPortalDialogOpen}
        type="student"
        items={visibleStudents
          .filter((s) => selectedIds.has(s.id))
          .map((s) => ({ id: s.id, name: s.full_name, email: s.email, phone: s.phone }))}
        onComplete={fetchStudents}
      />
    </div>
  );
}
