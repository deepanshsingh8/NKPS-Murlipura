"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
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
  Image as LucideImage,
  Upload,
  FolderOpen,
  ImageIcon,
  ChevronRight,
  ChevronLeft,
  X,
  Star,
  Check,
  List as ListIcon,
  LayoutGrid,
  Grid3x3,
} from "lucide-react";
import { adminFetch, adminDelete, adminApi } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { ImageCropper, type Crop } from "@nkps/shared/components/ImageCropper";
import { AcademicYearSelect } from "@nkps/shared/components/AcademicYearSelect";
import { cn } from "@nkps/shared/lib/utils";
import type { GalleryImage, GalleryEvent } from "@nkps/shared/types";

const CATEGORIES = ["academics", "sports", "cultural", "campus", "events"];

type Tab = "images" | "events";
type ViewMode = "list" | "small" | "large";

const VIEW_MODE_STORAGE_KEY = "nkps-gallery-view-mode";

async function applyCropToImage(src: string, percentCrop: Crop, fileName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const x = (percentCrop.x / 100) * img.naturalWidth;
      const y = (percentCrop.y / 100) * img.naturalHeight;
      const w = (percentCrop.width / 100) * img.naturalWidth;
      const h = (percentCrop.height / 100) * img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No canvas context")); return; }
      ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, Math.round(w), Math.round(h));
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("Canvas empty")); return; }
          resolve(new File([blob], fileName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.92
      );
    };
    img.onerror = reject;
    img.src = src;
  });
}

