-- Test de la migration 005 : tout est annulé à la fin (ROLLBACK_TEST). Ne rien enregistrer en production.
-- Résultat attendu : « admin voit 2 ; clerc voit 0 ; rapport admin 2 ligne(s) ».
do $t$
declare
  adm uuid := (select id from public.profiles where role = 'district_admin' limit 1);
  clk uuid := 'abd89ac5-2bdc-463b-8db9-bd6c173cc370';
  n_admin int; n_clerk int; n_rep int; out text;
begin
  -- (contenu identique à 005-journal-admin.sql)
  create table public.admin_audit_log (
    id bigint generated always as identity primary key,
    actor_id uuid not null,
    action text not null check (action in ('reset_password', 'create_account')),
    target_id uuid, target_email text,
    detail jsonb not null default '{}'::jsonb, ip text,
    created_at timestamptz not null default now()
  );
  alter table public.admin_audit_log enable row level security;
  revoke all on public.admin_audit_log from anon, authenticated;
  grant select on public.admin_audit_log to authenticated;
  create policy admin_audit_read_district_admin on public.admin_audit_log
    for select to authenticated
    using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'district_admin' and p.active));
  create function public.admin_audit_monthly_report(p_month date)
  returns table (action text, actor_id uuid, total bigint, first_at timestamptz, last_at timestamptz)
  language sql stable security invoker set search_path = public
  as $f$
    select a.action, a.actor_id, count(*), min(a.created_at), max(a.created_at)
    from public.admin_audit_log a
    where (a.created_at at time zone 'Africa/Kinshasa') >= date_trunc('month', p_month::timestamp)
      and (a.created_at at time zone 'Africa/Kinshasa') <  date_trunc('month', p_month::timestamp) + interval '1 month'
    group by a.action, a.actor_id order by 1, 2;
  $f$;
  grant execute on function public.admin_audit_monthly_report(date) to authenticated;

  insert into public.admin_audit_log (actor_id, action, target_email, detail)
  values (adm, 'reset_password', 'test@example.org', '{"status":"started"}'),
         (adm, 'create_account', 'nouveau@example.org', '{"role":"community_clerk"}');

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_admin from public.admin_audit_log;
  select count(*) into n_rep from public.admin_audit_monthly_report(current_date);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', clk, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n_clerk from public.admin_audit_log;
  reset role;

  out := 'admin voit ' || n_admin || ' ; clerc voit ' || n_clerk || ' ; rapport admin ' || n_rep || ' ligne(s)';
  raise exception 'ROLLBACK_TEST %', out;
end
$t$;
