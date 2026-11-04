-- Vorstandsmitglieder sehen, wer zu Vorstandssitzungen zu- oder abgesagt hat
create policy "Vorstand sieht Rückmeldungen zu Vorstandsterminen" on public.responses
  for select to authenticated
  using ((select private.is_board()) and exists (select 1 from public.events e where e.id = responses.event_id and e.kind = 'vorstand'));
