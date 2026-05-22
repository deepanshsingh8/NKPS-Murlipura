"use client";

import { useState } from "react";
import { Input } from "@nkps/shared/components/ui/input";

const currentCalendarYear = new Date().getFullYear();

// Generate academic years: from 3 years ago to 2 years ahead
const ACADEMIC_YEARS = Array.from({ length: 6 }, (_, i) => {
  const start = currentCalendarYear - 3 + i;
  return `${start}-${String(start + 1).slice(2)}`;
});

interface AcademicYearSelectProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  id?: string;
}

export function AcademicYearSelect({
  value,
  onChange,
  required,
  id,
}: AcademicYearSelectProps) {
  const valueIsCustom = value !== "" && !ACADEMIC_YEARS.includes(value);
  const [userPickedOther, setUserPickedOther] = useState(false);
  const showCustom = valueIsCustom || userPickedOther;

  const handleSelectChange = (selectValue: string) => {
    if (selectValue === "__other__") {
      setUserPickedOther(true);
      onChange("");
    } else {
      setUserPickedOther(false);
      onChange(selectValue);
    }
  };

  if (showCustom) {
    return (
      <div className="flex gap-1.5">
        <Input
          id={id}
          placeholder="e.g. 2026-27"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="h-9 flex-1"
        />
        <button
          type="button"
          onClick={() => {
            setUserPickedOther(false);
            onChange(ACADEMIC_YEARS[ACADEMIC_YEARS.length - 2] ?? "");
          }}
          className="shrink-0 h-9 px-2.5 rounded-lg border border-gray-200 dark:border-border text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-muted transition-colors"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      value={ACADEMIC_YEARS.includes(value) ? value : ""}
      onChange={(e) => handleSelectChange(e.target.value)}
      required={required}
      className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
    >
      <option value="">Select year</option>
      {ACADEMIC_YEARS.map((yr) => (
        <option key={yr} value={yr}>
          {yr}
        </option>
      ))}
      <option value="__other__">Other...</option>
    </select>
  );
}
