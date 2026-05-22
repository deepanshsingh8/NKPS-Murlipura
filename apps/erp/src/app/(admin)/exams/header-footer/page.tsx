"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@nkps/shared/lib/admin-api";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import { Checkbox } from "@nkps/shared/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@nkps/shared/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nkps/shared/components/ui/select";
import { Loader2, Save, X, Plus } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "report_card", label: "Report Card", hint: "Student PDF report card" },
  { value: "admit_card", label: "Admit Card", hint: "Exam admit card (Phase 1)" },
  { value: "white_sheet", label: "White Sheet", hint: "Class-wide mark sheet (Phase 5)" },
  { value: "green_sheet", label: "Green Sheet", hint: "Year-wide consolidated sheet (Phase 5)" },
];

interface HeaderForm {
  school_name: string;
  address_line: string;
  affiliation: string;
  affiliation_number: string;
  logo_url: string;
  motto: string;
  is_active: boolean;
}

interface FooterForm {
  disclaimer_text: string;
  show_signatures: boolean;
  signature_labels: string[];
  is_active: boolean;
}

const emptyHeader: HeaderForm = {
  school_name: "",
  address_line: "",
  affiliation: "",
  affiliation_number: "",
  logo_url: "",
  motto: "",
  is_active: true,
};

const emptyFooter: FooterForm = {
  disclaimer_text: "This is a computer-generated document.",
  show_signatures: true,
  signature_labels: ["Class Teacher", "Principal"],
  is_active: true,
};

type ServerHeader = {
  school_name: string;
  address_line: string;
  affiliation: string | null;
  affiliation_number: string | null;
  logo_url: string | null;
  motto: string | null;
  is_active: boolean;
};

type ServerFooter = {
  disclaimer_text: string | null;
  show_signatures: boolean;
  signature_labels: string[];
  is_active: boolean;
};

