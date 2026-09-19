/**
 * Delete a group for every member (not leave-for-self).
 *
 * Any current member may call this. The function is SECURITY DEFINER so it
 * can remove the group row, all memberships (CASCADE), and pending
 * store-and-forward copies without widening table DELETE policies.
 *
 * Membership is checked first via is_group_member (also SECURITY DEFINER).
 */

create or replace function public.delete_group_for_everyone(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_group_id is null then
    raise exception 'missing group id';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'not a group member';
  end if;

  -- Drop pending SAF copies for every member before the group row goes away
  -- (messages.group_id is ON DELETE SET NULL, so they would otherwise linger).
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'group_id'
  ) then
    delete from public.messages
    where group_id = p_group_id;
  end if;

  delete from public.groups
  where id = p_group_id;
end;
$$;

revoke all on function public.delete_group_for_everyone(uuid) from public;
grant execute on function public.delete_group_for_everyone(uuid) to authenticated;

comment on function public.delete_group_for_everyone(uuid) is
  'Member-triggered hard delete: group + memberships + pending group messages. Does not weaken table RLS.';
