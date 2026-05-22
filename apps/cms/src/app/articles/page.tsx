"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus,
  Trash2,
  Loader2,
  Search,
  Pencil,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
} from "lucide-react";
import { adminFetch, adminDelete, adminPatch } from "@nkps/shared/lib/admin-api";
import { uploadToStorage } from "@nkps/shared/lib/supabase/upload";
import { slugify } from "@nkps/shared/lib/articles";
import { SITE_URL } from "@nkps/shared/lib/seo";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nkps/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nkps/shared/components/ui/tabs";
import { FileDropZone } from "@nkps/shared/components/FileDropZone";
import { ImageCropper } from "@nkps/shared/components/ImageCropper";
import { toast } from "sonner";
import type { Article } from "@nkps/shared/types";

interface ArticleForm {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  author_name: string;
  meta_description: string;
  tags: string;
  is_published: boolean;
  cover_image_url: string | null;
}

const emptyForm: ArticleForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  author_name: "",
  meta_description: "",
  tags: "",
  is_published: false,
  cover_image_url: null,
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [form, setForm] = useState<ArticleForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [file, setFile] = useState<FileList | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await adminFetch("/api/articles");
      const data = await res.json();
      if (res.ok) setArticles((data.data as Article[]) ?? []);
      else toast.error(data.error || "Failed to load articles");
    } catch {
      toast.error("Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const resetForm = () => {
    setForm(emptyForm);
    setSlugTouched(false);
    setFile(null);
    setEditing(null);
    setShowCropper(false);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (article: Article) => {
    setEditing(article);
    setSlugTouched(true);
    setForm({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt ?? "",
      content: article.content,
      author_name: article.author_name ?? "",
      meta_description: article.meta_description ?? "",
      tags: article.tags.join(", "),
      is_published: article.is_published,
      cover_image_url: article.cover_image_url,
    });
    setFile(null);
    setDialogOpen(true);
  };

  const handleFileSelected = (fileList: FileList | File | null) => {
    const f = fileList instanceof FileList ? fileList?.[0] : fileList;
    if (!f) {
      setFile(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setCropSrc(url);
    setShowCropper(true);
  };

  const handleCropDone = (croppedFile: File) => {
    const dt = new DataTransfer();
    dt.items.add(croppedFile);
    setFile(dt.files);
    setShowCropper(false);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleTitleChange = (value: string) => {
    setForm((f) => ({
      ...f,
      title: value,
      slug: slugTouched ? f.slug : slugify(value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.title.trim()) return toast.error("Title is required");
    if (!form.content.trim()) return toast.error("Content is required");
    const slug = (form.slug.trim() || slugify(form.title)).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return toast.error("Slug must be lowercase letters, numbers, and hyphens");
    }

    setSubmitting(true);
    try {
      let coverUrl = form.cover_image_url;
      if (file && file.length > 0) {
        const f = file[0];
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const fileName = `articles/${slug}-${Date.now()}.${ext}`;
        coverUrl = await uploadToStorage("site-media", fileName, f);
      }

      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        title: form.title.trim(),
        slug,
        excerpt: form.excerpt.trim(),
        content: form.content,
        author_name: form.author_name.trim(),
        meta_description: form.meta_description.trim(),
        tags,
        is_published: form.is_published,
        cover_image_url: coverUrl,
      };

      if (editing) {
        const res = await adminFetch("/api/articles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, data: payload }),
        });
        if (!res.ok) {
          const d = await res.json();
          toast.error(d.error || "Update failed");
          return;
        }
        toast.success("Article updated");
      } else {
        const res = await adminFetch("/api/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json();
          toast.error(d.error || "Create failed");
          return;
        }
        toast.success("Article created");
      }

      setDialogOpen(false);
      resetForm();
      await fetchArticles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (article: Article) => {
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    try {
      const res = await adminDelete("/api/articles", { id: article.id });
      if (!res.ok) {
        const d = await res.json();
        toast.error(d.error || "Delete failed");
        return;
      }
      toast.success("Article deleted");
      await fetchArticles();
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleTogglePublish = async (article: Article) => {
    try {
      const res = await adminPatch("/api/articles", {
        id: article.id,
        data: { is_published: !article.is_published },
      });
      if (!res.ok) {
        const d = await res.json();
        toast.error(d.error || "Update failed");
        return;
      }
      toast.success(article.is_published ? "Unpublished" : "Published");
      await fetchArticles();
    } catch {
      toast.error("Update failed");
    }
  };

  const filtered = articles.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      (a.excerpt?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy-900 dark:text-white">
            Articles
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Publish news, announcements, and long-form posts. Published articles appear on the homepage &ldquo;Latest Updates&rdquo; and at <code className="text-xs">/articles/[slug]</code>.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-navy-900 hover:bg-navy-800 text-white">
          <Plus className="h-4 w-4 mr-2" />
          New Article
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by title, slug, or excerpt..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Link
          href="/articles"
          target="_blank"
          className="text-xs text-gray-500 hover:text-navy-900 inline-flex items-center gap-1"
        >
          View public index
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-card rounded-xl border border-gray-200 dark:border-border animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-card rounded-2xl border border-gray-200 dark:border-border">
          <FileText className="h-10 w-10 text-gray-300 mx-auto" />
          <p className="text-lg text-gray-700 dark:text-gray-300 mt-3">
            {articles.length === 0 ? "No articles yet" : "No matches"}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {articles.length === 0
              ? "Create your first article to share news and updates."
              : "Try a different search term."}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-card rounded-2xl border border-gray-200 dark:border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Cover</TableHead>
                <TableHead>Title / Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((article) => (
                <TableRow key={article.id}>
                  <TableCell>
                    {article.cover_image_url ? (
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 relative">
                        <Image
                          src={article.cover_image_url}
                          alt={article.title}
                          fill
                          className="object-cover"
                          sizes="56px"
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-gray-100 dark:bg-muted flex items-center justify-center">
                        <FileText className="h-5 w-5 text-gray-300" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-navy-900 dark:text-white line-clamp-1">
                      {article.title}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      /articles/{article.slug}
                    </div>
                  </TableCell>
                  <TableCell>
                    {article.is_published ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-transparent">
                        Published
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">
                        Draft
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {formatDate(article.published_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-gray-400 hover:text-navy-900"
                        onClick={() => handleTogglePublish(article)}
                        title={article.is_published ? "Unpublish" : "Publish"}
                      >
                        {article.is_published ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      {article.is_published && (
                        <a
                          href={`${SITE_URL}/articles/${article.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:text-navy-900"
                          title="View live"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600"
                        onClick={() => openEdit(article)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"
                        onClick={() => handleDelete(article)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } else { setDialogOpen(true); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Article" : "New Article"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Cover image */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Cover Image</Label>
              {showCropper && cropSrc ? (
                <ImageCropper
                  imageSrc={cropSrc}
                  onCropComplete={handleCropDone}
                  onCancel={handleCropCancel}
                  fileName={`article-${Date.now()}.jpg`}
                  cropShape="rect"
                />
              ) : (
                <>
                  {file && file.length > 0 ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-24 h-14 rounded-lg overflow-hidden bg-gray-100 relative border-2 border-green-400">
                        <Image src={URL.createObjectURL(file[0])} alt="Cover preview" fill className="object-cover" sizes="96px" />
                      </div>
                      <div>
                        <p className="text-xs text-green-600 font-medium">Cropped & ready</p>
                        <button type="button" onClick={() => setFile(null)} className="text-xs text-gray-500 hover:text-red-500 mt-0.5">
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : form.cover_image_url ? (
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-24 h-14 rounded-lg overflow-hidden bg-gray-100 relative">
                        <Image src={form.cover_image_url} alt="Current cover" fill className="object-cover" sizes="96px" />
                      </div>
                      <span className="text-xs text-gray-500">Current (upload new to replace)</span>
                    </div>
                  ) : null}
                  <FileDropZone
                    accept="image/*"
                    onChange={handleFileSelected}
                    value={null}
                    label="Drop cover image or click to browse"
                    icon="image"
                  />
                </>
              )}
            </div>

            {/* Title + Slug */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Title <span className="text-red-500">*</span></Label>
                <Input
                  value={form.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="e.g., Admissions Open for 2026-27"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Slug (URL)</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: e.target.value });
                  }}
                  placeholder="admissions-open-2026-27"
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-gray-400">
                  URL: /articles/{form.slug || "auto-from-title"}
                </p>
              </div>
            </div>

            {/* Excerpt */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Excerpt</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="1–2 sentence summary. Shown on the homepage card and used as the meta description if one isn't provided."
              />
            </div>

            {/* Content with Write/Preview tabs */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Content (Markdown) <span className="text-red-500">*</span></Label>
              <Tabs defaultValue="write">
                <TabsList variant="line">
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="write">
                  <textarea
                    className="flex min-h-[280px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder={"## Heading\n\nWrite your article in markdown.\n\n- bullet\n- list\n\n**bold**, _italic_, [links](https://example.com)."}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Supports GitHub-flavored markdown: headings, lists, tables, links, code blocks.
                  </p>
                </TabsContent>
                <TabsContent value="preview">
                  <div className="min-h-[280px] w-full rounded-lg border border-input px-4 py-3 article-prose article-prose--sm">
                    {form.content.trim() ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.content}</ReactMarkdown>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Nothing to preview yet.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Author + Tags */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Author (optional)</Label>
                <Input
                  value={form.author_name}
                  onChange={(e) => setForm({ ...form, author_name: e.target.value })}
                  placeholder="e.g., Principal's Office"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tags (comma-separated)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g., admissions, news, 2026"
                />
              </div>
            </div>

            {/* Meta description */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Meta Description (SEO, optional)</Label>
              <textarea
                className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.meta_description}
                onChange={(e) => setForm({ ...form, meta_description: e.target.value })}
                placeholder="Overrides the excerpt for the <meta name='description'> tag. Keep under 160 characters."
                maxLength={200}
              />
              <p className="text-[10px] text-gray-400">
                {form.meta_description.length}/160 recommended
              </p>
            </div>

            {/* Publish */}
            <div className="flex items-center gap-2 pt-2 border-t">
              <Checkbox
                checked={form.is_published}
                onCheckedChange={(checked) => setForm({ ...form, is_published: Boolean(checked) })}
              />
              <Label className="text-sm font-medium cursor-pointer" onClick={() => setForm({ ...form, is_published: !form.is_published })}>
                Publish now (visible on the public site)
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-navy-900 hover:bg-navy-800 text-white">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editing ? "Save Changes" : "Create Article"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
