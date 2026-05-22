"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Button } from "@nkps/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Loader2, ArrowLeft, GraduationCap, CheckCircle2 } from "lucide-react";
import { getWebsiteUrl } from "@nkps/shared/lib/cross-app";
import { registrationRequestSchema, type RegistrationRequestData } from "@nkps/shared/lib/validations";

export default function PortalRegisterPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>("");

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RegistrationRequestData>({
    resolver: zodResolver(registrationRequestSchema),
  });

  const onSubmit = async (data: RegistrationRequestData) => {
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Failed to submit registration");
        return;
      }

      setSubmitted(true);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen">
      {/* Left Panel — Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 bg-navy-900 relative flex-col items-center justify-center px-12 text-white overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-gold-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 text-center max-w-md">
          {/* School Logo */}
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
            <GraduationCap className="h-12 w-12 text-gold-500" />
          </div>

          <h1 className="font-heading text-4xl font-bold mb-4">
            NK Public School
          </h1>
          <div className="w-16 h-1 bg-gold-500 mx-auto mb-6 rounded-full" />
          <p className="text-lg text-white/70 leading-relaxed">
            Register to join the NKPS Portal. Your account will be reviewed
            by the school administration before activation.
          </p>

          {/* Role indicators */}
          <div className="mt-12 flex flex-col gap-3 text-sm text-white/50">
            <div className="flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              <span>Teachers</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Students</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              <span>Parents</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Registration Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-cream-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile branding */}
          <div className="lg:hidden text-center mb-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-navy-900">
              <GraduationCap className="h-8 w-8 text-gold-500" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-navy-900">
              NK Public School
            </h1>
          </div>

          {submitted ? (
            /* Success State */
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="font-heading text-2xl font-bold text-navy-900 mb-3">
                Registration Submitted!
              </h2>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                Your registration request has been submitted successfully. You
                will receive an email once your account has been reviewed and
                approved by the administration.
              </p>
              <Link
                href="/portal/login"
                className="inline-flex items-center justify-center w-full h-11 bg-navy-900 hover:bg-navy-800 text-white font-medium rounded-lg transition-colors"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
            /* Form Card */
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <div className="mb-8">
                <h2 className="font-heading text-2xl font-bold text-navy-900">
                  Register for Portal
                </h2>
                <p className="text-gray-500 mt-1 text-sm">
                  Submit your details to request access
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="full_name" className="text-navy-900 font-medium">
                    Full Name
                  </Label>
                  <Input
                    id="full_name"
                    placeholder="Enter your full name"
                    {...register("full_name")}
                    className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                  />
                  {errors.full_name && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors.full_name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-navy-900 font-medium">
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    {...register("email")}
                    className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                  />
                  {errors.email && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-navy-900 font-medium">
                    Phone Number{" "}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="phone"
                    placeholder="10-digit phone number"
                    {...register("phone")}
                    className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                  />
                  {errors.phone && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors.phone.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-navy-900 font-medium">Role</Label>
                  <Select onValueChange={(val) => {
                    if (val) {
                      setValue("role", val as "teacher" | "student" | "parent");
                      setSelectedRole(val);
                    }
                  }}>
                    <SelectTrigger className="w-full h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900">
                      <SelectValue placeholder="Select your role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teacher">Teacher</SelectItem>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="parent">Parent</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.role && (
                    <p className="text-red-500 text-xs mt-1">
                      {errors.role.message}
                    </p>
                  )}
                </div>

                {selectedRole === "parent" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="student_admission_no" className="text-navy-900 font-medium">
                        Child&apos;s Admission Number
                      </Label>
                      <Input
                        id="student_admission_no"
                        placeholder="e.g. NKPS-2024-0001"
                        {...register("student_admission_no")}
                        className="h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900"
                      />
                      <p className="text-xs text-gray-400">
                        Enter your child&apos;s admission number for verification
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-navy-900 font-medium">Relationship</Label>
                      <Select onValueChange={(val) => val && setValue("relationship", val as "father" | "mother" | "guardian")}>
                        <SelectTrigger className="w-full h-11 border-gray-200 focus:border-navy-900 focus:ring-navy-900">
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="father">Father</SelectItem>
                          <SelectItem value="mother">Mother</SelectItem>
                          <SelectItem value="guardian">Guardian</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-navy-900 hover:bg-navy-800 text-white font-medium transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Registration"
                  )}
                </Button>
              </form>
            </div>
          )}

          {/* Links */}
          <div className="mt-4 text-center">
            <Link
              href="/portal/login"
              className="text-sm text-gold-600 hover:text-gold-500 font-medium transition-colors"
            >
              Already have an account? Sign in
            </Link>
          </div>
          <div className="mt-3 text-center">
            <Link
              href={getWebsiteUrl("/")}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to website
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
