-- Admin moderation: resolve flag on reports + read/update for admins

alter table public.reports
  add column if not exists resolved_at timestamptz;

comment on column public.reports.resolved_at is
  'When set, moderators marked the report as resolved.';

-- Admins (profiles.role = admin OR username sgurzheyev) can manage all reports.
drop policy if exists "reports_admin_select" on public.reports;
create policy "reports_admin_select"
  on public.reports for select
  to authenticated
  using (
    reporter_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()::text
        and (
          p.role = 'admin'
          or lower(coalesce(p.username, '')) = 'sgurzheyev'
        )
    )
  );

drop policy if exists "reports_admin_update" on public.reports;
create policy "reports_admin_update"
  on public.reports for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()::text
        and (
          p.role = 'admin'
          or lower(coalesce(p.username, '')) = 'sgurzheyev'
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()::text
        and (
          p.role = 'admin'
          or lower(coalesce(p.username, '')) = 'sgurzheyev'
        )
    )
  );

drop policy if exists "reports_admin_delete" on public.reports;
create policy "reports_admin_delete"
  on public.reports for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()::text
        and (
          p.role = 'admin'
          or lower(coalesce(p.username, '')) = 'sgurzheyev'
        )
    )
  );
