-- Beilagen zum Rundschreiben (z. B. Protokoll der JHV, Jahresplan): [{path, name, size, type}]
alter table public.newsletters add column attachments jsonb not null default '[]'::jsonb;

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword', 'application/vnd.ms-excel', 'image/jpeg', 'image/png']
where id = 'rundschreiben';

-- Mitglieder dürfen die Beilagen veröffentlichter Rundschreiben laden: <id>/anhang/<datei>
create or replace function private.newsletter_published(nid text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.newsletters where id::text = nid and published_at is not null) $$;
revoke execute on function private.newsletter_published(text) from public, anon;
grant execute on function private.newsletter_published(text) to authenticated;

create policy "Mitglieder lesen Beilagen veröffentlichter Rundschreiben" on storage.objects
  for select to authenticated
  using (bucket_id = 'rundschreiben' and (storage.foldername(name))[2] = 'anhang'
         and (select private.current_member_id()) is not null
         and private.newsletter_published((storage.foldername(name))[1]));
