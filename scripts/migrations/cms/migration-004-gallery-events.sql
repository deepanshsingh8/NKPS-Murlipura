-- Migration 004: Gallery Events — event-based photo categorization
-- Allows photos to be grouped by school events for alumni/public browsing

CREATE TABLE IF NOT EXISTS gallery_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  academic_year text,
  cover_image_url text,
  is_public boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add gallery_event_id to gallery_images (nullable, existing images won't be linked)
ALTER TABLE gallery_images
  ADD COLUMN IF NOT EXISTS gallery_event_id uuid REFERENCES gallery_events(id) ON DELETE SET NULL;

-- RLS for gallery_events
ALTER TABLE gallery_events ENABLE ROW LEVEL SECURITY;

-- Public can view public events
CREATE POLICY "Public can view gallery events"
  ON gallery_events FOR SELECT
  USING (is_public = true);

-- Admins can do everything
CREATE POLICY "Admins full access to gallery events"
  ON gallery_events FOR ALL
  USING (public.get_user_role() = 'admin');

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_gallery_images_event ON gallery_images(gallery_event_id);
CREATE INDEX IF NOT EXISTS idx_gallery_events_date ON gallery_events(event_date DESC);
