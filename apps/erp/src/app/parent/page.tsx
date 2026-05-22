"use client";

import { useEffect, useState } from "react";
import { createClient } from "@nkps/shared/lib/supabase/client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Badge } from "@nkps/shared/components/ui/badge";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nkps/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nkps/shared/components/ui/dialog";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import {
  ClipboardCheck,
  BarChart3,
  CreditCard,
  CalendarDays,
  ArrowRight,
  Users,
  GraduationCap,
  Plus,
  Loader2,
  UserPlus,
} from "lucide-react";
import { cn } from "@nkps/shared/lib/utils";
import { UpcomingEvents } from "@nkps/shared/components/UpcomingEvents";
import { linkChildSchema, type LinkChildData } from "@nkps/shared/lib/validations";
import type { Profile } from "@nkps/shared/types";

interface ChildInfo {
  student_id: string;
  relationship: string;
  is_primary_contact: boolean;
  student: {
    id: string;
    admission_no: string;
    full_name: string;
    photo_url: string | null;
  };
  class_name: string | null;
  section: string | null;
  stream_name: string | null;
  roll_number: number | null;
}

export default function ParentDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linking, setLinking] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<LinkChildData>({
    resolver: zodResolver(linkChildSchema),
  });

  const onLinkChild = async (data: LinkChildData) => {
    setLinking(true);
    try {
      const res = await fetch("/api/parents/link-child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Failed to link child");
        return;
      }

      setChildren((prev) => [...prev, result.child]);
      toast.success(
        `${result.child.student.full_name} has been linked to your account`
      );
      setDialogOpen(false);
      reset();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLinking(false);
    }
  };

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Fetch profile (includes parent_id linking to parents table)
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) setProfile(profileData);

      const parentId = profileData?.parent_id;
      if (!parentId) {
        setLoading(false);
        return;
      }

      // Get children via student_parents
      const { data: studentParents } = await supabase
        .from("student_parents")
        .select(
          "student_id, relationship, is_primary_contact, students(id, admission_no, full_name, photo_url)"
        )
        .eq("parent_id", parentId);

      if (!studentParents || studentParents.length === 0) {
        setLoading(false);
        return;
      }

      // For each child, get enrollment info
      const childInfos: ChildInfo[] = [];
      for (const sp of studentParents) {
        const student = sp.students as unknown as {
          id: string;
          admission_no: string;
          full_name: string;
          photo_url: string | null;
        };
        if (!student) continue;

        const { data: enrollment } = await supabase
          .from("student_enrollments")
          .select("class_id, roll_number, classes(name, section, streams:stream_id(name))")
          .eq("student_id", student.id)
          .limit(1)
          .single();

        const classInfo = enrollment?.classes as unknown as {
          name: string;
          section: string;
          streams?: { name: string } | null;
        } | null;

        childInfos.push({
          student_id: sp.student_id,
          relationship: sp.relationship,
          is_primary_contact: sp.is_primary_contact,
          student,
          class_name: classInfo?.name ?? null,
          section: classInfo?.section ?? null,
          stream_name: classInfo?.streams?.name ?? null,
          roll_number: enrollment?.roll_number ?? null,
        });
      }

      setChildren(childInfos);
      setLoading(false);
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-900/20 border-t-navy-900" />
      </div>
    );
  }

  const rawName = profile?.full_name?.trim();
  const firstName =
    rawName && !rawName.includes("@") ? rawName.split(" ")[0] : "Parent";
  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 17
        ? "Good afternoon"
        : "Good evening";

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">
          {greeting}
        </p>
        <h1 className="erp-page-title">Welcome back, {firstName}!</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here is an overview of your children&apos;s academic progress.
        </p>
      </div>

      {/* Children Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="erp-section-title flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            My Children
          </h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-navy-900 dark:text-white border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted"
                />
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add Child
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Link a Child to Your Account</DialogTitle>
                <DialogDescription>
                  Enter your child&apos;s admission number and date of birth for
                  verification.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit(onLinkChild)} className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="admission_no"
                    className="text-navy-900 dark:text-white font-medium"
                  >
                    Admission Number
                  </Label>
                  <Input
                    id="admission_no"
                    placeholder="e.g. NKPS-2024-0001"
                    {...register("admission_no")}
                    className="h-11 border-gray-200 dark:border-border focus:border-navy-900 dark:focus:border-gold-500 focus:ring-navy-900 dark:focus:ring-gold-500"
                  />
                  {errors.admission_no && (
                    <p className="text-red-500 text-xs">
                      {errors.admission_no.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="date_of_birth"
                    className="text-navy-900 dark:text-white font-medium"
                  >
                    Date of Birth
                  </Label>
                  <Input
                    id="date_of_birth"
                    type="date"
                    {...register("date_of_birth")}
                    className="h-11 border-gray-200 dark:border-border focus:border-navy-900 dark:focus:border-gold-500 focus:ring-navy-900 dark:focus:ring-gold-500"
                  />
                  {errors.date_of_birth && (
                    <p className="text-red-500 text-xs">
                      {errors.date_of_birth.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-navy-900 dark:text-white font-medium">
                    Relationship
                  </Label>
                  <Select
                    onValueChange={(val) =>
                      val &&
                      setValue(
                        "relationship",
                        val as "father" | "mother" | "guardian"
                      )
                    }
                  >
                    <SelectTrigger className="w-full h-11 border-gray-200 dark:border-border focus:border-navy-900 dark:focus:border-gold-500 focus:ring-navy-900 dark:focus:ring-gold-500">
                      <SelectValue placeholder="Select relationship" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="father">Father</SelectItem>
                      <SelectItem value="mother">Mother</SelectItem>
                      <SelectItem value="guardian">Guardian</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.relationship && (
                    <p className="text-red-500 text-xs">
                      {errors.relationship.message}
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={linking}
                    className="bg-navy-900 dark:bg-gold-500 text-white dark:text-navy-900 hover:bg-navy-800 dark:hover:bg-gold-400 font-medium"
                  >
                    {linking ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Link Child
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {children.length === 0 ? (
          <Card className="erp-card">
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center text-gray-400 dark:text-gray-500">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No children linked to your account</p>
                <p className="text-xs text-gray-300 dark:text-gray-500 mt-1">
                  Click &quot;Add Child&quot; above to link your child using
                  their admission number.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {children.map((child) => (
              <Card
                key={child.student_id}
                className="erp-card relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-gold-500/8 to-transparent rounded-bl-full" />
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-navy-900 dark:text-white">
                    <div className="h-10 w-10 rounded-xl bg-navy-900/10 dark:bg-white/10 flex items-center justify-center">
                      <GraduationCap className="h-5 w-5 text-navy-900 dark:text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold">
                        {child.student.full_name}
                      </p>
                      <p className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        {child.class_name && child.section
                          ? `${child.class_name} - ${child.section}${child.stream_name ? ` (${child.stream_name})` : ""}`
                          : "Class not assigned"}
                        {child.roll_number !== null &&
                          ` | Roll No: ${child.roll_number}`}
                      </p>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-4">
                    <Badge className="bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-300 text-xs capitalize">
                      {child.relationship}
                    </Badge>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Admission No: {child.student.admission_no}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Link
                      href={`/parent/attendance?child=${child.student_id}`}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Attendance
                    </Link>
                    <Link
                      href={`/parent/results?child=${child.student_id}`}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 text-xs font-medium hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors"
                    >
                      <BarChart3 className="h-3.5 w-3.5" />
                      Results
                    </Link>
                    <Link
                      href={`/parent/fees?child=${child.student_id}`}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Fees
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="erp-section-title mb-4">Quick Links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              href: "/parent/attendance",
              icon: ClipboardCheck,
              label: "View Attendance",
              color:
                "bg-navy-900 text-white hover:bg-navy-800",
            },
            {
              href: "/parent/results",
              icon: BarChart3,
              label: "View Results",
              color:
                "bg-gold-500 text-navy-900 hover:bg-gold-400",
            },
            {
              href: "/parent/fees",
              icon: CreditCard,
              label: "Check Fees",
              color:
                "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted",
            },
            {
              href: "/parent/calendar",
              icon: CalendarDays,
              label: "Calendar",
              color:
                "bg-white dark:bg-card text-navy-900 dark:text-white border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted",
            },
          ].map(({ href, icon: Icon, label, color }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group",
                color
              )}
            >
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>
      </div>

      {/* Upcoming Events */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          <h2 className="erp-section-title">Upcoming Events</h2>
        </div>
        <UpcomingEvents limit={5} />
      </div>
    </div>
  );
}
