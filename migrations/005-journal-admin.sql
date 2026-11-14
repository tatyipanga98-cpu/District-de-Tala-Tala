-- ============================================================================
-- Version 16 — passe 1 : journal d'audit des actions de l'administrateur.
-- Migration ADDITIVE : aucune donnée existante n'est modifiée.
-- Écrit uniquement par la Edge Function swift-api (rôle service, qui contourne RLS).
-- Lu par l'administrateur du district seulement.
-- ============================================================================

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check (action in ('reset_password', 'create_account')),
  target_id uuid,
  target_email text,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_action_time
  on public.admin_audit_log (actor_id, action, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists admin_audit_read_district_admin on public.admin_audit_log;
create policy admin_audit_read_district_admin on public.admin_audit_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'district_admin' and p.active
  ));

-- Rapport mensuel : nombre d'actions par type et par administrateur, mois en heure de Kinshasa.
create or replace function public.admin_audit_monthly_report(p_month date)
returns table (action text, actor_id uuid, total bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select a.action, a.actor_id, count(*), min(a.created_at), max(a.created_at)
  from public.admin_audit_log a
  where (a.created_at at time zone 'Africa/Kinshasa') >= date_trunc('month', p_month::timestamp)
    and (a.created_at at time zone 'Africa/Kinshasa') <  date_trunc('month', p_month::timestamp) + interval '1 month'
  group by a.action, a.actor_id
  order by 1, 2;
$$;

revoke all on function public.admin_audit_monthly_report(date) from public, anon;
grant execute on function public.admin_audit_monthly_report(date) to authenticated;
