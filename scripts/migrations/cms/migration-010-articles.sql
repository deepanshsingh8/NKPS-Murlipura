-- Migration 010: Articles (long-form news/announcements linked to Latest Updates)
-- Purpose: Give admins a first-class way to publish SEO-indexable articles that
-- surface on the homepage "Latest Updates" section and have their own /articles/[slug]
-- pages with full metadata, Open Graph, and JSON-LD structured data.

-- 1. Table
CREATE TABLE IF NOT EXISTS articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  excerpt text,
  content text NOT NULL,              -- markdown body
  cover_image_url text,
  author_name text,
  meta_description text,              -- overrides excerpt for <meta description> if set
  tags text[] DEFAULT '{}',
  is_published boolean DEFAULT false,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);

-- 2. RLS
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published articles"
  ON articles FOR SELECT
  USING (is_published = true);

CREATE POLICY "Authenticated can read all articles"
  ON articles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert articles"
  ON articles FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update articles"
  ON articles FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete articles"
  ON articles FOR DELETE TO authenticated
  USING (true);
