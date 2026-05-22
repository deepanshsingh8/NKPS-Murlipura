"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Upload,
  RotateCcw,
  Loader2,
  Check,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  ImageIcon,
  Lock,
} from "lucide-react";
import { adminFetch, adminDelete, adminPatch } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { Button } from "@nkps/shared/components/ui/button";
import { Input } from "@nkps/shared/components/ui/input";
import { Label } from "@nkps/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@nkps/shared/components/ui/dialog";
import { Badge } from "@nkps/shared/components/ui/badge";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { ImageCropper } from "@nkps/shared/components/ImageCropper";
import { cn } from "@nkps/shared/lib/utils";
import { toast } from "sonner";
import type { SiteMedia, SectionCard, SectionCardType } from "@nkps/shared/types";

/* ─── Constants ─── */

const PAGE_LABELS: Record<string, string> = {
  home: "Home Page",
  about: "About Page",
  facilities: "Facilities Page",
  "student-life": "Student Life Page",
  global: "Global (Site-wide)",
};

const SECTION_LABELS: Record<string, string> = {
  hero_slider: "Hero Slider",
  facilities_preview: "Facilities Preview",
  stats_counter: "Stats Counter",
  latest_updates: "Latest Updates",
  activities: "Activities",
  leadership: "Leadership",
  founder_tribute: "Founder Tribute",
  hero: "Hero Section",
  branding: "Branding",
  campus_facilities: "Campus Facilities",
  testimonials: "Testimonials",
};

// Sections that support dynamic cards
const CARD_ENABLED_SECTIONS: SectionCardType[] = [
  "hero_slider",
  "testimonials",
  "latest_updates",
  "facilities_preview",
  "leadership",
  "legacy_timeline",
  "why_choose_us",
  "activities",
  "annual_events",
  "campus_facilities",
];

const SECTION_FIELD_MAP: Record<SectionCardType, { required: string[]; optional: string[] }> = {
  hero_slider: {
    required: ["title", "subtitle"],
    optional: ["cta_text", "cta_link"],
  },
  testimonials: {
    required: ["quote", "name", "role"],
    optional: [],
  },
  latest_updates: {
    required: ["title", "description", "date"],
    optional: ["link"],
  },
  facilities_preview: {
    required: ["title", "description"],
    optional: ["icon"],
  },
  leadership: {
    required: ["name", "designation"],
    optional: ["message"],
  },
  legacy_timeline: {
    required: ["year", "title", "description"],
    optional: [],
  },
  why_choose_us: {
    required: ["title", "description"],
    optional: ["icon"],
  },
  activities: {
    required: ["title", "description"],
    optional: ["icon"],
  },
  annual_events: {
    required: ["title", "description"],
    optional: ["season"],
  },
  campus_facilities: {
    required: ["title", "description"],
    optional: ["icon"],
  },
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  description: "Description",
  quote: "Quote",
  name: "Name",
  role: "Role",
  date: "Date",
  cta_text: "CTA Text",
  cta_link: "CTA Link",
  icon: "Icon",
  link: "Link",
  designation: "Designation",
  message: "Message / Quote",
  year: "Year",
  season: "Season",
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  title: "Card title",
  subtitle: "Card subtitle",
  description: "Brief description",
  quote: "Testimonial quote text",
  name: "Person's name",
  role: "e.g., Parent of Class VIII student",
  date: "e.g., March 2026",
  cta_text: "e.g., Learn More",
  cta_link: "e.g., /admissions",
  icon: "e.g., Monitor, FlaskConical, Laptop, BookOpen",
  link: "e.g., /news/article-slug",
  designation: "e.g., Managing Director",
  message: "Inspirational message or quote",
  year: "e.g., 2024",
  season: "e.g., Winter, Spring, Monsoon, Autumn",
};

interface CardForm {
  title: string;
  subtitle: string;
  description: string;
  quote: string;
  name: string;
  role: string;
  date: string;
  cta_text: string;
  cta_link: string;
  icon: string;
  link: string;
  designation: string;
  message: string;
  year: string;
  season: string;
  sort_order: string;
}

const emptyForm: CardForm = {
  title: "",
  subtitle: "",
  description: "",
  quote: "",
  name: "",
  role: "",
  date: "",
  cta_text: "",
  cta_link: "",
  icon: "",
  link: "",
  designation: "",
  message: "",
  year: "",
  season: "",
  sort_order: "0",
};