export default function HeaderFooterPage() {
  const [templateKey, setTemplateKey] = useState("report_card");
  const [header, setHeader] = useState<HeaderForm>(emptyHeader);
  const [footer, setFooter] = useState<FooterForm>(emptyFooter);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadTemplate = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/pdf-templates?template_key=${key}`);
      if (!res.ok) {
        toast.error("Failed to load template");
        return;
      }
      const { data } = (await res.json()) as {
        data: {
          template_key: string;
          header: ServerHeader | null;
          footer: ServerFooter | null;
        };
      };
      setHeader(
        data.header
          ? {
              school_name: data.header.school_name,
              address_line: data.header.address_line,
              affiliation: data.header.affiliation ?? "",
              affiliation_number: data.header.affiliation_number ?? "",
              logo_url: data.header.logo_url ?? "",
              motto: data.header.motto ?? "",
              is_active: data.header.is_active,
            }
          : emptyHeader
      );
      setFooter(
        data.footer
          ? {
              disclaimer_text: data.footer.disclaimer_text ?? "",
              show_signatures: data.footer.show_signatures,
              signature_labels:
                data.footer.signature_labels.length > 0
                  ? data.footer.signature_labels
                  : emptyFooter.signature_labels,
              is_active: data.footer.is_active,
            }
          : emptyFooter
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplate(templateKey);
  }, [templateKey, loadTemplate]);

  const save = async () => {
    if (!header.school_name.trim() || !header.address_line.trim()) {
      toast.error("School name and address are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        template_key: templateKey,
        header: {
          school_name: header.school_name.trim(),
          address_line: header.address_line.trim(),
          affiliation: header.affiliation.trim() || null,
          affiliation_number: header.affiliation_number.trim() || null,
          logo_url: header.logo_url.trim() || null,
          motto: header.motto.trim() || null,
          is_active: header.is_active,
        },
        footer: {
          disclaimer_text: footer.disclaimer_text.trim() || null,
          show_signatures: footer.show_signatures,
          signature_labels: footer.signature_labels
            .map((s) => s.trim())
            .filter(Boolean),
          is_active: footer.is_active,
        },
      };
      const res = await adminFetch("/api/pdf-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        toast.error(body.error ?? "Failed to save template");
        return;
      }
      toast.success("Template saved");
    } finally {
      setSaving(false);
    }
  };

  const updateSigLabel = (i: number, value: string) => {
    setFooter((prev) => ({
      ...prev,
      signature_labels: prev.signature_labels.map((l, idx) =>
        idx === i ? value : l
      ),
    }));
  };
  const addSigLabel = () => {
    setFooter((prev) => ({
      ...prev,
      signature_labels: [...prev.signature_labels, ""],
    }));
  };
  const removeSigLabel = (i: number) => {
    setFooter((prev) => ({
      ...prev,
      signature_labels: prev.signature_labels.filter((_, idx) => idx !== i),
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            PDF Header &amp; Footer
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            School branding, header content, and footer blocks that appear on
            generated PDFs. Changes apply on the next render.
          </p>
        </div>
        <div className="w-64 space-y-1.5">
          <Label className="text-xs font-medium">Template</Label>
          <Select
            value={templateKey}
            items={TEMPLATE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
            onValueChange={(v) => v && setTemplateKey(v)}
          >
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Select template">
                {TEMPLATE_OPTIONS.find((t) => t.value === templateKey)?.label ??
                  null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {TEMPLATE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value} label={t.label}>
                  <div className="flex flex-col">
                    <span>{t.label}</span>
                    <span className="text-[10px] text-gray-500">{t.hint}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-heading">Header</CardTitle>
              <p className="text-xs text-gray-500">
                Appears at the top of every PDF page.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">School Name</Label>
                <Input
                  value={header.school_name}
                  onChange={(e) =>
                    setHeader({ ...header, school_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Address Line</Label>
                <Input
                  value={header.address_line}
                  onChange={(e) =>
                    setHeader({ ...header, address_line: e.target.value })
                  }
                  placeholder="Full address on one line"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Affiliation</Label>
                  <Input
                    value={header.affiliation}
                    onChange={(e) =>
                      setHeader({ ...header, affiliation: e.target.value })
                    }
                    placeholder="e.g. CBSE"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Affiliation No.</Label>
                  <Input
                    value={header.affiliation_number}
                    onChange={(e) =>
                      setHeader({
                        ...header,
                        affiliation_number: e.target.value,
                      })
                    }
                    placeholder="CBSE affiliation number"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Logo URL</Label>
                <Input
                  value={header.logo_url}
                  onChange={(e) =>
                    setHeader({ ...header, logo_url: e.target.value })
                  }
                  placeholder="/images/logo.png or https://..."
                />
                <p className="text-[10px] text-gray-500">
                  Relative paths are served from /public; absolute URLs work
                  too. Report card currently reads the local logo file directly
                  — URL here is reserved for future PDFs.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Motto (optional)</Label>
                <Input
                  value={header.motto}
                  onChange={(e) =>
                    setHeader({ ...header, motto: e.target.value })
                  }
                  placeholder="Optional tagline"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <Checkbox
                  checked={header.is_active}
                  onCheckedChange={(v) =>
                    setHeader({ ...header, is_active: Boolean(v) })
                  }
                />
                Active (apply on next PDF render)
              </label>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-heading">Footer</CardTitle>
              <p className="text-xs text-gray-500">
                Appears at the bottom of every PDF page. &quot;Generated on&quot;
                timestamp is always rendered; additional text and signature
                blocks are configured here.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Disclaimer</Label>
                <Input
                  value={footer.disclaimer_text}
                  onChange={(e) =>
                    setFooter({ ...footer, disclaimer_text: e.target.value })
                  }
                  placeholder="Shown below the generation timestamp"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <Checkbox
                  checked={footer.show_signatures}
                  onCheckedChange={(v) =>
                    setFooter({ ...footer, show_signatures: Boolean(v) })
                  }
                />
                Show signature blocks
              </label>
              {footer.show_signatures && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">
                    Signature labels
                  </Label>
                  <div className="space-y-1.5">
                    {footer.signature_labels.map((label, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={label}
                          onChange={(e) => updateSigLabel(i, e.target.value)}
                          className="h-9"
                          placeholder="e.g. Class Teacher"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSigLabel(i)}
                          aria-label="Remove signature label"
                          className="h-9 w-9 text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSigLabel}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add signature slot
                  </Button>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <Checkbox
                  checked={footer.is_active}
                  onCheckedChange={(v) =>
                    setFooter({ ...footer, is_active: Boolean(v) })
                  }
                />
                Active (apply on next PDF render)
              </label>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={saving || loading}
          className="bg-navy-900 text-white hover:bg-navy-900/90"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Template
        </Button>
      </div>
    </div>
  );
}
