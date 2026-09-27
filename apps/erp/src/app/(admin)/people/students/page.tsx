"use client";

import dynamic from "next/dynamic";
import { useMountOnceOpen } from "@nkps/shared/lib/hooks/use-mount-once-open";

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
  useDeferredValue,
} from "react";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Textarea } from "@nkps/shared/components/ui/textarea";
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@nkps/shared/components/ui/tabs";
import { toast } from "sonner";
import { todayISO } from "@nkps/shared/lib/date";
import {
  ArrowUpCircle,
  CalendarClock,
  ChevronDown,
  Download,
  GraduationCap,
  History,
  Info,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nkps/shared/components/ui/dropdown-menu";
// Loaded when it is first opened, not when the page is. Bulk upload is a
// once-a-session job on a screen people open every day, and the component
// is 1503 lines of it.
const StudentBulkUpload = dynamic(() =>
  import("@/components/StudentBulkUpload").then((m) => m.StudentBulkUpload)
);
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
import {
  StatusChangeDialog,
  statusNeedsReason,
  type StatusChangeRequest,
} from "./_components/StatusChangeDialog";
import {
  ExitDateDialog,
  type ExitDateRequest,
} from "./_components/ExitDateDialog";
import { StudentCallActions } from "@/components/StudentCallActions";
import { useIsAdmin } from "@nkps/shared/hooks/useIsAdmin";
import { useUrlState } from "@nkps/shared/lib/hooks/use-url-state";
import { formatClassName } from "@nkps/shared/lib/utils";
import {
  downloadCSV,
  STUDENT_CSV_COLUMNS,
  studentExportColumns,
} from "@/lib/csv-export";
import { TableExportButton } from "@nkps/shared/components/ui/table-export-button";
import { AcademicSessionPicker } from "@nkps/shared/components/AcademicSessionPicker";
import { useAcademicSession } from "@nkps/shared/lib/hooks/use-academic-session";
import { MIN_CORRECTION_REASON } from "@/lib/historical-correction";
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

// Rows rendered per page. The table is unvirtualised and every row mounts a
// portalled base-ui Select, so the fix for the input lag is to mount fewer
// rows rather than to virtualise popovers.
const PAGE_SIZE = 50;

interface StudentRow extends Student {
  roll_number: number | null;
  roll_number_manual?: boolean;
  enrollment_id: string | null;
  class_id?: string | null;
  stream_id?: string | null;
  /** Per-session house (migration 090). Lives on the enrollment, like class. */
  house_id?: string | null;
  enrollment_status?: EnrollmentStatus | null;
  // Which session the representative enrollment belongs to. A student with no
  // current-year row surfaces a PAST year's record, which the API treats as
  // read-only — see the past-year guard in api/students PATCH.
  enrollment_academic_year_id?: string | null;
  enrollment_is_current_year?: boolean;
  // Latest recorded reason for the current status (migration 087 cache).
  status_reason?: string | null;
  status_changed_at?: string | null;
  /** Billing cutoff for a leaver (migration 123). Null while on the roll. */
  exit_date?: string | null;
  class_name?: string;
  class_section?: string;
  // Transport columns surfaced for the dashboard deep-link filter
  // (?has_transport). Stop-based model (migration 074).
  has_transport?: boolean | null;
  bus_stop_id?: string | null;
  transport_direction?: string | null;
}

// Lifecycle buckets for the list. "unassigned" is deliberately its own tab
// rather than being folded into Active: those students have NO enrollment
// row at all, and the status column used to label them "Active", which is
// simply untrue. Their own tab turns "who still needs a class?" into one
// click. "alumni" is server-backed (?scope=alumni) because the main listing
// excludes is_alumni rows by design.
const STUDENT_TABS = [
  { key: "active", label: "Active" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "exited", label: "Exited" },
  { key: "terminated", label: "Terminated" },
  { key: "unassigned", label: "Unassigned" },
  { key: "alumni", label: "Alumni" },
  { key: "all", label: "All" },
] as const;

type StudentTabKey = (typeof STUDENT_TABS)[number]["key"];

function matchesTab(s: StudentRow, tab: StudentTabKey): boolean {
  if (tab === "all") return true;
  if (tab === "unassigned") return !s.enrollment_id;
  if (!s.enrollment_id) return false;
  return (s.enrollment_status ?? "active") === tab;
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
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
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
  onEditExitDate: (student: StudentRow) => void;
  onUnlock: (student: StudentRow) => void;
}

const StudentTableRow = memo(function StudentTableRow({
  student,
  selected,
  showClassColumn,
  isAdmin,
  /** The session on screen has ended: its records are closed. */
  sessionClosed,
  /** ...unless this record was explicitly unlocked for correction. */
  unlocked,
  actions,
}: {
  student: StudentRow;
  selected: boolean;
  showClassColumn: boolean;
  isAdmin: boolean;
  sessionClosed: boolean;
  unlocked: boolean;
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
      <TableCell className="text-gray-600 dark:text-gray-300">
        {student.gender
          ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1)
          : "—"}
      </TableCell>
      <TableCell className="text-gray-600 dark:text-gray-300">
        {student.has_transport ? (
          <Badge
            variant="secondary"
            className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
          >
            Bus
          </Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
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
        {student.status_reason && (
          <span
            className="inline-flex"
            aria-label="Reason for this status"
            title={
              student.status_changed_at
                ? `${student.status_reason}\n— ${new Date(student.status_changed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                : student.status_reason
            }
          >
            <Info className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
          </span>
        )}
        {/* Only a leaver has a leaving date, and it is the one field on this
            row that moves money — an instalment due after it is never billed.
            A missing date is called out in amber because it means the student
            is still accruing fees, which is the state this whole feature
            exists to end. */}
        {student.enrollment_id &&
          (student.enrollment_status === "exited" ||
            student.enrollment_status === "terminated") && (
            <button
              type="button"
              onClick={() => actions.onEditExitDate(student)}
              aria-label={
                student.exit_date
                  ? `Left on ${student.exit_date}. Change the leaving date.`
                  : "No leaving date on record. Set one."
              }
              title={
                student.exit_date
                  ? `Left on ${student.exit_date} — fees due after this date are not charged. Click to change.`
                  : "No leaving date on record, so this student is still being billed to today. Click to set one."
              }
              className={
                "inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-colors " +
                (student.exit_date
                  ? "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  : "text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30")
              }
            >
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {student.exit_date ?? "Set date"}
            </button>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {sessionClosed && !unlocked ? (
            // A closed session is read-only. The pencil is replaced rather
            // than disabled so the reason is visible without hovering, and
            // the lock is the affordance that explains what to do next.
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onUnlock(student)}
              disabled={!isAdmin}
              aria-label="Unlock this record for correction"
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              title={
                isAdmin
                  ? "This session is closed — unlock to correct this record"
                  : "This session is closed. Only an admin can correct it."
              }
            >
              <Lock className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onEdit(student)}
              aria-label="Edit student"
              className={
                unlocked
                  ? "text-amber-600 dark:text-amber-400 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  : "text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              }
              title={unlocked ? "Edit (correcting a closed session)" : "Edit student"}
            >
              {unlocked ? (
                <LockOpen className="h-4 w-4" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.onFees(student.id)}
            aria-label="View fees / record payment"
            className="text-green-600 dark:text-green-400 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
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
              className="text-violet-500 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950/30" // color-ok: violet is the Users/portal accent — this invites a guardian account
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
  const [houses, setHouses] = useState<{ id: string; name: string }[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  // Filter state lives in the URL so back-navigation restores it (UX-1).
  const [selectedClassId, setSelectedClassId] = useUrlState("class_id");
  const [search, setSearch] = useUrlState("q");
  // Lifecycle tab. URL-backed so a tab is linkable and survives reload,
  // the same treatment class_id already gets.
  const [statusTab, setStatusTab] = useUrlState("status");
  const activeTab = (
    STUDENT_TABS.some((t) => t.key === statusTab) ? statusTab : "active"
  ) as StudentTabKey;
  // Transport filter set by the dashboard's Transport tile. Stacks
  // multiplicatively with the existing class + name search so admins can
  // narrow further from the deep-linked starting point.
  const [auditHasTransport, setAuditHasTransport] = useUrlState("has_transport");

  // Dialogs
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const showStudentBulkUpload = useMountOnceOpen(uploadDialogOpen);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [portalDialogOpen, setPortalDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatusValue, setBulkStatusValue] = useState<string>("");
  const [applyingBulk, setApplyingBulk] = useState(false);
  // The re-upload CSV re-fetches the full student columns on demand, so its
  // menu item has a wait worth showing.
  const [buildingReuploadCsv, setBuildingReuploadCsv] = useState(false);

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
  const [page, setPage] = useState(1);
  // Pending Terminated/Exited change awaiting a reason.
  const [statusRequest, setStatusRequest] =
    useState<StatusChangeRequest | null>(null);
  const [exitDateRequest, setExitDateRequest] =
    useState<ExitDateRequest | null>(null);
  const [alumniRows, setAlumniRows] = useState<AlumniRow[]>([]);
  const [alumniLoading, setAlumniLoading] = useState(false);
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
  // Both dialogs render every field in the shared template registry, which the
  // narrow list payload does not carry — so each waits on its own fetch of the
  // full row. "error" is a distinct state on purpose: a detail drawer showing
  // twelve of fifty fields with no explanation reads as "this student has no
  // details recorded", which is a lie.
  const [detailLoad, setDetailLoad] =
    useState<"loading" | "ready" | "error">("ready");
  const [editLoading, setEditLoading] = useState(false);
  // Which student each dialog is currently loading. Set on open, compared when
  // the fetch resolves, so opening a second row while the first is in flight
  // can't have the first one's record land in the dialog.
  const detailLoadRef = useRef<string | null>(null);
  const editLoadRef = useRef<string | null>(null);

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

  // Which academic session the list describes. Class, section, roll number
  // and transport all live on the year-scoped enrollment, so without this
  // the page silently shows a mix resolved by heuristic — fine to browse,
  // wrong to download.
  // Records unlocked for correction in this visit, and the reason each was
  // unlocked for. Held in memory rather than persisted: an unlock is meant to
  // cover one correction, not to leave a closed session editable in a tab
  // somebody left open.
  const [unlockedIds, setUnlockedIds] = useState<Map<string, string>>(new Map());
  const [unlockTarget, setUnlockTarget] = useState<StudentRow | null>(null);
  const [unlockReason, setUnlockReason] = useState("");

  const session = useAcademicSession();

  const sessionId = session.sessionId;

  const fetchClasses = useCallback(async () => {
    // Streams and the academic-year list don't depend on the current year, so
    // they're kicked off immediately and awaited later — only the classes
    // query has to wait for the current-year lookup. Previously all four ran
    // back to back, costing four serial round trips on every page load.
    // kind='stream' only: feeds the enrolment stream picker in
    // StudentFormFields, whose value becomes student_enrollments.stream_id.
    // (migration 118)
    const streamsPromise = supabase
      .from("streams")
      .select("*")
      .eq("kind", "stream")
      .eq("is_active", true)
      .order("sort_order");
    const allYearsPromise = supabase
      .from("academic_years")
      .select("id, name, is_current")
      .order("name", { ascending: false });
    const housesPromise = supabase
      .from("houses")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order");

    // Classes belong to a session, so the picker drives this too — otherwise
    // a past session's students would be filtered by this year's class list.
    let query = supabase
      .from("classes")
      .select("id, name, section, stream_id, streams(name)")
      .order("sort_order", { ascending: true });

    if (sessionId) {
      query = query.eq("academic_year_id", sessionId);
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
    const [{ data: streamsData }, { data: allYears }, { data: houseRows }] =
      await Promise.all([streamsPromise, allYearsPromise, housesPromise]);
    setStreams((streamsData as Stream[]) ?? []);
    setAcademicYears((allYears as AcademicYear[]) ?? []);
    // Empty until migration 090 is applied; the form control degrades to
    // "No house" rather than erroring.
    setHouses((houseRows as { id: string; name: string }[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Which listing query the page is looking at. Shared so the re-upload CSV
  // below can re-ask for exactly the same set of students with `full=1`.
  //
  // A session other than the current one takes the roster branch of the API,
  // which hard-filters by year and includes students who have since left — the
  // current-session view keeps the heuristic that lets an admin find any name
  // regardless of state.
  const listUrl = useCallback(
    (full = false) => {
      const params = new URLSearchParams();
      if (selectedClassId) params.set("class_id", selectedClassId);
      else if (sessionId && !session.isCurrentSession)
        params.set("academic_year_id", sessionId);
      if (full) params.set("full", "1");
      const qs = params.toString();
      return qs ? `/api/students?${qs}` : "/api/students";
    },
    [selectedClassId, sessionId, session.isCurrentSession]
  );

  const fetchStudents = useCallback(async () => {
    setLoading(true);

    try {
      const res = await adminFetch(listUrl());
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
  }, [listUrl]);

  // One student's complete record.
  //
  // The listing carries only the dozen columns the table, the search and the
  // row actions read (see LIST_STUDENT_COLUMNS in api/students/route.ts). Any
  // surface driven by the shared template registry — the edit form and the
  // detail drawer — needs all ~50 of its fields, so it reads them here when
  // the reader opens it rather than having every reader download them for 900
  // students they will never open.
  const fetchFullStudent = useCallback(
    async (id: string): Promise<Record<string, unknown> | null> => {
      try {
        const res = await adminFetch(`/api/students/${id}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.data) {
          toast.error(json.error || "Could not load the full student record");
          return null;
        }
        return json.data as Record<string, unknown>;
      } catch {
        toast.error("Could not load the full student record");
        return null;
      }
    },
    []
  );

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  // Fetch all students on initial load, and re-fetch when class changes
  useEffect(() => {
    fetchStudents();
    // Clear selection whenever the underlying list changes — ticked ids from
    // one class or session mean nothing in another. Unlocks go too: one
    // granted for 2022-23 must not still be standing after switching to
    // 2023-24.
    setSelectedIds(new Set());
    setUnlockedIds(new Map());
  }, [selectedClassId, sessionId, fetchStudents]);

  // Alumni are excluded from the main listing by design (they accumulate a
  // cohort per year and would swamp the working list), so the Alumni tab is
  // its own server round trip. Goes through the API rather than a direct
  // supabase query so authorisation matches every other read on this page.
  const fetchAlumni = useCallback(async () => {
    setAlumniLoading(true);
    try {
      const res = await adminFetch("/api/students?scope=alumni");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to load alumni");
        setAlumniRows([]);
        return;
      }
      setAlumniRows((data.data as AlumniRow[]) ?? []);
    } catch {
      toast.error("Failed to load alumni");
      setAlumniRows([]);
    } finally {
      setAlumniLoading(false);
    }
  }, []);

  // Lazy: only pay for it when the reader actually opens the tab.
  useEffect(() => {
    if (activeTab === "alumni" && alumniRows.length === 0 && !alumniLoading) {
      fetchAlumni();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  // Deferred so the input paints on the keystroke and the ~900-row table
  // catches up a frame later, instead of the filter+re-render running
  // synchronously inside the keypress.
  const deferredSearch = useDeferredValue(search);

  // MUST be memoised. useTableControls memoises its filter and sort passes on
  // the identity of `rows`; a fresh array every render made both memos miss
  // every time, so each keystroke re-filtered and re-sorted the whole list.
  //
  // Split in two so the tab filter is a separate cheap pass over an already
  // stable array: switching tabs then doesn't redo the search scan, and
  // `searchFiltered` doubles as the cross-tab count for the "no matches here,
  // N elsewhere" hint below.
  const searchFiltered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (q) {
        const matches =
          s.full_name.toLowerCase().includes(q) ||
          s.admission_no.toLowerCase().includes(q) ||
          (s.father_name && s.father_name.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (auditHasTransport === "1" && !s.has_transport) return false;
      return true;
    });
  }, [students, deferredSearch, auditHasTransport]);

  const filteredStudents = useMemo(
    () => searchFiltered.filter((s) => matchesTab(s, activeTab)),
    [searchFiltered, activeTab]
  );

  // Per-tab counts in ONE pass over the search-filtered rows, so the badges
  // track what the reader is actually looking at. (Alumni is server-backed,
  // hence its own count.)
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: searchFiltered.length };
    for (const s of searchFiltered) {
      const key = s.enrollment_id ? (s.enrollment_status ?? "active") : "unassigned";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [searchFiltered]);

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
      // Gender and transport are already in the row payload (`select("*")` on
      // students, and the enrollment merge for transport), so surfacing them
      // costs no extra query — and they are the two things the office most
      // often needs to narrow by: "the girls in XI", "everyone on a bus".
      gender: {
        label: "Gender",
        value: (s) =>
          s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : null,
        emptyLabel: "Not recorded",
      },
      transport: {
        label: "Transport",
        value: (s) => Boolean(s.has_transport),
      },
      status: {
        label: "Status",
        value: (s) => {
          const status =
            s.enrollment_status ??
            (s.enrollment_id ? "active" : s.is_active ? "active" : "exited");
          return status.charAt(0).toUpperCase() + status.slice(1);
        },
        // While a specific tab is active the tab IS the status filter; leaving
        // the header filter live would give two competing controls for one
        // thing, with the header able to empty a tab it can't explain. Only
        // the All tab offers it.
        filter: activeTab === "all" ? "select" : "none",
      },
    }),
    [activeTab]
  );

  const table = useTableControls({ rows: filteredStudents, columns });
  // Everything downstream of the header filters — selection, the count badge,
  // CSV export — works on what the user can actually see.
  // `visibleStudents` is the full filtered + sorted set: select-all, the
  // counts and the CSV export all operate on it. Only `pagedStudents` is
  // rendered — mounting ~900 rows (each carrying a base-ui Select and
  // Checkbox) is what made typing and backspacing stall.
  const visibleStudents = table.rows;

  const pageCount = Math.max(1, Math.ceil(visibleStudents.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedStudents = useMemo(
    () => visibleStudents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleStudents, safePage]
  );

  // Any change to what's being listed sends the reader back to page 1.
  useEffect(() => {
    setPage(1);
  }, [deferredSearch, selectedClassId, auditHasTransport, activeTab, table.activeFilterCount]);

  const resetForm = () => {
    setFormData(emptyStudentForm(selectedClassId));
    setFormErrors({});
    setEditingStudent(null);
    setEditLoading(false);
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

  // The edit form writes EVERY column in the shared template registry, and
  // reads its initial value straight off the row it is handed. The list row
  // carries a dozen columns, so opening the form on it would show ~40 fields
  // blank and then save those blanks over real data. The full row is fetched
  // first, and the form is not rendered until it arrives.
  const openEditDialog = async (student: StudentRow) => {
    setFormErrors({});
    setEditingStudent(student);
    editLoadRef.current = student.id;
    setEditLoading(true);
    setEditDialogOpen(true);

    const full = await fetchFullStudent(student.id);
    if (editLoadRef.current !== student.id) return;
    editLoadRef.current = null;
    setEditLoading(false);

    if (!full) {
      // Better to close than to offer a form that would blank the record.
      setEditDialogOpen(false);
      setEditingStudent(null);
      return;
    }
    // `full` holds only `students` columns, so the enrollment-derived fields
    // the list merged in (class_id, roll_number, stream_id, house_id,
    // enrollment_id …) survive the spread.
    const merged = { ...student, ...full } as unknown as StudentRow;
    setEditingStudent(merged);
    setFormData(studentToForm(merged, selectedClassId));
  };

  // The detail drawer renders both template sections, so it needs the same
  // full row. Its header (name, admission no, class) comes from the list row
  // and paints immediately; only the profile sections wait.
  const openDetailDialog = async (student: StudentRow) => {
    setDetailStudent(student);
    detailLoadRef.current = student.id;
    setDetailLoad("loading");

    const full = await fetchFullStudent(student.id);
    if (detailLoadRef.current !== student.id) return;
    detailLoadRef.current = null;

    if (!full) {
      setDetailLoad("error");
      return;
    }
    setDetailStudent((prev) =>
      prev && prev.id === student.id
        ? ({ ...prev, ...full } as unknown as StudentRow)
        : prev
    );
    setDetailLoad("ready");
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
          house_id: formData.house_id || null,
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
          house_id: formData.house_id || null,
          // Present only for a record the admin unlocked. The server re-checks
          // the role and the reason — this is what permits the write and what
          // gets recorded alongside it.
          historical_correction: unlockedIds.has(editingStudent.id)
            ? { reason: unlockedIds.get(editingStudent.id) }
            : undefined,
          ...buildStudentPayload(formData),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        applyServerErrors(data, "Failed to update student");
        return;
      }

      setFormErrors({});
      // An unlock covers the one correction it was opened for. Leaving it
      // standing would turn a deliberate act into an ambient mode, which is
      // exactly what the read-only default is there to avoid.
      setUnlockedIds((prev) => {
        if (!prev.has(editingStudent.id)) return prev;
        const next = new Map(prev);
        next.delete(editingStudent.id);
        return next;
      });
      toast.success(
        session.isPastSession
          ? "Correction saved and recorded"
          : "Student updated successfully"
      );
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

  // The bulk-upload round-trip CSV.
  //
  // STUDENT_CSV_COLUMNS spans the whole template registry, because its headers
  // are the bulk importer's — so this is the one client that genuinely needs
  // every student column. It asks for them here, on the click, instead of the
  // listing shipping them to every reader: the same query the list is showing
  // with `full=1`, merged onto the rows the filters have already narrowed to.
  const handleDownloadReuploadTemplate = async () => {
    setBuildingReuploadCsv(true);
    try {
      const res = await adminFetch(listUrl(true));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Failed to build the re-upload file");
        return;
      }
      const fullById = new Map(
        ((json.data as Record<string, unknown>[]) ?? []).map((r) => [
          r.id as string,
          r,
        ])
      );
      const rows = visibleStudents.map((s) => ({
        ...s,
        // Only `students` columns are overwritten; class, roll number and
        // status come off the enrollment and are restated below.
        ...(fullById.get(s.id) ?? {}),
        class_name: s.class_name ?? "",
        class_section: s.class_section ?? "",
        enrollment_status: s.enrollment_status ?? "active",
      }));
      downloadCSV(rows, STUDENT_CSV_COLUMNS, `students-${todayISO()}`);
      toast.success(`Downloaded ${rows.length} students`);
    } catch {
      toast.error("Failed to build the re-upload file");
    } finally {
      setBuildingReuploadCsv(false);
    }
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

  // Applies a status change. `reason` is required by the API for
  // terminated/exited, and `exitDate` is where their fee billing stops; the
  // dialog collects both before we get here.
  const applyStatusChange = async (
    updates: { enrollment_id: string; status: EnrollmentStatus }[],
    reason?: string,
    exitDate?: string
  ): Promise<boolean> => {
    const res = await adminFetch("/api/students/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates,
        ...(reason ? { reason } : {}),
        ...(exitDate ? { exit_date: exitDate } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(
        data.details?.fieldErrors
          ? Object.values(
              data.details.fieldErrors as Record<string, string[]>
            )[0]?.[0] ?? data.error
          : data.error || "Failed to update status"
      );
      return false;
    }
    return true;
  };

  // Status update for a single student. Terminated/Exited detour through the
  // dialog so a reason is captured; everything else applies immediately.
  const handleStatusChange = async (enrollmentId: string, status: EnrollmentStatus) => {
    if (statusNeedsReason(status)) {
      const student = students.find((s) => s.enrollment_id === enrollmentId);
      if (!student) return;
      // The row Select is controlled off enrollment_status, so cancelling the
      // dialog reverts the displayed badge with no extra state.
      setStatusRequest({
        status,
        student: {
          id: student.id,
          full_name: student.full_name,
          enrollment_id: enrollmentId,
        },
      });
      return;
    }

    try {
      const ok = await applyStatusChange([
        { enrollment_id: enrollmentId, status },
      ]);
      if (!ok) return;

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

  // Resolves the current selection to enrollment ids, dropping students who
  // have no enrollment row to change.
  const selectedEnrollmentIds = useCallback((): string[] => {
    return Array.from(selectedIds)
      .map((studentId) => students.find((s) => s.id === studentId)?.enrollment_id)
      .filter((id): id is string => Boolean(id));
  }, [selectedIds, students]);

  // Bulk status update
  const handleBulkStatusUpdate = async () => {
    if (!bulkStatusValue || selectedIds.size === 0) return;

    const status = bulkStatusValue as EnrollmentStatus;
    const enrollmentIds = selectedEnrollmentIds();

    if (enrollmentIds.length === 0) {
      toast.error("No valid enrollments selected");
      return;
    }

    if (statusNeedsReason(status)) {
      setStatusRequest({ status, enrollmentIds });
      return;
    }

    setApplyingBulk(true);
    try {
      const ok = await applyStatusChange(
        enrollmentIds.map((enrollment_id) => ({ enrollment_id, status }))
      );
      if (!ok) return;

      toast.success(`Updated ${enrollmentIds.length} student(s)`);
      setSelectedIds(new Set());
      setBulkStatusValue("");
      await fetchStudents();
    } catch {
      toast.error("Failed to update statuses");
    } finally {
      setApplyingBulk(false);
    }
  };

  // Correcting a leaving date on someone who has already left. Kept apart from
  // the status flow because re-selecting a status a student already holds is a
  // no-op that change_enrollment_status() skips — there is no transition to
  // hang it off, and the date is what decides their fees.
  const openExitDateDialog = (student: StudentRow) => {
    if (!student.enrollment_id) return;
    setExitDateRequest({
      enrollment_id: student.enrollment_id,
      full_name: student.full_name,
      exit_date: student.exit_date ?? null,
      status: student.enrollment_status ?? "exited",
    });
  };

  const handleExitDateConfirm = async (exitDate: string, note: string) => {
    if (!exitDateRequest) return;
    try {
      const res = await adminFetch("/api/students/exit-date", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: exitDateRequest.enrollment_id,
          exit_date: exitDate,
          ...(note ? { note } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update the leaving date");
        return;
      }
      // The server clamps a date past the session end, so echo back what it
      // actually stored rather than what was typed.
      const stored = (data.exit_date as string) ?? exitDate;
      toast.success(
        data.changed
          ? `Leaving date set to ${stored}. Fees due after it are no longer charged.`
          : "Leaving date unchanged"
      );
      setExitDateRequest(null);
      await fetchStudents();
    } catch {
      toast.error("Failed to update the leaving date");
    }
  };

  // Confirm handler for the reason dialog — covers both single and bulk.
  const handleStatusReasonConfirm = async (reason: string, exitDate: string) => {
    if (!statusRequest) return;
    const { status, student, enrollmentIds } = statusRequest;
    const ids = enrollmentIds ?? (student ? [student.enrollment_id] : []);
    if (ids.length === 0) return;

    try {
      const ok = await applyStatusChange(
        ids.map((enrollment_id) => ({ enrollment_id, status })),
        reason,
        exitDate
      );
      if (!ok) return;

      toast.success(
        ids.length === 1 ? "Status updated" : `Updated ${ids.length} student(s)`
      );
      setStatusRequest(null);
      if (enrollmentIds) {
        setSelectedIds(new Set());
        setBulkStatusValue("");
      }
      await fetchStudents();
    } catch {
      toast.error("Failed to update status");
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
      onOpenDetail: (student) => openDetailDialog(student),
      onToggleSelect: (studentId) => toggleSelection(studentId),
      onEdit: (student) => openEditDialog(student),
      onFees: (studentId) => router.push(`/fees/payments?student_id=${studentId}`),
      onInvite: (student) => openInviteDialog(student),
      onDelete: (student) => handleDelete(student),
      onStatusChange: (enrollmentId, status) => handleStatusChange(enrollmentId, status),
      onEditExitDate: (student) => openExitDateDialog(student),
      onUnlock: (student) => {
        setUnlockReason("");
        setUnlockTarget(student);
      },
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
      onEditExitDate: (student) => rowHandlersRef.current?.onEditExitDate(student),
      onUnlock: (student) => rowHandlersRef.current?.onUnlock(student),
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

  // Status counts over the FULL loaded list, not the visible page — the
  // promote gate depends on knowing every active student in the class, and a
  // count taken from a filtered view would under-report and wrongly enable it.
  const statusCounts = useMemo(
    () =>
      students.reduce(
        (acc, s) => {
          const st = s.enrollment_status || "active";
          acc[st] = (acc[st] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    [students]
  );

  // Get current class info for promote dialog
  const currentClass = classes.find((c) => c.id === selectedClassId);

  // Alumni tab body. Replaces the old "Manage Alumni" dialog, which was a
  // second, divergent way of listing students (its own fetch, its own search,
  // its own columns). One list, one search box, one mental model.
  const renderAlumniList = () => {
    if (alumniLoading) {
      return (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
        </div>
      );
    }

    const q = deferredSearch.trim().toLowerCase();
    const rows = q
      ? alumniRows.filter(
          (r) =>
            r.full_name.toLowerCase().includes(q) ||
            r.admission_no.toLowerCase().includes(q) ||
            (r.father_name ?? "").toLowerCase().includes(q) ||
            (r.alumni_passing_year ?? "").toLowerCase().includes(q)
        )
      : alumniRows;

    if (rows.length === 0) {
      return (
        <div className="text-center py-12">
          <GraduationCap className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {alumniRows.length === 0
              ? "No alumni records yet."
              : "No alumni match your search."}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Admission</TableHead>
              <TableHead>Father</TableHead>
              <TableHead className="w-28">Passed</TableHead>
              {isAdmin && <TableHead className="w-28 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.full_name}</TableCell>
                <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                  {r.admission_no}
                </TableCell>
                <TableCell className="text-sm">{r.father_name ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {r.alumni_passing_year ?? "—"}
                </TableCell>
                {isAdmin && (
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
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

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
        houses={houses}
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
          className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
        >
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Update Student" : "Add Student"}
        </Button>
      </DialogFooter>
    </form>
  );


  return (
    <div className="space-y-6">
      {session.isPastSession && (
        // Loud on purpose. Everything on this page now describes a year that
        // has ended — the counts, the class labels, the roll numbers — and an
        // admin who forgets which session is selected will misread all of it.
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/30">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Viewing the {session.session?.name ?? "selected"} session, which
              has ended.
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              Enrolment records for a closed session are read-only, and this
              list includes students who have since left the school. To correct
              a record, use the lock button on its row — an admin and a reason
              are required, and the change is recorded.
            </p>
          </div>
        </div>
      )}

      {session.isFutureSession && (
        // A different state entirely, and it must not read as a warning: this
        // session is being built on purpose, and everything here is editable.
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/40 dark:bg-blue-950/30">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="text-sm">
            <p className="font-semibold text-blue-900 dark:text-blue-200">
              Viewing the {session.session?.name ?? "selected"} session, which
              has not started yet.
            </p>
            <p className="mt-0.5 text-blue-800 dark:text-blue-300">
              This list shows only students already enrolled for next session,
              so it fills up as you assign classes. Records here are fully
              editable.
            </p>
          </div>
        </div>
      )}

      <div className="erp-page-bar">
        <div className="flex items-center gap-3">
          <div className="erp-page-icon">
            <Users className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Students</h1>
            <p className="erp-page-subtitle">Manage student records and enrollments</p>
          </div>
        </div>
        <div className="erp-page-actions">
          <AcademicSessionPicker state={session} />
          <TableExportButton
            ctl={table}
            filename="students"
            title="Students"
            featureKey="students"
            extraColumns={studentExportColumns<StudentRow>()}
            selected={visibleStudents.filter((s) => selectedIds.has(s.id))}
            session={{
              options: session.sessions.map((y) => ({
                id: y.id,
                name: y.name,
                isCurrent: y.is_current,
              })),
              value: session.sessionId,
            }}
            serverRoute="/api/export/students"
            // Student rows carry names, addresses and parent phone numbers.
            // Every download of them is generated server-side so it can be
            // logged and so contact fields can be withheld from non-admins —
            // an audit log with client-side holes reads as complete when it
            // is not.
            alwaysServer
            // The tab, class picker and search box filter these rows before
            // the table ever sees them, so the file has to be told about them
            // or it would claim a wider set than it holds.
            context={[
              {
                label: "Tab",
                value:
                  STUDENT_TABS.find((t) => t.key === activeTab)?.label ?? "All",
              },
              ...(selectedClassId
                ? [
                    {
                      label: "Class",
                      value:
                        classes.find((c) => c.id === selectedClassId)
                          ? classLabel(
                              classes.find((c) => c.id === selectedClassId)!
                            )
                          : "Selected class",
                    },
                  ]
                : []),
              ...(deferredSearch.trim()
                ? [{ label: "Search", value: deferredSearch.trim() }]
                : []),
            ]}
          />
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
              {/* Kept alongside the general export: these columns are the
                  bulk-upload template's own headers, so this file can be
                  fixed in Excel and re-uploaded. The Export dialog is for
                  reading, this is for round-tripping. */}
              <DropdownMenuItem
                disabled={visibleStudents.length === 0 || buildingReuploadCsv}
                onClick={handleDownloadReuploadTemplate}
              >
                {buildingReuploadCsv ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download re-upload template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Excel
              </DropdownMenuItem>
              {/* Alumni now live in their own tab; this is a shortcut to it.
                  Admin-only, matching the admin-only revert endpoint. */}
              {isAdmin && (
                <DropdownMenuItem onClick={() => setStatusTab("alumni")}>
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Manage Alumni
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={openAddDialog}
            className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900 shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Student
          </Button>
        </div>
      </div>

      <div className="erp-table-container p-4 sm:p-6">
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
              className="pl-10 h-10 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900 dark:focus:border-gold-500 dark:focus:ring-gold-500/20"
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
              className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
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

        <Tabs
          value={activeTab}
          onValueChange={(v: unknown) => v && setStatusTab(String(v))}
          className="mb-3"
        >
          <TabsList variant="line">
            {STUDENT_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {t.key === "alumni"
                    ? alumniLoading
                      ? "…"
                      : alumniRows.length
                    : (tabCounts[t.key] ?? 0)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {activeTab === "alumni" ? (
          renderAlumniList()
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              No students in {STUDENT_TABS.find((t) => t.key === activeTab)?.label}.
            </p>
            {/* Without this, tabs turn "I searched and got nothing" into a
                daily complaint — the match is usually one tab over. */}
            {searchFiltered.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => setStatusTab("all")}
              >
                {searchFiltered.length} match
                {searchFiltered.length === 1 ? "es" : ""} in other statuses — view All
              </Button>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Upload an Excel file or add students individually.
              </p>
            )}
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
                        aria-label={`Select all ${visibleStudents.length} filtered students`}
                        title={`Select all ${visibleStudents.length} filtered students (not just this page)`}
                      />
                    </TableHead>
                    <SortFilterHead ctl={table} col="admission_no" />
                    <SortFilterHead ctl={table} col="full_name" />
                    {!selectedClassId && <SortFilterHead ctl={table} col="class" />}
                    {selectedClassId && <SortFilterHead ctl={table} col="roll_number" />}
                    <SortFilterHead ctl={table} col="father_name" />
                    <SortFilterHead ctl={table} col="gender" />
                    <SortFilterHead ctl={table} col="transport" />
                    <SortFilterHead ctl={table} col="status" />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStudents.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-10 text-center text-gray-500 dark:text-gray-400"
                      >
                        No students match the column filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {pagedStudents.map((student) => (
                    <StudentTableRow
                      key={student.id}
                      student={student}
                      selected={selectedIds.has(student.id)}
                      showClassColumn={!selectedClassId}
                      isAdmin={!!isAdmin}
                      sessionClosed={session.isPastSession}
                      unlocked={unlockedIds.has(student.id)}
                      actions={rowActions}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
                <p className="text-gray-500 dark:text-gray-400">
                  Showing{" "}
                  <strong className="text-gray-700 dark:text-gray-200">
                    {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, visibleStudents.length)}
                  </strong>{" "}
                  of {visibleStudents.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Page {safePage} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage >= pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Student Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <GraduationCap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <DialogTitle>Add New Student</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Enroll a new student into the system</p>
              </div>
            </div>
          </DialogHeader>
          {addDialogOpen && renderStudentForm(handleAddStudent, false)}
        </DialogContent>
      </Dialog>

      {/* Edit Student Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                <Pencil className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <DialogTitle>Edit Student</DialogTitle>
                <p className="text-xs text-gray-500 mt-0.5">Update student information</p>
              </div>
            </div>
          </DialogHeader>
          {editDialogOpen &&
            (editLoading ? (
              // The full record is on its way. Rendering the form now would
              // show the reader ~40 empty fields and then swap their values in
              // underneath them.
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
              </div>
            ) : (
              renderStudentForm(handleEditStudent, true)
            ))}
        </DialogContent>
      </Dialog>

      {/* Student Detail Dialog (read-only quick peek) */}
      <Dialog
        open={!!detailStudent}
        onOpenChange={(open) => {
          if (!open) {
            setDetailStudent(null);
            detailLoadRef.current = null;
            setDetailLoad("ready");
          }
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

              <div className="space-y-5 max-h-[55dvh] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
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
                    {detailStudent.status_reason && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {detailStudent.status_reason}
                        {detailStudent.status_changed_at && (
                          <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                            {new Date(detailStudent.status_changed_at).toLocaleDateString(
                              "en-IN",
                              { day: "2-digit", month: "short", year: "numeric" }
                            )}
                          </span>
                        )}
                      </p>
                    )}
                  </DetailField>
                </div>
                {/* The profile sections and the call buttons read the whole
                    template registry, which the list payload does not carry —
                    they wait on the per-student fetch rather than rendering a
                    dozen fields as if that were the whole record. */}
                {detailLoad === "loading" ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                  </div>
                ) : detailLoad === "error" ? (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-3 text-sm text-amber-800 dark:text-amber-300">
                    This student&apos;s full profile could not be loaded, so the
                    details below are not shown. Close and reopen to retry.
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <DialogFooter>
                {/* This dialog stays the quick peek; the full per-session
                    record lives on its own route. */}
                <Button
                  variant="outline"
                  onClick={() =>
                    detailStudent &&
                    router.push(`/people/students/${detailStudent.id}`)
                  }
                >
                  <History className="h-4 w-4 mr-2" />
                  Full profile &amp; history
                </Button>
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
                      detailLoadRef.current = null;
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
                    detailLoadRef.current = null;
                    openEditDialog(s);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  onClick={() => setDetailStudent(null)}
                  className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
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
                    <UserPlus className="h-5 w-5 text-violet-600 dark:text-violet-400" />
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
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
                <ArrowUpCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
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

              {/* statusCounts is computed over the FULL loaded list, never the
                  visible page — a count taken from a filtered view would
                  under-report and wrongly enable promotion. */}
              {(statusCounts.active || 0) > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-400">
                  <strong>{statusCounts.active}</strong> student(s) still have &quot;active&quot; status.
                  Please mark all students as passed/failed/terminated/exited before promoting.
                  <button
                    type="button"
                    className="ml-1 underline underline-offset-2 font-medium"
                    onClick={() => {
                      setPromoteDialogOpen(false);
                      setStatusTab("active");
                    }}
                  >
                    Show them
                  </button>
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
                  className="bg-navy-900 hover:bg-navy-800 text-white dark:bg-gold-500 dark:hover:bg-gold-400 dark:text-navy-900"
                >
                  {promoting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Promote Students
                </Button>
              </DialogFooter>
            </div>
          )}
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

      {/* Terminated / Exited reason capture (single + bulk) */}
      <ExitDateDialog
        request={exitDateRequest}
        onOpenChange={(open) => {
          if (!open) setExitDateRequest(null);
        }}
        onConfirm={handleExitDateConfirm}
      />

      <StatusChangeDialog
        request={statusRequest}
        onOpenChange={(open) => {
          if (!open) setStatusRequest(null);
        }}
        onConfirm={handleStatusReasonConfirm}
      />

      {/* Bulk Upload Dialog */}
      {showStudentBulkUpload && (
      <StudentBulkUpload
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onSuccess={fetchStudents}
      />
      )}

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

      {/* Unlock a closed session's record for correction */}
      <Dialog
        open={!!unlockTarget}
        onOpenChange={(open) => {
          if (!open) {
            setUnlockTarget(null);
            setUnlockReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct a closed session</DialogTitle>
            <DialogDescription>
              {unlockTarget?.full_name} &middot;{" "}
              {session.session?.name ?? "past session"}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-gray-600 dark:text-gray-300">
            This record belongs to a session that has ended. Changing it is
            recorded permanently against your name, along with the reason you
            give here, so write what a colleague reading it next year would need
            to know.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="unlock-reason">Reason</Label>
            <Textarea
              id="unlock-reason"
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              rows={3}
              placeholder="e.g. Admitted to XI-B, not XI-A — original admission register confirms B."
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {unlockReason.trim().length < MIN_CORRECTION_REASON
                ? `${MIN_CORRECTION_REASON - unlockReason.trim().length} more character${
                    MIN_CORRECTION_REASON - unlockReason.trim().length === 1 ? "" : "s"
                  } needed.`
                : "The server records this exactly as written."}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUnlockTarget(null);
                setUnlockReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={unlockReason.trim().length < MIN_CORRECTION_REASON}
              onClick={() => {
                if (!unlockTarget) return;
                const reason = unlockReason.trim();
                setUnlockedIds((prev) => {
                  const next = new Map(prev);
                  next.set(unlockTarget.id, reason);
                  return next;
                });
                const target = unlockTarget;
                setUnlockTarget(null);
                setUnlockReason("");
                // Straight into the edit form: unlocking is a step towards a
                // correction, never an end in itself.
                openEditDialog(target);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <LockOpen className="h-4 w-4 mr-2" />
              Unlock &amp; edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