/* ─── Helpers ─── */

interface GroupedMedia {
  page: string;
  sections: {
    section: string;
    items: SiteMedia[];
  }[];
}

// Order sections per page to match on-screen render order. Anything not listed
// falls to the end so unknown sections stay visible without breaking layout.
const SECTION_ORDER: Record<string, string[]> = {
  home: [
    "hero_slider",
    "facilities_preview",
    "stats_counter",
    "latest_updates",
    "testimonials",
  ],
  about: [
    "hero",
    "legacy_timeline",
    "founder_tribute",
    "leadership",
    "why_choose_us",
  ],
  facilities: ["campus_facilities"],
  "student-life": ["activities", "annual_events"],
  global: ["branding"],
};

function sortSections(page: string, sections: string[]): string[] {
  const order = SECTION_ORDER[page] ?? [];
  const rank = (s: string) => {
    const i = order.indexOf(s);
    return i === -1 ? order.length : i;
  };
  return [...sections].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function groupMedia(items: SiteMedia[]): GroupedMedia[] {
  const pageOrder = ["home", "about", "facilities", "student-life", "global"];
  const pageMap = new Map<string, Map<string, SiteMedia[]>>();

  for (const item of items) {
    if (!pageMap.has(item.page)) pageMap.set(item.page, new Map());
    const sectionMap = pageMap.get(item.page)!;
    if (!sectionMap.has(item.section)) sectionMap.set(item.section, []);
    sectionMap.get(item.section)!.push(item);
  }

  return pageOrder
    .filter((p) => pageMap.has(p))
    .map((page) => {
      const sectionMap = pageMap.get(page)!;
      const orderedSections = sortSections(page, Array.from(sectionMap.keys()));
      return {
        page,
        sections: orderedSections.map((section) => ({
          section,
          items: sectionMap.get(section)!,
        })),
      };
    });
}

function getCardPrimaryText(card: SectionCard): string {
  if (card.section === "testimonials") {
    return card.quote ? `"${card.quote.slice(0, 60)}${card.quote.length > 60 ? "..." : ""}"` : "—";
  }
  if (card.section === "leadership") {
    return card.name || "—";
  }
  if (card.section === "legacy_timeline") {
    return card.year ? `${card.year} — ${card.title || ""}` : card.title || "—";
  }
  return card.title || "—";
}

function getCardSecondaryText(card: SectionCard): string {
  switch (card.section) {
    case "hero_slider":
      return card.subtitle || "";
    case "testimonials":
      return card.name ? `— ${card.name}${card.role ? `, ${card.role}` : ""}` : "";
    case "latest_updates":
      return card.date || "";
    case "leadership":
      return card.designation || "";
    case "legacy_timeline":
      return card.description?.slice(0, 60) || "";
    case "annual_events":
      return card.season ? `${card.season} — ${card.description?.slice(0, 50) || ""}` : card.description?.slice(0, 60) || "";
    default:
      return card.description?.slice(0, 60) || "";
  }
}

/* ─── SlotCard (image slots) ─── */

function SlotCard({
  item,
  onUpdated,
}: {
  item: SiteMedia;
  onUpdated: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const isCustomized = item.current_url !== item.default_url;

  const handleFileSelected = (file: File) => {
    const url = URL.createObjectURL(file);
    setCropSrc(url);
  };

  const handleCropDone = (croppedFile: File) => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    handleReplace(croppedFile);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleReplace = async (file: File) => {
    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${item.slot}-${Date.now()}.${fileExt}`;
      const url = await uploadToStorage("site-media", fileName, file);

      const res = await adminFetch("/api/site-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: item.slot, url }),
      });
      if (res.ok) {
        toast.success(`Updated: ${item.label}`);
        onUpdated();
      } else {
        const data = await res.json();
        toast.error(data.error || "Upload failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await adminPatch("/api/site-media", {
        slot: item.slot,
        action: "reset",
      });
      if (res.ok) {
        toast.success(`Reset: ${item.label}`);
        onUpdated();
      } else {
        toast.error("Reset failed");
      }
    } catch {
      toast.error("Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-card rounded-xl border border-gray-200 dark:border-border shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        <div className="w-32 h-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-muted shrink-0 relative">
          <Image
            src={item.current_url}
            alt={item.alt_text || item.label}
            fill
            className="object-cover"
            sizes="128px"
          />
          {isCustomized && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-green-500 border border-white" title="Custom image" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-navy-900 dark:text-white text-sm truncate">
            {item.label}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">{item.slot}</p>

          <div className="flex gap-2 mt-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Replace
            </Button>

            {isCustomized && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={resetting}
                onClick={handleReset}
              >
                {resetting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Reset Default
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Crop dialog for slot images */}
      <Dialog open={!!cropSrc} onOpenChange={(open) => { if (!open) handleCropCancel(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Crop Image — {item.label}</DialogTitle>
          </DialogHeader>
          {cropSrc && (
            <ImageCropper
              imageSrc={cropSrc}
              onCropComplete={handleCropDone}
              onCancel={handleCropCancel}
              fileName={`${item.slot}-${Date.now()}.jpg`}
              cropShape="rect"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── SectionCardItem (inline card in section) ─── */

function SectionCardItem({
  card,
  onEdit,
  onDelete,
  onToggle,
  onResetText,
}: {
  card: SectionCard;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onResetText: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border shadow-sm transition-all",
        card.is_active
          ? "bg-white dark:bg-card border-gray-200 dark:border-border"
          : "bg-gray-50 dark:bg-card/50 border-gray-200 dark:border-border opacity-60"
      )}
    >
      {/* Thumbnail */}
      {card.image_url ? (
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-muted shrink-0 relative">
          <Image src={card.image_url} alt={card.title || "Card"} fill className="object-cover" sizes="48px" />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-muted shrink-0 flex items-center justify-center">
          {card.section === "testimonials" && card.initials ? (
            <span className="text-sm font-semibold text-navy-900 dark:text-white">{card.initials}</span>
          ) : (
            <ImageIcon className="h-4 w-4 text-gray-300" />
          )}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-navy-900 dark:text-white text-xs truncate">
            {getCardPrimaryText(card)}
          </p>
          {card.is_default && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-blue-600 border-blue-200 bg-blue-50">
              Default
            </Badge>
          )}
          {!card.is_active && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-gray-400 border-gray-300">
              Off
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-gray-500 truncate">{getCardSecondaryText(card)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-navy-900" onClick={onToggle} title={card.is_active ? "Deactivate" : "Activate"}>
          <Check className={cn("h-3.5 w-3.5", card.is_active ? "text-green-500" : "text-gray-300")} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-blue-600" onClick={onEdit} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {card.is_default ? (
          <>
            {card.default_snapshot && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-amber-600" onClick={onResetText} title="Reset text to default">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <span
              className="h-7 w-7 inline-flex items-center justify-center text-gray-300 cursor-not-allowed"
              title="Default card — deactivate to hide it"
            >
              <Lock className="h-3.5 w-3.5" />
            </span>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600" onClick={onDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ─── */

export default function AdminSiteMediaPage() {
  const [items, setItems] = useState<SiteMedia[]>([]);
  const [cards, setCards] = useState<SectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(
    new Set(["home"])
  );

  // Card dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<SectionCard | null>(null);
  const [dialogSection, setDialogSection] = useState<SectionCardType>("hero_slider");
  const [file, setFile] = useState<FileList | null>(null);
  const [form, setForm] = useState<CardForm>(emptyForm);

  // Crop state for card dialog image
  const [cardCropSrc, setCardCropSrc] = useState<string | null>(null);
  const [showCardCropper, setShowCardCropper] = useState(false);

  const handleCardFileSelected = (fileList: FileList | File | null) => {
    const f = fileList instanceof FileList ? fileList?.[0] : fileList;
    if (!f) {
      setFile(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setCardCropSrc(url);
    setShowCardCropper(true);
  };

  const handleCardCropDone = (croppedFile: File) => {
    const dt = new DataTransfer();
    dt.items.add(croppedFile);
    setFile(dt.files);
    setShowCardCropper(false);
    if (cardCropSrc) URL.revokeObjectURL(cardCropSrc);
    setCardCropSrc(null);
  };

  const handleCardCropCancel = () => {
    setShowCardCropper(false);
    if (cardCropSrc) URL.revokeObjectURL(cardCropSrc);
    setCardCropSrc(null);
  };

  const fetchMedia = useCallback(async () => {
    try {
      const [mediaRes, cardsRes] = await Promise.all([
        adminFetch("/api/site-media"),
        adminFetch("/api/section-cards"),
      ]);
      const mediaData = await mediaRes.json();
      const cardsData = await cardsRes.json();
      if (mediaRes.ok) setItems(mediaData.data ?? []);
      if (cardsRes.ok) setCards(cardsData.data ?? []);
    } catch {
      toast.error("Failed to load site media");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const togglePage = (page: string) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  /* ─── Card CRUD ─── */

  const resetForm = () => {
    setForm(emptyForm);
    setFile(null);
    setEditing(null);
    setShowCardCropper(false);
    if (cardCropSrc) URL.revokeObjectURL(cardCropSrc);
    setCardCropSrc(null);
  };

  const openAddCard = (section: SectionCardType) => {
    resetForm();
    setDialogSection(section);
    // Pre-fill sort_order to next available
    const sectionCards = cards.filter((c) => c.section === section);
    setForm({ ...emptyForm, sort_order: String(sectionCards.length) });
    setDialogOpen(true);
  };

  const openEditCard = (card: SectionCard) => {
    setEditing(card);
    setDialogSection(card.section);
    setForm({
      title: card.title || "",
      subtitle: card.subtitle || "",
      description: card.description || "",
      quote: card.quote || "",
      name: card.name || "",
      role: card.role || "",
      date: card.date || "",
      cta_text: card.cta_text || "",
      cta_link: card.cta_link || "",
      icon: card.icon || "",
      link: card.link || "",
      designation: card.designation || "",
      message: card.message || "",
      year: card.year || "",
      season: card.season || "",
      sort_order: String(card.sort_order),
    });
    setFile(null);
    setDialogOpen(true);
  };

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fieldMap = SECTION_FIELD_MAP[dialogSection];
    for (const field of fieldMap.required) {
      if (!form[field as keyof CardForm]?.trim()) {
        toast.error(`${FIELD_LABELS[field]} is required`);
        return;
      }
    }

    if (isImageRequired && (!file || file.length === 0)) {
      toast.error("Image is required");
      return;
    }

    setSubmitting(true);

    try {
      // Upload image to storage if provided
      let imageUrl: string | null = null;
      if (file && file.length > 0) {
        const f = file[0];
        const fileExt = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const fileName = `section-cards/${dialogSection}-${Date.now()}.${fileExt}`;
        imageUrl = await uploadToStorage("site-media", fileName, f);
      }

      const allFields = [...fieldMap.required, ...fieldMap.optional, "sort_order"];
      const payload: Record<string, unknown> = { section: dialogSection };
      for (const field of allFields) {
        payload[field] = form[field as keyof CardForm] || "";
      }

      if (editing) {
        const updates: Record<string, unknown> = { ...payload };
        delete updates.section;
        if (imageUrl) updates.image_url = imageUrl;
        const res = await adminFetch("/api/section-cards", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, data: updates }),
        });
        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Update failed");
          return;
        }
        toast.success("Card updated");
      } else {
        if (imageUrl) payload.image_url = imageUrl;
        const res = await adminFetch("/api/section-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Create failed");
          return;
        }
        toast.success("Card created");
      }

      setDialogOpen(false);
      resetForm();
      await fetchMedia();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCard = async (card: SectionCard) => {
    if (card.is_default) {
      toast.error("Default cards can't be deleted. Deactivate to hide it instead.");
      return;
    }
    if (!confirm(`Delete this card? This cannot be undone.`)) return;

    try {
      const res = await adminDelete("/api/section-cards", { id: card.id });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Delete failed");
        return;
      }
      toast.success("Card deleted");
      await fetchMedia();
    } catch {
      toast.error("An unexpected error occurred");
    }
  };

  const handleToggleCard = async (card: SectionCard) => {
    const sendToggle = async (confirmEmpty: boolean) =>
      adminPatch("/api/section-cards", {
        id: card.id,
        data: { is_active: !card.is_active },
        ...(confirmEmpty ? { confirm_empty: true } : {}),
      });

    try {
      let res = await sendToggle(false);

      // The API blocks deactivating the last active card unless we opt in.
      // Surface that to the editor as an explicit confirm so a section
      // doesn't quietly disappear from the public site.
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data?.code === "section_would_be_empty") {
          const sectionLabel = SECTION_LABELS[card.section] || card.section;
          const ok = confirm(
            `This is the last active card in "${sectionLabel}". Deactivating it will leave that section empty on the website. Continue?`
          );
          if (!ok) return;
          res = await sendToggle(true);
        } else {
          toast.error(data?.error || "Failed to update");
          return;
        }
      }

      if (res.ok) {
        toast.success(card.is_active ? "Card deactivated" : "Card activated");
        await fetchMedia();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Failed to update");
      }
    } catch {
      toast.error("An error occurred");
    }
  };

  const handleResetCardText = async (card: SectionCard) => {
    if (!confirm("Reset this card's text to the original default? Image and ordering won't change.")) return;
    try {
      const res = await adminPatch("/api/section-cards", {
        id: card.id,
        action: "reset_to_default",
      });
      if (res.ok) {
        toast.success("Card text reset to default");
        await fetchMedia();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Failed to reset");
      }
    } catch {
      toast.error("An error occurred");
    }
  };

  // Map of which page each card-enabled section belongs to
  const SECTION_PAGE_MAP: Record<string, string> = {
    hero_slider: "home",
    testimonials: "home",
    latest_updates: "home",
    facilities_preview: "home",
    leadership: "about",
    legacy_timeline: "about",
    why_choose_us: "about",
    activities: "student-life",
    annual_events: "student-life",
    campus_facilities: "facilities",
  };

  const grouped = groupMedia(items);

  // Inject virtual sections for card-enabled sections that don't have image slots
  for (const section of CARD_ENABLED_SECTIONS) {
    const page = SECTION_PAGE_MAP[section];
    if (!page) continue;
    let pageGroup = grouped.find((g) => g.page === page);
    if (!pageGroup) {
      pageGroup = { page, sections: [] };
      grouped.push(pageGroup);
    }
    const hasSection = pageGroup.sections.some((s) => s.section === section);
    if (!hasSection) {
      pageGroup.sections.push({ section, items: [] });
    }
  }

  // Re-sort sections after virtual injection so card-only sections land in
  // the right slot of the on-screen render order, not at the end.
  for (const pageGroup of grouped) {
    const ordered = sortSections(pageGroup.page, pageGroup.sections.map((s) => s.section));
    const bySection = new Map(pageGroup.sections.map((s) => [s.section, s]));
    pageGroup.sections = ordered.map((s) => bySection.get(s)!);
  }

  const customizedCount = items.filter(
    (i) => i.current_url !== i.default_url
  ).length;

  const visibleFields = dialogSection
    ? [...SECTION_FIELD_MAP[dialogSection].required, ...SECTION_FIELD_MAP[dialogSection].optional]
    : [];
  // Sections where image is optional
  const imageOptionalSections: SectionCardType[] = ["testimonials", "leadership", "legacy_timeline", "why_choose_us", "annual_events"];
  const isImageRequired = !editing && !imageOptionalSections.includes(dialogSection);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Site Media
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage images and section content across the website.{" "}
            {customizedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-green-600">
                <Check className="h-3.5 w-3.5" />
                {customizedCount} customized
              </span>
            )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-card rounded-xl border border-gray-200 dark:border-border animate-pulse h-28"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">
          <p className="text-lg">No site media slots found.</p>
          <p className="text-sm mt-1">
            Run the seed script to populate image slots.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ page, sections }) => {
            const isExpanded = expandedPages.has(page);
            const pageCustomized = sections
              .flatMap((s) => s.items)
              .filter((i) => i.current_url !== i.default_url).length;

            return (
              <div
                key={page}
                className="border border-gray-200 dark:border-border rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => togglePage(page)}
                  className="w-full flex items-center justify-between p-5 bg-gray-50 dark:bg-muted hover:bg-gray-100 dark:hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <h2 className="font-heading text-lg font-semibold text-navy-900 dark:text-white">
                      {PAGE_LABELS[page] || page}
                    </h2>
                    {pageCustomized > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        {pageCustomized} customized
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 text-gray-400 dark:text-gray-500 transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                  />
                </button>

                {isExpanded && (
                  <div className="p-5 space-y-6">
                    {sections.map(({ section, items: sectionItems }) => {
                      const isCardEnabled = CARD_ENABLED_SECTIONS.includes(section as SectionCardType);
                      const sectionCards = isCardEnabled
                        ? cards.filter((c) => c.section === section)
                        : [];

                      return (
                        <div key={section}>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              {SECTION_LABELS[section] || section}
                            </h3>
                            {isCardEnabled && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 gap-1.5"
                                onClick={() => openAddCard(section as SectionCardType)}
                              >
                                <Plus className="h-3 w-3" />
                                Add Card
                              </Button>
                            )}
                          </div>

                          {/* Image slots */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {sectionItems.map((item) => (
                              <SlotCard
                                key={item.id}
                                item={item}
                                onUpdated={fetchMedia}
                              />
                            ))}
                          </div>

                          {/* Section cards (inline) */}
                          {isCardEnabled && sectionCards.length > 0 && (
                            <div className="mt-3 space-y-2">
                              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                                Content Cards ({sectionCards.length})
                              </p>
                              <div className="space-y-1.5">
                                {sectionCards.map((card) => (
                                  <SectionCardItem
                                    key={card.id}
                                    card={card}
                                    onEdit={() => openEditCard(card)}
                                    onDelete={() => handleDeleteCard(card)}
                                    onToggle={() => handleToggleCard(card)}
                                    onResetText={() => handleResetCardText(card)}
                                  />
                                ))}
                              </div>
                              <p className="text-[10px] text-green-600 dark:text-green-400 mt-1">
                                Cards in this section render in <code>sort_order</code>. Default cards can be edited or deactivated; user-added cards can also be deleted.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Add / Edit Card Dialog ─── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } else { setDialogOpen(true); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Card" : "Add Card"} — {SECTION_LABELS[dialogSection] || dialogSection}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCardSubmit} className="space-y-4">
            {/* Image upload */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {dialogSection === "testimonials" ? "Profile Photo (optional)" : "Image"}{" "}
                {isImageRequired && <span className="text-red-500">*</span>}
              </Label>
              {showCardCropper && cardCropSrc ? (
                <ImageCropper
                  imageSrc={cardCropSrc}
                  onCropComplete={handleCardCropDone}
                  onCancel={handleCardCropCancel}
                  fileName={`card-${dialogSection}-${Date.now()}.jpg`}
                  cropShape="rect"
                />
              ) : (
                <>
                  {file && file.length > 0 ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 relative border-2 border-green-400">
                        <Image src={URL.createObjectURL(file[0])} alt="Cropped" fill className="object-cover" sizes="64px" />
                      </div>
                      <div>
                        <p className="text-xs text-green-600 font-medium">Image cropped & ready</p>
                        <button type="button" onClick={() => setFile(null)} className="text-xs text-gray-500 hover:text-red-500 mt-0.5">
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : editing?.image_url ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 relative">
                        <Image src={editing.image_url} alt="Current" fill className="object-cover" sizes="64px" />
                      </div>
                      <span className="text-xs text-gray-500">Current image (upload new to replace)</span>
                    </div>
                  ) : null}
                  <FileDropZone
                    accept="image/*"
                    onChange={handleCardFileSelected}
                    value={null}
                    label={dialogSection === "testimonials" ? "Drop profile photo or click to browse" : "Drop image here or click to browse"}
                    icon="image"
                  />
                </>
              )}
            </div>

            {/* Dynamic fields */}
            {visibleFields.map((field) => {
              const isRequired = SECTION_FIELD_MAP[dialogSection].required.includes(field);
              const isLongText = field === "quote" || field === "description";
              return (
                <div key={field} className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    {FIELD_LABELS[field]} {isRequired && <span className="text-red-500">*</span>}
                  </Label>
                  {isLongText ? (
                    <textarea
                      className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder={FIELD_PLACEHOLDERS[field]}
                      value={form[field as keyof CardForm]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    />
                  ) : (
                    <Input
                      className="h-9"
                      placeholder={FIELD_PLACEHOLDERS[field]}
                      value={form[field as keyof CardForm]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    />
                  )}
                </div>
              );
            })}

            {/* Sort order */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Sort Order</Label>
              <Input
                type="number"
                className="h-9 w-24"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-navy-900 hover:bg-navy-800 text-white"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editing ? "Save Changes" : "Add Card"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
