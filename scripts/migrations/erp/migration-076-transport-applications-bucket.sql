-- Migration 076: private storage bucket for transport change-request applications.
--
-- Parents (parent portal) and the school office upload a scanned application
-- (PDF/JPG/PNG) supporting a bus-change / stop-change / drop request. The file
-- is written server-side via the service-role client; the admin changes page
-- reads it through a short-lived signed URL. Private bucket — never public.
-- Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transport-applications',
  'transport-applications',
  false,
  10485760, -- 10 MB
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only the service role writes/reads objects here (routes use the admin client
-- and mint signed URLs). No public read policy — the bucket stays private.
drop policy if exists "Service role manages transport applications" on storage.objects;
create policy "Service role manages transport applications"
  on storage.objects for all
  to service_role
  using (bucket_id = 'transport-applications')
  with check (bucket_id = 'transport-applications');
