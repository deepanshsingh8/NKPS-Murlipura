"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nkps/shared/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Search,
  Copy,
  UserPlus,
  ShieldCheck,
  Users,
  CheckCircle2,
  XCircle,
  KeyRound,
} from "lucide-react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import type { Profile, UserRole, RegistrationRequest, RegistrationStatus } from "@nkps/shared/types";
import { EditorPermissionsDialog } from "@/components/EditorPermissionsDialog";

const ROLES: UserRole[] = ["admin", "staff", "teacher", "student", "parent"];

const roleBadgeColors: Record<UserRole, string> = {
  admin: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  staff: "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400",
  teacher: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  student: "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  parent: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
};

const regStatusBadgeColors: Record<RegistrationStatus, string> = {
  pending: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  approved: "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  rejected: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
};

const regRoleBadgeColors: Record<string, string> = {
  teacher: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  student: "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  parent: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
};

export default function AdminUsersPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "registrations" ? "registrations" : "all";

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState(initialTab);

  // Form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("student");
  const [password, setPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Registration state
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [regSearch, setRegSearch] = useState("");
  const [regSubTab, setRegSubTab] = useState("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Approve success dialog
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approvePassword, setApprovePassword] = useState<string | null>(null);
  const [approvedName, setApprovedName] = useState("");

  // Editor permissions dialog
  const [permsDialogOpen, setPermsDialogOpen] = useState(false);
  const [permsTargetId, setPermsTargetId] = useState<string | null>(null);
  const [permsTargetName, setPermsTargetName] = useState("");

  const supabase = createClient();

  const fetchProfiles = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch users");
      return;
    }

    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  };

  const fetchRequests = async () => {
    try {
      const res = await adminFetch("/api/registrations");
      const data = await res.json();
      if (res.ok) {
        setRequests(data.data ?? []);
      }
    } catch {
      toast.error("Failed to fetch registrations");
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredProfiles = profiles.filter((p) => {
    const matchesTab =
      activeTab === "all" || activeTab === "registrations" || p.role === activeTab;
    const matchesSearch =
      !search ||
      p.full_name.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const regCounts = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  const filteredRequests = requests.filter((r) => {
    const matchesTab = regSubTab === "all" || r.status === regSubTab;
    const matchesSearch =
      !regSearch ||
      r.full_name.toLowerCase().includes(regSearch.toLowerCase()) ||
      r.email.toLowerCase().includes(regSearch.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setPhone("");
    setRole("student");
    setPassword("");
    setGeneratedPassword(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone: phone || undefined,
          role,
          password: password || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to create user");
        setSubmitting(false);
        return;
      }

      toast.success("User created successfully");
      if (data.email_warning) {
        toast.warning(data.email_warning, { duration: 10000 });
        // Email delivery failed — show password so admin can share manually.
        setGeneratedPassword(data.generated_password ?? null);
      } else {
        toast.success("Login details sent to the user via email");
      }
      // L16 — surface the auto-created staff_members default so the admin
      // remembers to recategorize ('tgt' / '—' is rarely the right slot).
      if (data.staff_notice) {
        toast.info(data.staff_notice, { duration: 12000 });
      }
      await fetchProfiles();
    } catch {
      toast.error("Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (profile: Profile, newRole: UserRole) => {
    if (newRole === profile.role) return;

    try {
      const res = await adminFetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profile.id, role: newRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to update role");
        return;
      }

      toast.success(`Role changed to ${newRole}`);
      await fetchProfiles();
    } catch {
      toast.error("Failed to update role");
    }
  };

  const handleDeactivate = async (profile: Profile) => {
    const newStatus = !profile.is_active;
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: newStatus })
      .eq("id", profile.id);

    if (error) {
      toast.error("Failed to update user status");
      return;
    }

    toast.success(
      newStatus ? "User activated" : "User deactivated"
    );
    await fetchProfiles();
  };

  const handleDelete = async (profile: Profile) => {
    if (!confirm(`Delete ${profile.full_name}? This removes their login and all profile data. This cannot be undone.`)) return;

    try {
      const res = await adminFetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profile.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to delete user");
        return;
      }

      toast.success("User deleted");
      await fetchProfiles();
    } catch {
      toast.error("Failed to delete user");
    }
  };

  // Registration handlers
  const handleApprove = async (id: string, name: string) => {
    setProcessingId(id);
    try {
      const res = await adminFetch("/api/registrations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to approve registration");
        return;
      }

      setApprovedName(name);
      if (data.email_delivered === false && data.generated_password) {
        // Fallback path — email failed, surface password so admin can share manually.
        toast.warning("Registration approved, but sending the welcome email failed. Share the password below with the user.", { duration: 10000 });
        setApprovePassword(data.generated_password);
        setApproveDialogOpen(true);
      } else {
        toast.success("Registration approved — login details sent via email");
      }
      await fetchRequests();
      await fetchProfiles();
    } catch {
      toast.error("Failed to approve registration");
    } finally {
      setProcessingId(null);
    }
  };

  const openRejectDialog = (id: string) => {
    setRejectTargetId(id);
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectTargetId) return;
    setProcessingId(rejectTargetId);
    setRejectDialogOpen(false);

    try {
      const res = await adminFetch("/api/registrations/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rejectTargetId, reason: rejectReason || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to reject registration");
        return;
      }

      toast.success("Registration rejected");
      await fetchRequests();
    } catch {
      toast.error("Failed to reject registration");
    } finally {
      setProcessingId(null);
      setRejectTargetId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-navy-900 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-gold-400" />
          </div>
          <div>
            <h1 className="erp-page-title">Users</h1>
            <p className="erp-page-subtitle">Manage accounts and registration requests</p>
          </div>
        </div>
        {activeTab !== "registrations" && (
          <Button
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
            className="bg-navy-900 hover:bg-navy-800 text-white shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        )}
      </div>

      <div className="erp-table-container p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="mb-6">
            <TabsTrigger value="all">
              All ({profiles.length})
            </TabsTrigger>
            <TabsTrigger value="admin">
              Admins ({profiles.filter((p) => p.role === "admin").length})
            </TabsTrigger>
            <TabsTrigger value="staff">
              Staff ({profiles.filter((p) => p.role === "staff").length})
            </TabsTrigger>
            <TabsTrigger value="teacher">
              Teachers ({profiles.filter((p) => p.role === "teacher").length})
            </TabsTrigger>
            <TabsTrigger value="student">
              Students ({profiles.filter((p) => p.role === "student").length})
            </TabsTrigger>
            <TabsTrigger value="parent">
              Parents ({profiles.filter((p) => p.role === "parent").length})
            </TabsTrigger>
            <TabsTrigger value="registrations">
              Registrations
              {regCounts.pending > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-5 px-1.5">
                  {regCounts.pending}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* User tabs */}
          {["all", "admin", "staff", "teacher", "student", "parent"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <Input
                    placeholder="Search by name or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 h-10 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900/20"
                  />
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                </div>
              ) : filteredProfiles.length === 0 ? (
                <p className="text-center py-12 text-gray-500 dark:text-gray-400">
                  No users found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProfiles.map((profile) => (
                      <TableRow key={profile.id}>
                        <TableCell className="font-medium">
                          {profile.full_name}
                        </TableCell>
                        <TableCell className="text-gray-600 dark:text-gray-300">
                          {profile.email}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={profile.role}
                            onValueChange={(val) => val && handleRoleChange(profile, val as UserRole)}
                          >
                            <SelectTrigger className="h-7 w-28 border-0 bg-transparent p-0 shadow-none focus:ring-0">
                              <Badge
                                variant="secondary"
                                className={`${roleBadgeColors[profile.role]} cursor-pointer`}
                              >
                                {profile.role}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              profile.is_active
                                ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                                : "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400"
                            }
                          >
                            {profile.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">
                          {new Date(profile.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(profile.role === "staff" || profile.role === "teacher") && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPermsTargetId(profile.id);
                                  setPermsTargetName(profile.full_name);
                                  setPermsDialogOpen(true);
                                }}
                              >
                                <KeyRound className="h-4 w-4 mr-1" />
                                Permissions
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeactivate(profile)}
                            >
                              {profile.is_active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleDelete(profile)}
                              aria-label="Delete user"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          ))}

          {/* Registrations tab */}
          <TabsContent value="registrations">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                <Input
                  placeholder="Search by name or email..."
                  value={regSearch}
                  onChange={(e) => setRegSearch(e.target.value)}
                  className="pl-10 h-10 border-gray-200 dark:border-border focus:border-navy-900 focus:ring-navy-900/20"
                />
              </div>
            </div>

            <Tabs value={regSubTab} onValueChange={setRegSubTab}>
              <TabsList variant="line" className="mb-4">
                <TabsTrigger value="pending">
                  Pending ({regCounts.pending})
                </TabsTrigger>
                <TabsTrigger value="approved">
                  Approved ({regCounts.approved})
                </TabsTrigger>
                <TabsTrigger value="rejected">
                  Rejected ({regCounts.rejected})
                </TabsTrigger>
                <TabsTrigger value="all">
                  All ({regCounts.all})
                </TabsTrigger>
              </TabsList>

              {["pending", "approved", "rejected", "all"].map((tab) => (
                <TabsContent key={tab} value={tab}>
                  {regLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                    </div>
                  ) : filteredRequests.length === 0 ? (
                    <p className="text-center py-12 text-gray-500 dark:text-gray-400">
                      No {tab === "all" ? "" : tab} registration requests found.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRequests.map((req) => (
                          <TableRow key={req.id}>
                            <TableCell className="font-medium">
                              {req.full_name}
                            </TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {req.email}
                            </TableCell>
                            <TableCell className="text-gray-500 dark:text-gray-400">
                              {req.phone || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={regRoleBadgeColors[req.role]}>
                                {req.role}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={regStatusBadgeColors[req.status]}>
                                {req.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-gray-500 dark:text-gray-400">
                              {new Date(req.created_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {req.status === "pending" ? (
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => handleApprove(req.id, req.full_name)}
                                    disabled={processingId === req.id}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {processingId === req.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-4 w-4 mr-1" />
                                        Approve
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openRejectDialog(req.id)}
                                    disabled={processingId === req.id}
                                    className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
                                  >
                                    <XCircle className="h-4 w-4 mr-1" />
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">
                                  {req.reviewed_at
                                    ? new Date(req.reviewed_at).toLocaleDateString()
                                    : ""}
                                  {req.status === "rejected" && req.rejection_reason && (
                                    <span
                                      className="block text-red-400 mt-0.5 max-w-48 truncate"
                                      title={req.rejection_reason}
                                    >
                                      Reason: {req.rejection_reason}
                                    </span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          {generatedPassword ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <DialogTitle>User Created Successfully</DialogTitle>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Save the temporary password below</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 p-4">
                  <code className="flex-1 text-sm font-mono font-semibold text-navy-900 dark:text-white">
                    {generatedPassword}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedPassword);
                      toast.success("Password copied");
                    }}
                    aria-label="Copy password"
                    className="text-amber-700 hover:bg-amber-100"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  The user will be asked to set their own password on first login.
                </p>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      resetForm();
                      setDialogOpen(false);
                    }}
                    className="bg-navy-900 hover:bg-navy-800 text-white"
                  >
                    Done
                  </Button>
                </DialogFooter>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-navy-900 flex items-center justify-center">
                    <UserPlus className="h-5 w-5 text-gold-400" />
                  </div>
                  <div>
                    <DialogTitle>Add New User</DialogTitle>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Create a new account for the ERP portal</p>
                  </div>
                </div>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="erp-form-group">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter full name"
                      required
                      className="h-10"
                    />
                  </div>
                  <div className="erp-form-group">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="user@example.com"
                      required
                      className="h-10"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="erp-form-group">
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Phone number"
                      className="h-10"
                    />
                  </div>
                  <div className="erp-form-group">
                    <Label>Role</Label>
                    <Select value={role} onValueChange={(val) => val && setRole(val as UserRole)}>
                      <SelectTrigger className="w-full h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="erp-form-group">
                  <Label htmlFor="password">
                    Password (leave blank to auto-generate)
                  </Label>
                  <Input
                    id="password"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="h-10"
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-navy-900 hover:bg-navy-800 text-white"
                  >
                    {submitting && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Create User
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Optionally provide a reason for rejecting this registration. The applicant will be notified via email.
            </p>
            <Input
              placeholder="Reason for rejection (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="h-10"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleReject}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Reject Registration
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Editor Permissions Dialog */}
      <EditorPermissionsDialog
        open={permsDialogOpen}
        onOpenChange={(open) => {
          setPermsDialogOpen(open);
          if (!open) {
            setPermsTargetId(null);
            setPermsTargetName("");
          }
        }}
        editorId={permsTargetId}
        editorName={permsTargetName}
      />

      {/* Approve Success Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <DialogTitle>Registration Approved</DialogTitle>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Account created for {approvedName}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              A welcome email with login credentials has been sent. The temporary password is also shown below for your reference:
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 p-4">
              <code className="flex-1 text-sm font-mono font-semibold text-navy-900 dark:text-white">
                {approvePassword}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (approvePassword) {
                    navigator.clipboard.writeText(approvePassword);
                    toast.success("Password copied");
                  }
                }}
                aria-label="Copy password"
                className="text-amber-700 hover:bg-amber-100"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              The user will be asked to set their own password on first login.
            </p>
            <DialogFooter>
              <Button
                onClick={() => {
                  setApproveDialogOpen(false);
                  setApprovePassword(null);
                }}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
