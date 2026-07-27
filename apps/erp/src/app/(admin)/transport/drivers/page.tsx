"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@nkps/shared/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { toast } from "sonner";
import { Loader2, Info, Bus as BusIcon } from "lucide-react";
import type { Bus } from "@nkps/shared/types";

interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  license_number: string | null;
  bus_number: string | null;
  student_count: number | null;
}

// Slim shapes for the read-only queries below.
interface DriverRecord {
  id: string;
  name: string;
  phone: string | null;
  license_number: string | null;
}

type BusRecord = Pick<Bus, "id" | "bus_number" | "driver_id" | "is_active">;

interface EnrollmentBusRow {
  bus_id: string | null;
}

export default function TransportDriversPage() {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      // Resolve the current academic year so per-bus counts only reflect
      // this year's active enrollments (not inflated by prior-year rows).
      const { data: yearRow } = await supabase
        .from("academic_years")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();
      const currentYearId = (yearRow as { id: string } | null)?.id ?? null;

      let enrollmentQuery = supabase
        .from("student_enrollments")
        .select("bus_id")
        .eq("has_transport", true)
        .eq("status", "active");
      if (currentYearId) {
        enrollmentQuery = enrollmentQuery.eq("academic_year_id", currentYearId);
      }

      const [driversRes, busesRes, enrollmentsRes] = await Promise.all([
        supabase
          .from("staff_members")
          .select("id, name, phone, license_number")
          .eq("category", "busDriver")
          .order("name", { ascending: true }),
        supabase
          .from("buses")
          .select("id, bus_number, driver_id, is_active"),
        enrollmentQuery,
      ]);

      if (driversRes.error || busesRes.error || enrollmentsRes.error) {
        toast.error("Failed to load drivers roster");
        setLoading(false);
        return;
      }

      const drivers = (driversRes.data as DriverRecord[]) ?? [];
      const buses = (busesRes.data as BusRecord[]) ?? [];
      const enrollments = (enrollmentsRes.data as EnrollmentBusRow[]) ?? [];

      // Count students on transport per bus.
      const countByBus = new Map<string, number>();
      enrollments.forEach((e) => {
        if (e.bus_id) {
          countByBus.set(e.bus_id, (countByBus.get(e.bus_id) ?? 0) + 1);
        }
      });

      // Map each driver to their assigned bus (first active match, else any).
      const busByDriver = new Map<string, BusRecord>();
      buses.forEach((bus) => {
        if (!bus.driver_id) return;
        const existing = busByDriver.get(bus.driver_id);
        if (!existing || (bus.is_active && !existing.is_active)) {
          busByDriver.set(bus.driver_id, bus);
        }
      });

      const driverRows: DriverRow[] = drivers.map((driver) => {
        const bus = busByDriver.get(driver.id);
        return {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          license_number: driver.license_number,
          bus_number: bus?.bus_number ?? null,
          student_count: bus ? countByBus.get(bus.id) ?? 0 : null,
        };
      });

      setRows(driverRows);
      setLoading(false);
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Drivers
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Roster of bus drivers and their assigned vehicles.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-xs text-blue-800 dark:text-blue-300">
          Drivers are created under{" "}
          <Link
            href="/people/staff"
            className="font-medium underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
          >
            People → Staff
          </Link>{" "}
          (category: Bus Driver). Assign a driver to a bus on the{" "}
          <Link
            href="/transport/buses"
            className="font-medium underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200"
          >
            Buses & Routes
          </Link>{" "}
          page.
        </p>
      </div>

      <div className="erp-table-container p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center py-12 text-gray-500 dark:text-gray-400">
            No bus drivers found. Add staff with category &ldquo;Bus Driver&rdquo;
            under People → Staff.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>License No.</TableHead>
                <TableHead>Assigned Bus</TableHead>
                <TableHead className="text-right">Students on Bus</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {row.phone || "—"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {row.license_number || "—"}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-300">
                    {row.bus_number ? (
                      <span className="inline-flex items-center gap-1.5">
                        <BusIcon className="h-4 w-4 text-gray-400" />
                        {row.bus_number}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right text-gray-600 dark:text-gray-300">
                    {row.student_count ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
