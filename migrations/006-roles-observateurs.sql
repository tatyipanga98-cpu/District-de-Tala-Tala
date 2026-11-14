-- 006 — Rôles d'observation du district : district_leader (Responsable) et district_deputy (Suppléant).
-- Lecture seule : statistiques et fiches consultables, aucune écriture (RLS sans politique d'écriture
-- + garde explicite dans save_report). Idempotent.

-- 1. Nouveaux rôles autorisés
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'community_clerk', 'community_leader', 'commission', 'commission_deputy',
  'district_admin', 'district_leader', 'district_deputy']));

-- 2. Lecture élargie aux observateurs (ajout seul ; les autres droits ne changent pas)
drop policy if exists reports_read_scope on public.reports;
create policy reports_read_scope on public.reports for select using (
  private."current_role"() = any (array['commission', 'commission_deputy', 'district_admin', 'district_leader', 'district_deputy'])
  or community_id = private.current_community_id());

drop policy if exists acts_read on public.religious_acts;
create policy acts_read on public.religious_acts for select using (exists (
  select 1 from public.reports r where r.id = religious_acts.report_id and (
    private."current_role"() = any (array['commission', 'commission_deputy', 'district_admin', 'district_leader', 'district_deputy'])
    or r.community_id = private.current_community_id())));

drop policy if exists officiants_read on public.report_officiants;
create policy officiants_read on public.report_officiants for select using (exists (
  select 1 from public.reports r where r.id = report_officiants.report_id and (
    private."current_role"() = any (array['commission', 'commission_deputy', 'district_admin', 'district_leader', 'district_deputy'])
    or r.community_id = private.current_community_id())));

drop policy if exists controls_read on public.report_controls;
create policy controls_read on public.report_controls for select using (
  private."current_role"() = any (array['commission', 'commission_deputy', 'district_admin', 'district_leader', 'district_deputy']));

drop policy if exists validations_read on public.report_validations;
create policy validations_read on public.report_validations for select using (
  private."current_role"() = any (array['commission', 'commission_deputy', 'district_admin', 'district_leader', 'district_deputy']));

-- 3. save_report : garde explicite pour les observateurs (avant toute autre vérification)
do $$
declare
  src text;
  target text := 'if v_role not in (''community_clerk'', ''community_leader'', ''commission'', ''commission_deputy'') then';
  guard text := 'if v_role in (''district_leader'', ''district_deputy'') then raise exception ''Accès en lecture seule : ce rôle consulte les statistiques et ne modifie pas les rapports.'' using errcode = ''PT403''; end if;' || E'\n  ';
  n int;
begin
  select pg_get_functiondef('public.save_report(jsonb)'::regprocedure) into src;
  if position('district_leader' in src) > 0 then
    raise notice 'save_report déjà protégée';
    return;
  end if;
  n := (length(src) - length(replace(src, target, ''))) / length(target);
  if n <> 1 then
    raise exception 'Modification de save_report impossible : motif trouvé % fois', n;
  end if;
  execute replace(src, target, guard || target);
end $$;

-- 4. Vérifications finales (la migration échoue si une étape n'a pas pris effet)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and pg_get_constraintdef(oid) like '%district_deputy%') then
    raise exception 'Contrainte profiles_role_check non mise à jour';
  end if;
  if position('district_leader' in pg_get_functiondef('public.save_report(jsonb)'::regprocedure)) = 0 then
    raise exception 'Garde save_report absente';
  end if;
  if position('district_deputy' in (select qual from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_read_scope')) = 0 then
    raise exception 'Politique reports_read_scope non mise à jour';
  end if;
end $$;