function PhotoStripCarousel({
  photos,
  coverUrl,
  onSetCover,
  onDelete,
}: {
  photos: GalleryImage[];
  coverUrl: string | null;
  onSetCover: (url: string) => void;
  onDelete: (img: GalleryImage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [checkScroll, photos]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -240 : 240, behavior: "smooth" });
  };

  return (
    <div className="relative group/carousel">
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-card shadow-md border border-gray-200 dark:border-border text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-muted transition-colors -ml-2"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-card shadow-md border border-gray-200 dark:border-border text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-muted transition-colors -mr-2"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto overflow-y-visible pt-3 pb-4 px-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {photos.map((img) => {
          const isCover = coverUrl === img.src;
          return (
            <div
              key={img.id}
              className={cn(
                "relative group shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 bg-white dark:bg-card",
                "transition-all duration-300 ease-out will-change-transform",
                "hover:scale-110 hover:-translate-y-1 hover:z-20 hover:shadow-xl hover:shadow-black/20",
                isCover
                  ? "border-gold-500 ring-2 ring-gold-500/30"
                  : "border-gray-200 dark:border-border hover:border-navy-400 dark:hover:border-navy-500"
              )}
            >
              <Image
                src={img.src}
                alt={img.alt}
                fill
                className="object-cover"
                sizes="96px"
              />
              {isCover && (
                <div className="absolute top-1 left-1 bg-gold-500 text-white p-0.5 rounded-full shadow-sm" title="Cover photo">
                  <Star className="h-3 w-3 fill-current" />
                </div>
              )}
              {!isCover && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSetCover(img.src); }}
                  className="absolute top-1 left-1 bg-white/80 dark:bg-black/60 text-gray-600 dark:text-gray-300 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-gold-500 hover:text-white"
                  title="Set as cover photo"
                >
                  <Star className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(img); }}
                className="absolute top-1 right-1 bg-red-500 text-white p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                title="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminGalleryPage() {
  const [tab, setTab] = useState<Tab>("images");

  // ── Images state ──
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [altText, setAltText] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [eventId, setEventId] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);

  // ── Multi-select for bulk delete ──
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ── View mode for images grid ──
  const [viewMode, setViewMode] = useState<ViewMode>("large");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === "list" || saved === "small" || saved === "large") {
      setViewMode(saved);
    }
  }, []);
  const updateViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }
  };

  // ── Events state ──
  const [events, setEvents] = useState<GalleryEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [eventImages, setEventImages] = useState<Record<string, GalleryImage[]>>({});
  const [eventImagesLoading, setEventImagesLoading] = useState<string | null>(null);

  // ── Event upload state ──
  const [eventUploadOpen, setEventUploadOpen] = useState(false);
  const [uploadEventId, setUploadEventId] = useState<string>("");
  const [eventUploadFiles, setEventUploadFiles] = useState<FileList | null>(null);
  const [eventUploading, setEventUploading] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: "",
    event_date: "",
    academic_year: "",
    is_public: true,
  });

  // ── Crop queue state (shared by both upload dialogs) ──
  const [cropQueue, setCropQueue] = useState<string[]>([]); // object URLs to crop
  const [cropIndex, setCropIndex] = useState(0);
  const [croppedFiles, setCroppedFiles] = useState<File[]>([]);
  const [cropTarget, setCropTarget] = useState<"images" | "event" | null>(null);

  const startCropQueue = (fileList: FileList, target: "images" | "event") => {
    const urls: string[] = [];
    for (let i = 0; i < fileList.length; i++) {
      urls.push(URL.createObjectURL(fileList[i]));
    }
    setCropQueue(urls);
    setCropIndex(0);
    setCroppedFiles([]);
    setCropTarget(target);
  };

  const handleCropDone = (croppedFile: File) => {
    const newCropped = [...croppedFiles, croppedFile];
    setCroppedFiles(newCropped);

    // Revoke the URL we just finished with
    URL.revokeObjectURL(cropQueue[cropIndex]);

    if (cropIndex + 1 < cropQueue.length) {
      // Move to next image
      setCropIndex(cropIndex + 1);
    } else {
      // All done — convert to FileList-like and set on the right state
      const dt = new DataTransfer();
      newCropped.forEach((f) => dt.items.add(f));
      if (cropTarget === "images") {
        setFiles(dt.files);
      } else {
        setEventUploadFiles(dt.files);
      }
      // Clean up
      setCropQueue([]);
      setCropIndex(0);
      setCropTarget(null);
    }
  };

  const handleCropSkip = () => {
    // Skip cropping for this image — use original file
    // We need to convert the object URL back... but we don't have the original File.
    // Instead, we'll fetch the blob from the object URL.
    fetch(cropQueue[cropIndex])
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], `image-${cropIndex}.jpg`, { type: blob.type });
        handleCropDone(file);
      });
  };

  const handleCropAll = async (percentCrop: Crop) => {
    const remaining = cropQueue.slice(cropIndex);
    const allCropped = [...croppedFiles];

    for (let i = 0; i < remaining.length; i++) {
      try {
        const file = await applyCropToImage(remaining[i], percentCrop, `image-${cropIndex + i}.jpg`);
        allCropped.push(file);
      } catch {
        const res = await fetch(remaining[i]);
        const blob = await res.blob();
        allCropped.push(new File([blob], `image-${cropIndex + i}.jpg`, { type: blob.type }));
      }
    }

    remaining.forEach((url) => URL.revokeObjectURL(url));

    const dt = new DataTransfer();
    allCropped.forEach((f) => dt.items.add(f));
    if (cropTarget === "images") {
      setFiles(dt.files);
    } else {
      setEventUploadFiles(dt.files);
    }
    setCropQueue([]);
    setCropIndex(0);
    setCropTarget(null);
    toast.success(`Cropped ${remaining.length} image${remaining.length === 1 ? "" : "s"} with the same selection`);
  };

  const handleCropCancelAll = () => {
    cropQueue.forEach((url) => URL.revokeObjectURL(url));
    setCropQueue([]);
    setCropIndex(0);
    setCroppedFiles([]);
    setCropTarget(null);
  };

  const supabase = createClient();

  // ── Fetch images (standalone only — event photos live in the Events tab) ──
  const fetchImages = useCallback(async () => {
    const { data, error } = await supabase
      .from("gallery_images")
      .select("*")
      .is("gallery_event_id", null)
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error("Failed to fetch images");
      setImagesLoading(false);
      return;
    }

    setImages((data as GalleryImage[]) ?? []);
    setImagesLoading(false);
  }, [supabase]);

  // ── Fetch events ──
  const fetchEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("gallery_events")
      .select("*")
      .order("event_date", { ascending: false });

    if (error) {
      toast.error("Failed to fetch gallery events");
      setEventsLoading(false);
      return;
    }

    const eventsData = (data as GalleryEvent[]) ?? [];
    setEvents(eventsData);

    if (eventsData.length > 0) {
      const eventIds = eventsData.map((e) => e.id);
      const { data: imgs } = await supabase
        .from("gallery_images")
        .select("gallery_event_id")
        .in("gallery_event_id", eventIds);

      const counts: Record<string, number> = {};
      (imgs ?? []).forEach((img: { gallery_event_id: string | null }) => {
        if (img.gallery_event_id) {
          counts[img.gallery_event_id] = (counts[img.gallery_event_id] || 0) + 1;
        }
      });
      setImageCounts(counts);
    }

    setEventsLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchImages();
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Image handlers ──
  const handleImageUpload = async () => {
    if (!files || files.length === 0) {
      toast.error("Please select at least one image");
      return;
    }
    if (!altText.trim()) {
      toast.error("Please enter alt text");
      return;
    }

    setUploading(true);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const f = files[i];
        const fileExt = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const fileName = `${Date.now()}-${i}.${fileExt}`;
        const url = await uploadToStorage("gallery", fileName, f);

        const res = await adminFetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            alt: files.length > 1 ? `${altText.trim()} ${i + 1}` : altText.trim(),
            category,
            currentCount: images.length + succeeded,
            gallery_event_id: eventId || null,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          toast.error(`${f.name}: ${data.error || "Upload failed"}`);
          failed++;
        } else {
          succeeded++;
        }
      } catch (err) {
        toast.error(`${files[i].name}: ${err instanceof Error ? err.message : "Upload failed"}`);
        failed++;
      }
    }

    if (succeeded > 0) {
      toast.success(`${succeeded} image(s) uploaded successfully${failed > 0 ? `, ${failed} failed` : ""}`);
    }

    setImageDialogOpen(false);
    setAltText("");
    setCategory(CATEGORIES[0]);
    setEventId("");
    setFiles(null);
    fetchImages();
    setUploading(false);
  };

  const handleImageDelete = async (image: GalleryImage) => {
    if (!confirm(`Delete "${image.alt}"? This cannot be undone.`)) return;

    try {
      const res = await adminDelete("/api/gallery", { id: image.id, src: image.src });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }

      toast.success("Image deleted");
      fetchImages();
    } catch {
      toast.error("An unexpected error occurred");
    }
  };

  // ── Selection helpers ──
  const toggleImageSelection = (id: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllImages = () => {
    if (selectedImageIds.size === images.length) {
      setSelectedImageIds(new Set());
    } else {
      setSelectedImageIds(new Set(images.map((img) => img.id)));
    }
  };

  const clearImageSelection = () => setSelectedImageIds(new Set());

  const handleBulkImageDelete = async () => {
    if (selectedImageIds.size === 0) return;
    const count = selectedImageIds.size;
    if (!confirm(`Delete ${count} image${count === 1 ? "" : "s"}? This cannot be undone.`)) return;

    setBulkDeleting(true);
    try {
      const items = images
        .filter((img) => selectedImageIds.has(img.id))
        .map((img) => ({ id: img.id, src: img.src }));

      const res = await adminDelete("/api/gallery", { items });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Bulk delete failed");
        return;
      }

      toast.success(`Deleted ${count} image${count === 1 ? "" : "s"}`);
      clearImageSelection();
      fetchImages();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Event upload handler ──
  const openEventUpload = (evtId: string) => {
    setUploadEventId(evtId);
    setEventUploadFiles(null);
    setEventUploadOpen(true);
  };

  const handleEventUpload = async () => {
    if (!eventUploadFiles || eventUploadFiles.length === 0) {
      toast.error("Please select at least one image");
      return;
    }

    setEventUploading(true);

    // Use event title as alt text
    const currentEvent = events.find((e) => e.id === uploadEventId);
    const eventTitle = currentEvent?.title ?? "Event photo";

    let succeeded = 0;
    let failed = 0;
    let firstUploadedUrl: string | null = null;

    for (let i = 0; i < eventUploadFiles.length; i++) {
      try {
        const f = eventUploadFiles[i];
        const fileExt = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const fileName = `${Date.now()}-${i}.${fileExt}`;
        const url = await uploadToStorage("gallery", fileName, f);

        const res = await adminFetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            alt: eventUploadFiles.length > 1 ? `${eventTitle} ${i + 1}` : eventTitle,
            category: "events",
            currentCount: images.length + succeeded,
            gallery_event_id: uploadEventId,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          toast.error(`${f.name}: ${data.error || "Upload failed"}`);
          failed++;
        } else {
          if (!firstUploadedUrl) {
            firstUploadedUrl = url;
          }
          succeeded++;
        }
      } catch (err) {
        toast.error(`${eventUploadFiles[i].name}: ${err instanceof Error ? err.message : "Upload failed"}`);
        failed++;
      }
    }

    // Auto-set cover photo if the event doesn't have one yet
    if (firstUploadedUrl && !currentEvent?.cover_image_url) {
      await adminApi({
        action: "update",
        table: "gallery_events",
        data: { cover_image_url: firstUploadedUrl },
        match: { column: "id", value: uploadEventId },
      });
    }

    if (succeeded > 0) {
      toast.success(`${succeeded} image(s) uploaded to event${failed > 0 ? `, ${failed} failed` : ""}`);
    }

    setEventUploadOpen(false);
    // Clear cached images for this event so they refresh on next expand
    setEventImages((prev) => {
      const next = { ...prev };
      delete next[uploadEventId];
      return next;
    });
    // Re-expand to show updated photos
    if (expandedEventId === uploadEventId) {
      setExpandedEventId(null);
      setTimeout(() => toggleEventExpand(uploadEventId), 100);
    }
    fetchImages();
    fetchEvents();
    setEventUploading(false);
  };

  // ── Event handlers ──
  const resetEventForm = () => {
    setEventForm({
      title: "",
      event_date: "",
      academic_year: "",
      is_public: true,
    });
    setEditingId(null);
  };

  const openEditEvent = (evt: GalleryEvent) => {
    setEditingId(evt.id);
    setEventForm({
      title: evt.title,
      event_date: evt.event_date,
      academic_year: evt.academic_year ?? "",
      is_public: evt.is_public,
    });
    setEventDialogOpen(true);
  };

  const handleEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!eventForm.event_date) {
      toast.error("Event date is required");
      return;
    }

    setSubmitting(true);

    const data = {
      title: eventForm.title.trim(),
      event_date: eventForm.event_date,
      academic_year: eventForm.academic_year.trim() || null,
      is_public: eventForm.is_public,
    };

    const result = editingId
      ? await adminApi({
          action: "update",
          table: "gallery_events",
          data,
          match: { column: "id", value: editingId },
        })
      : await adminApi({ action: "insert", table: "gallery_events", data });

    if (!result.success) {
      toast.error(result.error || "Failed to save event");
    } else {
      toast.success(editingId ? "Event updated" : "Event created");
      setEventDialogOpen(false);
      resetEventForm();
      await fetchEvents();
    }
    setSubmitting(false);
  };

  const handleEventDelete = async (id: string) => {
    if (!confirm("Delete this gallery event? Photos linked to it will be unlinked but not deleted.")) return;

    const result = await adminApi({
      action: "delete",
      table: "gallery_events",
      match: { column: "id", value: id },
    });

    if (!result.success) {
      toast.error("Failed to delete event");
      return;
    }

    toast.success("Event deleted");
    await fetchEvents();
  };

  // ── Expand event to show photos ──
  const toggleEventExpand = async (eventId: string) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }

    setExpandedEventId(eventId);

    // Fetch images for this event if not already cached
    if (!eventImages[eventId]) {
      setEventImagesLoading(eventId);
      const { data, error } = await supabase
        .from("gallery_images")
        .select("*")
        .eq("gallery_event_id", eventId)
        .order("sort_order", { ascending: true });

      if (!error) {
        setEventImages((prev) => ({ ...prev, [eventId]: (data as GalleryImage[]) ?? [] }));
      }
      setEventImagesLoading(null);
    }
  };

  const handleEventImageDelete = async (image: GalleryImage) => {
    if (!confirm(`Remove this photo?`)) return;

    try {
      const res = await adminDelete("/api/gallery", { id: image.id, src: image.src });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Delete failed");
        return;
      }

      toast.success("Photo removed");

      // Update cached event images
      if (image.gallery_event_id) {
        setEventImages((prev) => ({
          ...prev,
          [image.gallery_event_id!]: (prev[image.gallery_event_id!] ?? []).filter((img) => img.id !== image.id),
        }));
        setImageCounts((prev) => ({
          ...prev,
          [image.gallery_event_id!]: Math.max(0, (prev[image.gallery_event_id!] || 0) - 1),
        }));
      }

      fetchImages();
    } catch {
      toast.error("Failed to delete photo");
    }
  };

  const handleSetCover = async (eventId: string, imageUrl: string) => {
    const result = await adminApi({
      action: "update",
      table: "gallery_events",
      data: { cover_image_url: imageUrl },
      match: { column: "id", value: eventId },
    });

    if (!result.success) {
      toast.error("Failed to set cover photo");
      return;
    }

    toast.success("Cover photo updated");
    // Update local state
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, cover_image_url: imageUrl } : e))
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const eventTitleById = React.useMemo(() => {
    const map: Record<string, string> = {};
    events.forEach((e) => { map[e.id] = e.title; });
    return map;
  }, [events]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
          Gallery Management
        </h1>

        {tab === "images" ? (
          <Button className="bg-navy-900 hover:bg-navy-800 text-white" onClick={() => setImageDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Images
          </Button>
        ) : (
          <Button
            className="bg-navy-900 hover:bg-navy-800 text-white"
            onClick={() => {
              resetEventForm();
              setEventDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Event
          </Button>
        )}
      </div>

      {/* Toggle Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("images")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            tab === "images"
              ? "bg-white text-navy-900 shadow-sm"
              : "text-gray-500 hover:text-navy-900"
          )}
        >
          <LucideImage className="h-4 w-4" />
          By Category
        </button>
        <button
          onClick={() => {
            setTab("events");
            clearImageSelection();
          }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
            tab === "events"
              ? "bg-white text-navy-900 shadow-sm"
              : "text-gray-500 hover:text-navy-900"
          )}
        >
          <FolderOpen className="h-4 w-4" />
          By Event
        </button>
      </div>

      {/* ── Images Tab ── */}
      {tab === "images" && (
        <>
          {/* Upload Dialog */}
          <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                    <LucideImage className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <DialogTitle>Upload Gallery Images</DialogTitle>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Add photos to the school gallery</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-5">
                {/* Crop queue active for images */}
                {cropTarget === "images" && cropQueue.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Cropping image {cropIndex + 1} of {cropQueue.length}</span>
                      <button
                        type="button"
                        onClick={handleCropCancelAll}
                        className="text-red-500 hover:underline"
                      >
                        Cancel all
                      </button>
                    </div>
                    <ImageCropper
                      imageSrc={cropQueue[cropIndex]}
                      onCropComplete={handleCropDone}
                      onCancel={handleCropSkip}
                      fileName={`gallery-${Date.now()}-${cropIndex}.jpg`}
                      cropShape="rect"
                      onCropAll={cropQueue.length - cropIndex > 1 ? handleCropAll : undefined}
                    />
                    <p className="text-xs text-center text-gray-400">
                      Press &quot;Cancel&quot; to skip cropping this image
                      {cropQueue.length - cropIndex > 1 && " · \"Crop All\" applies the same crop to remaining images"}
                    </p>
                  </div>
                ) : (
                  <FileDropZone
                    accept="image/*"
                    multiple
                    icon="image"
                    onChange={(fileList) => {
                      if (fileList && fileList.length > 0) {
                        startCropQueue(fileList, "images");
                      } else {
                        setFiles(null);
                      }
                    }}
                    value={files}
                    label="Drop images here or click to browse"
                    hint="JPEG, PNG, WebP — max 10MB each"
                  />
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="alt" className="text-xs font-medium">Description *</Label>
                  <Input
                    id="alt"
                    placeholder="Describe the image(s) for accessibility"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="category" className="text-xs font-medium">Category</Label>
                    <select
                      id="category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="event" className="text-xs font-medium">Event (optional)</Label>
                    <select
                      id="event"
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                      className="w-full h-9 rounded-lg border border-gray-200 dark:border-border px-3 text-sm bg-white dark:bg-muted focus:border-navy-900 focus:ring-1 focus:ring-navy-900 outline-none transition-colors"
                    >
                      <option value="">No event</option>
                      {events.map((evt) => (
                        <option key={evt.id} value={evt.id}>
                          {evt.title} ({evt.event_date})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <Button
                  onClick={handleImageUpload}
                  disabled={uploading || !files || files.length === 0}
                  className="w-full bg-navy-900 hover:bg-navy-800 text-white h-11 rounded-xl font-medium"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload {files && files.length > 1 ? `${files.length} Images` : "Image"}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Selection + view-mode toolbar */}
          {!imagesLoading && images.length > 0 && (
            <div className="flex items-center justify-between mb-4 text-sm gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-gray-600 dark:text-gray-300 select-none">
                <Checkbox
                  checked={selectedImageIds.size === images.length && images.length > 0}
                  onCheckedChange={toggleSelectAllImages}
                />
                <span>
                  {selectedImageIds.size > 0
                    ? `${selectedImageIds.size} selected`
                    : `Select all (${images.length})`}
                </span>
              </label>
              <div className="flex items-center gap-2">
                {selectedImageIds.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearImageSelection}
                      disabled={bulkDeleting}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleBulkImageDelete}
                      disabled={bulkDeleting}
                      className="gap-1.5"
                    >
                      {bulkDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete {selectedImageIds.size}
                    </Button>
                    <span className="h-5 w-px bg-gray-200 dark:bg-border mx-1" />
                  </>
                )}
                {/* View mode toggle */}
                <div className="flex items-center rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-card p-0.5">
                  <button
                    type="button"
                    onClick={() => updateViewMode("list")}
                    title="List view"
                    aria-label="List view"
                    aria-pressed={viewMode === "list"}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
                      viewMode === "list"
                        ? "bg-navy-900 text-white"
                        : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
                    )}
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">List</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateViewMode("small")}
                    title="Small icons"
                    aria-label="Small icons"
                    aria-pressed={viewMode === "small"}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
                      viewMode === "small"
                        ? "bg-navy-900 text-white"
                        : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
                    )}
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Small</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateViewMode("large")}
                    title="Large icons"
                    aria-label="Large icons"
                    aria-pressed={viewMode === "large"}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
                      viewMode === "large"
                        ? "bg-navy-900 text-white"
                        : "text-gray-500 dark:text-gray-400 hover:text-navy-900 dark:hover:text-white"
                    )}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Large</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Images Grid / List */}
          {imagesLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-card rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-border animate-pulse"
                >
                  <div className="aspect-square bg-gray-200 dark:bg-muted" />
                  <div className="p-2 space-y-1.5">
                    <div className="h-3 bg-gray-200 dark:bg-muted rounded w-3/4" />
                    <div className="h-2.5 bg-gray-200 dark:bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-20 text-gray-500 dark:text-gray-400">
              <p className="text-lg">No gallery images yet.</p>
              <p className="text-sm mt-1">Click &quot;Add Images&quot; to get started.</p>
            </div>
          ) : viewMode === "list" ? (
            <div className="erp-table-container overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="w-16">Preview</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.map((image) => {
                    const isSelected = selectedImageIds.has(image.id);
                    return (
                      <TableRow
                        key={image.id}
                        onClick={() => toggleImageSelection(image.id)}
                        className={cn(
                          "cursor-pointer",
                          isSelected && "bg-blue-50/60 dark:bg-blue-950/20"
                        )}
                      >
                        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleImageSelection(image.id)}
                          />
                        </TableCell>
                        <TableCell className="w-16">
                          <div className="relative h-12 w-12 rounded-md overflow-hidden bg-navy-100 border border-gray-200 dark:border-border">
                            {image.src && (
                              <Image
                                src={image.src}
                                alt={image.alt}
                                fill
                                className="object-cover"
                                sizes="48px"
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium max-w-xs truncate">
                          {image.alt}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 px-2 py-0.5 rounded-full">
                            {image.category}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-600 dark:text-gray-300 text-sm">
                          {image.gallery_event_id
                            ? eventTitleById[image.gallery_event_id] ?? "—"
                            : "—"}
                        </TableCell>
                        <TableCell className="text-gray-600 dark:text-gray-300 text-sm whitespace-nowrap">
                          {formatDateTime(image.created_at)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleImageDelete(image)}
                            aria-label="Delete image"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete image"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-4",
                viewMode === "small"
                  ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
                  : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
              )}
            >
              {images.map((image) => {
                const isSelected = selectedImageIds.has(image.id);
                const isSmall = viewMode === "small";
                return (
                  <div
                    key={image.id}
                    onClick={() => toggleImageSelection(image.id)}
                    className={cn(
                      "relative group bg-white dark:bg-card rounded-lg overflow-hidden shadow-sm border cursor-pointer transition-all",
                      isSelected
                        ? "border-blue-500 ring-2 ring-blue-500/40"
                        : "border-gray-200 dark:border-border hover:border-gray-300 hover:shadow-md"
                    )}
                  >
                    <div className="aspect-square bg-navy-100 flex items-center justify-center relative">
                      {image.src ? (
                        <Image
                          src={image.src}
                          alt={image.alt}
                          fill
                          className={cn(
                            "object-cover transition-opacity",
                            isSelected && "opacity-80"
                          )}
                          sizes={isSmall ? "(max-width: 768px) 25vw, 12vw" : "(max-width: 768px) 50vw, 20vw"}
                        />
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-[10px]">{image.alt}</span>
                      )}
                    </div>
                    {isSmall ? (
                      <div className="p-1.5">
                        <p className="text-[10px] font-medium truncate">{image.alt}</p>
                        <span className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 px-1 py-0.5 rounded-full">
                          {image.category}
                        </span>
                      </div>
                    ) : (
                      <div className="p-3 space-y-1.5">
                        <p className="text-sm font-medium truncate" title={image.alt}>{image.alt}</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 px-2 py-0.5 rounded-full capitalize">
                            {image.category}
                          </span>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                            {formatDateTime(image.created_at)}
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Selection indicator (top-left) */}
                    <div
                      className={cn(
                        "absolute top-1 left-1 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all shadow-sm",
                        isSelected
                          ? "bg-blue-500 border-blue-500 text-white"
                          : "bg-white/80 dark:bg-black/50 border-white/90 text-transparent opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </div>
                    {/* Delete button (top-right) — hidden while selecting to avoid confusion */}
                    {selectedImageIds.size === 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleImageDelete(image);
                        }}
                        className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Events Tab ── */}
      {tab === "events" && (
        <>
          {/* Event Dialog */}
          <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                    <FolderOpen className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <DialogTitle>{editingId ? "Edit Gallery Event" : "Add Gallery Event"}</DialogTitle>
                    <p className="text-xs text-gray-500 mt-0.5">{editingId ? "Update event details" : "Create an event to organize photos"}</p>
                  </div>
                </div>
              </DialogHeader>
              <form onSubmit={handleEventSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Title</Label>
                  <Input
                    placeholder="e.g. Annual Day 2025"
                    value={eventForm.title}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, title: e.target.value })
                    }
                    required
                    className="h-9"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Event Date</Label>
                    <Input
                      type="date"
                      value={eventForm.event_date}
                      onChange={(e) =>
                        setEventForm({ ...eventForm, event_date: e.target.value })
                      }
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Academic Year</Label>
                    <AcademicYearSelect
                      value={eventForm.academic_year}
                      onChange={(val) =>
                        setEventForm({ ...eventForm, academic_year: val })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_public"
                    checked={eventForm.is_public}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, is_public: e.target.checked })
                    }
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <Label htmlFor="is_public" className="mb-0 text-xs font-medium">
                    Visible on public gallery
                  </Label>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEventDialogOpen(false)}
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
                    {editingId ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Event Upload Dialog */}
          <Dialog open={eventUploadOpen} onOpenChange={setEventUploadOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                    <Upload className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <DialogTitle>Upload Photos to Event</DialogTitle>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Bulk upload images for{" "}
                      <span className="font-medium text-gray-700">
                        {events.find((e) => e.id === uploadEventId)?.title}
                      </span>
                    </p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-5">
                {/* Crop queue active for event photos */}
                {cropTarget === "event" && cropQueue.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Cropping image {cropIndex + 1} of {cropQueue.length}</span>
                      <button
                        type="button"
                        onClick={handleCropCancelAll}
                        className="text-red-500 hover:underline"
                      >
                        Cancel all
                      </button>
                    </div>
                    <ImageCropper
                      imageSrc={cropQueue[cropIndex]}
                      onCropComplete={handleCropDone}
                      onCancel={handleCropSkip}
                      fileName={`event-${Date.now()}-${cropIndex}.jpg`}
                      cropShape="rect"
                      onCropAll={cropQueue.length - cropIndex > 1 ? handleCropAll : undefined}
                    />
                    <p className="text-xs text-center text-gray-400">
                      Press &quot;Cancel&quot; to skip cropping this image
                      {cropQueue.length - cropIndex > 1 && " · \"Crop All\" applies the same crop to remaining images"}
                    </p>
                  </div>
                ) : (
                  <FileDropZone
                    accept="image/*"
                    multiple
                    icon="image"
                    onChange={(fileList) => {
                      if (fileList && fileList.length > 0) {
                        startCropQueue(fileList, "event");
                      } else {
                        setEventUploadFiles(null);
                      }
                    }}
                    value={eventUploadFiles}
                    label="Drop images here or click to browse"
                    hint="JPEG, PNG, WebP — max 10MB each"
                  />
                )}

                <p className="text-xs text-gray-500">
                  Photos will be tagged with the event title for accessibility.
                </p>

                <Button
                  onClick={handleEventUpload}
                  disabled={eventUploading || !eventUploadFiles || eventUploadFiles.length === 0}
                  className="w-full bg-navy-900 hover:bg-navy-800 text-white h-11 rounded-xl font-medium"
                >
                  {eventUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload {eventUploadFiles && eventUploadFiles.length > 1 ? `${eventUploadFiles.length} Images` : "Image"}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Events Table */}
          {eventsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-navy-900 dark:text-white" />
            </div>
          ) : (
            <div className="erp-table-container p-6">
              {events.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No gallery events yet</p>
                  <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                    Create events to organize photos by occasion
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Title</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Photos</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((evt) => {
                      const isExpanded = expandedEventId === evt.id;
                      const photos = eventImages[evt.id] ?? [];
                      const isLoadingPhotos = eventImagesLoading === evt.id;

                      return (
                        <React.Fragment key={evt.id}>
                          <TableRow
                            className={cn("cursor-pointer", isExpanded && "bg-gray-50/50 dark:bg-muted/30")}
                            onClick={() => toggleEventExpand(evt.id)}
                          >
                            <TableCell className="w-8 pr-0">
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 text-gray-400 transition-transform duration-200",
                                  isExpanded && "rotate-90"
                                )}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{evt.title}</TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {formatDate(evt.event_date)}
                            </TableCell>
                            <TableCell className="text-gray-600 dark:text-gray-300">
                              {evt.academic_year || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                {imageCounts[evt.id] || 0} photos
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {evt.is_public ? (
                                <Badge className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                  Public
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400">
                                  Hidden
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => openEventUpload(evt.id)}
                                  aria-label="Upload photos to this event"
                                  className="text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                  title="Upload photos to this event"
                                >
                                  <Upload className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => openEditEvent(evt)}
                                  aria-label="Edit event"
                                  className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleEventDelete(evt.id)}
                                  aria-label="Delete event"
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expanded photo strip */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="p-0 overflow-x-hidden">
                                <div className="bg-gray-50/80 dark:bg-muted/20 border-t border-b border-gray-100 dark:border-border px-6 py-3 max-w-[1px] min-w-full">
                                  {isLoadingPhotos ? (
                                    <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-sm py-2">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Loading photos...
                                    </div>
                                  ) : photos.length === 0 ? (
                                    <div className="flex items-center gap-3 text-gray-400 dark:text-gray-500 text-sm py-2">
                                      <ImageIcon className="h-4 w-4" />
                                      No photos in this event yet.
                                      <button
                                        onClick={() => openEventUpload(evt.id)}
                                        className="text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2"
                                      >
                                        Upload photos
                                      </button>
                                    </div>
                                  ) : (
                                    <PhotoStripCarousel
                                      photos={photos}
                                      coverUrl={evt.cover_image_url}
                                      onSetCover={(url) => handleSetCover(evt.id, url)}
                                      onDelete={handleEventImageDelete}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
