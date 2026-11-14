-- ATTENTION : ce fichier est la migration V12 telle que rédigée. La version réellement appliquée en production
-- a été exécutée par morceaux (quelques politiques remplacées par ALTER POLICY). Pour l'état exact de la base,
-- exécutez export-definitions-production.sql et comparez.
-- =====================================================================
-- Migration 1 (V12) : code de rapport, intervenants, statuts, fonctions serveur
-- Additive : aucune donnée supprimée. Sauvegarde : schéma backup_20261024.
-- =====================================================================

-- ---------- 1. Code lisible et immuable des rapports ----------
alter table public.reports add column if not exists report_code text;

create or replace function private.reports_set_code() returns trigger
language plpgsql set search_path = ''
as $fn$
begin
  new.report_code := 'TT-' || to_char(now() at time zone 'Africa/Kinshasa', 'YYYY') || '-' || lpad(new.report_number::text, 6, '0');
  return new;
end $fn$;

drop trigger if exists trg_reports_code on public.reports;
create trigger trg_reports_code before insert on public.reports
  for each row execute function private.reports_set_code();

update public.reports
   set report_code = 'TT-' || to_char(created_at at time zone 'Africa/Kinshasa', 'YYYY') || '-' || lpad(report_number::text, 6, '0')
 where report_code is null;

alter table public.reports alter column report_code set not null;
create unique index if not exists reports_report_code_key on public.reports (report_code);

create or replace function private.reports_immutable_guard() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
  if (select auth.uid()) is not null and (
       new.id is distinct from old.id
    or new.report_number is distinct from old.report_number
    or new.report_code is distinct from old.report_code
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.device_record_id is distinct from old.device_record_id
  ) then
    raise exception 'L''identifiant, le numéro, l''auteur et la date de création d''un rapport ne sont pas modifiables.' using errcode = 'PT403';
  end if;
  return new;
end $fn$;

drop trigger if exists trg_reports_immutable on public.reports;
create trigger trg_reports_immutable before update on public.reports
  for each row execute function private.reports_immutable_guard();

-- ---------- 2. Intervenants à l'autel de grâce : 1 officiant, 5 assistants ----------
alter table public.report_officiants drop constraint if exists report_officiants_role_in_activity_check;
alter table public.report_officiants add constraint report_officiants_role_in_activity_check
  check (role_in_activity in ('principal', 'assistant'));

create unique index if not exists report_one_officiant_idx
  on public.report_officiants (report_id) where role_in_activity = 'principal';

create or replace function private.officiants_limits() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.role_in_activity = 'assistant' then
    perform pg_advisory_xact_lock(hashtextextended('assistants:' || new.report_id::text, 0));
    if (select count(*) from public.report_officiants o
         where o.report_id = new.report_id and o.role_in_activity = 'assistant' and o.id <> new.id) >= 5 then
      raise exception 'Une activité ne peut pas avoir plus de cinq assistants.' using errcode = 'PT422';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_officiants_limits on public.report_officiants;
create trigger trg_officiants_limits before insert or update on public.report_officiants
  for each row execute function private.officiants_limits();

-- ---------- 3. Journal d'idempotence (rejouer une opération ne la refait pas) ----------
create table if not exists public.api_operations (
  op_id uuid primary key,
  user_id uuid not null,
  kind text not null,
  report_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.api_operations enable row level security;
revoke all on public.api_operations from anon, authenticated;

-- ---------- 4. Machine à états des statuts, appliquée côté base ----------
create or replace function private.reports_status_guard() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_role text;
  v_ok boolean := false;
  v_comm boolean;
  v_n int;
begin
  if (select auth.uid()) is null then
    return new;  -- maintenance (SQL administrateur) : pas de contrôle de rôle
  end if;
  v_role := private."current_role"();
  if v_role is null then
    raise exception 'Compte inactif ou inconnu.' using errcode = 'PT403';
  end if;
  v_comm := v_role in ('commission', 'commission_deputy');

  if old.status in ('draft', 'needs_correction') and new.status = 'submitted' then
    v_ok := v_comm or v_role in ('community_clerk', 'community_leader');
  elsif old.status = 'submitted' and new.status = 'in_control' then
    v_ok := v_comm;
  elsif old.status = 'in_control' and new.status in ('checked', 'needs_correction') then
    v_ok := v_comm;
  elsif old.status = 'checked' and new.status in ('validated', 'needs_correction', 'in_control') then
    v_ok := v_comm;
  end if;
  if not v_ok then
    raise exception 'Changement de statut non autorisé (% vers %).', old.status, new.status using errcode = 'PT403';
  end if;

  if new.status in ('submitted', 'checked', 'validated') then
    select count(*) into v_n from public.report_officiants o where o.report_id = new.id and o.role_in_activity = 'principal';
    if v_n <> 1 then
      raise exception 'Un officiant est obligatoire pour cette fiche.' using errcode = 'PT422';
    end if;
  end if;

  if new.status = 'checked' and old.status = 'in_control' then
    if not exists (select 1 from public.report_controls c where c.report_id = new.id and c.result = 'match') then
      raise exception 'Aucun contrôle conforme n''est enregistré pour cette fiche.' using errcode = 'PT422';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_reports_status_guard on public.reports;
create trigger trg_reports_status_guard before update on public.reports
  for each row when (old.status is distinct from new.status)
  execute function private.reports_status_guard();

-- ---------- 5. Droits d'écriture resserrés (lecture seule pour l'administrateur) ----------
create or replace function private.can_edit_children(p_report uuid) returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.reports r
     where r.id = p_report
       and r.status <> 'validated'
       and (
         private."current_role"() in ('commission', 'commission_deputy')
         or (private."current_role"() in ('community_clerk', 'community_leader')
             and r.community_id = private.current_community_id()
             and r.status in ('draft', 'needs_correction'))
       )
  )
$fn$;

drop policy if exists officiants_insert on public.report_officiants;
drop policy if exists officiants_update on public.report_officiants;
drop policy if exists officiants_delete on public.report_officiants;
create policy officiants_insert on public.report_officiants for insert to authenticated
  with check (private.can_edit_children(report_id));
create policy officiants_update on public.report_officiants for update to authenticated
  using (private.can_edit_children(report_id)) with check (private.can_edit_children(report_id));
create policy officiants_delete on public.report_officiants for delete to authenticated
  using (private.can_edit_children(report_id));

drop policy if exists acts_insert on public.religious_acts;
drop policy if exists acts_update on public.religious_acts;
drop policy if exists acts_delete on public.religious_acts;
create policy acts_insert on public.religious_acts for insert to authenticated
  with check (private.can_edit_children(report_id));
create policy acts_update on public.religious_acts for update to authenticated
  using (private.can_edit_children(report_id)) with check (private.can_edit_children(report_id));
create policy acts_delete on public.religious_acts for delete to authenticated
  using (private.can_edit_children(report_id));

drop policy if exists reports_insert_scope on public.reports;
create policy reports_insert_scope on public.reports for insert to authenticated
  with check (
    (
      private."current_role"() in ('community_clerk', 'community_leader')
      and community_id = private.current_community_id()
      and created_by = (select auth.uid())
      and status = 'draft'
      and intake_source = 'community_entry'
    ) or (
      private."current_role"() in ('commission', 'commission_deputy')
      and intake_source = 'commission_transcription'
      and created_by = (select auth.uid())
      and status = 'draft'
    )
  );

drop policy if exists reports_update_scope on public.reports;
create policy reports_update_scope on public.reports for update to authenticated
  using (
    status <> 'validated' and (
      private."current_role"() in ('commission', 'commission_deputy')
      or (private."current_role"() in ('community_clerk', 'community_leader')
          and community_id = private.current_community_id()
          and status in ('draft', 'needs_correction'))
    )
  )
  with check (
    private."current_role"() in ('commission', 'commission_deputy')
    or (private."current_role"() in ('community_clerk', 'community_leader')
        and community_id = private.current_community_id()
        and status in ('draft', 'submitted', 'needs_correction')
        and intake_source = 'community_entry')
  );

drop policy if exists controls_insert on public.report_controls;
create policy controls_insert on public.report_controls for insert to authenticated
  with check (
    private."current_role"() in ('commission', 'commission_deputy')
    and controller_id = (select auth.uid())
    and exists (select 1 from public.reports r where r.id = report_controls.report_id and r.status = 'in_control')
  );

-- ---------- 6. Fonction serveur : enregistrer un rapport (atomique, rejouable) ----------
create or replace function public.save_report(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_comm uuid;
  v_is_commission boolean;
  v_op uuid;
  v_prev jsonb;
  v_id uuid;
  v_rep public.reports%rowtype;
  v_old_status text;
  v_f jsonb := coalesce(p_payload -> 'fields', '{}'::jsonb);
  v_submit boolean := coalesce((p_payload ->> 'submit')::boolean, false);
  v_dev text := nullif(btrim(p_payload ->> 'device_record_id'), '');
  v_base timestamptz := nullif(p_payload ->> 'base_updated_at', '')::timestamptz;
  v_target_comm uuid;
  v_src uuid;
  v_src_rep public.reports%rowtype;
  v_n_princ int := 0;
  v_n_assist int := 0;
  v_changed boolean;
  o jsonb;
  v_result jsonb;
  v_pos int := 0;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = 'PT401';
  end if;
  select p.role, p.community_id into v_role, v_comm from public.profiles p where p.id = v_uid and p.active;
  if v_role is null then
    raise exception 'Compte inactif ou inconnu.' using errcode = 'PT403';
  end if;
  if v_role not in ('community_clerk', 'community_leader', 'commission', 'commission_deputy') then
    raise exception 'Votre rôle ne permet pas de saisir ou de modifier des rapports.' using errcode = 'PT403';
  end if;
  v_is_commission := v_role in ('commission', 'commission_deputy');

  v_op := nullif(p_payload ->> 'op_id', '')::uuid;
  if v_op is null then
    raise exception 'Identifiant d''opération manquant.' using errcode = 'PT400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('op:' || v_op::text, 0));
  select a.result into v_prev from public.api_operations a where a.op_id = v_op and a.user_id = v_uid;
  if found then
    return v_prev || jsonb_build_object('replayed', true);
  end if;

  -- Validation des intervenants et des actes
  if p_payload ? 'officiants' then
    if jsonb_typeof(p_payload -> 'officiants') <> 'array' then
      raise exception 'Liste des intervenants invalide.' using errcode = 'PT400';
    end if;
    for o in select value from jsonb_array_elements(p_payload -> 'officiants') loop
      if nullif(btrim(o ->> 'name_as_reported'), '') is null then
        raise exception 'Chaque intervenant doit avoir un nom.' using errcode = 'PT422';
      end if;
      if o ->> 'role_in_activity' = 'principal' then
        v_n_princ := v_n_princ + 1;
      elsif o ->> 'role_in_activity' = 'assistant' then
        v_n_assist := v_n_assist + 1;
      else
        raise exception 'Rôle d''intervenant invalide : officiant ou assistant.' using errcode = 'PT422';
      end if;
    end loop;
    if v_n_princ > 1 then
      raise exception 'Une activité ne peut avoir qu''un seul officiant.' using errcode = 'PT422';
    end if;
    if v_n_assist > 5 then
      raise exception 'Une activité ne peut pas avoir plus de cinq assistants.' using errcode = 'PT422';
    end if;
  end if;
  if p_payload ? 'acts' then
    if jsonb_typeof(p_payload -> 'acts') <> 'array' then
      raise exception 'Liste des actes invalide.' using errcode = 'PT400';
    end if;
    for o in select value from jsonb_array_elements(p_payload -> 'acts') loop
      if nullif(btrim(o ->> 'act_type'), '') is null then
        raise exception 'Chaque acte doit avoir un type.' using errcode = 'PT422';
      end if;
      if coalesce(o ->> 'quantity', '') !~ '^[0-9]{1,6}$' then
        raise exception 'Le nombre d''actes doit être un entier positif ou zéro.' using errcode = 'PT422';
      end if;
    end loop;
  end if;

  v_id := nullif(p_payload ->> 'id', '')::uuid;

  if v_id is null then
    -- ===== Création =====
    if v_dev is null then
      raise exception 'Référence de saisie manquante.' using errcode = 'PT400';
    end if;
    select * into v_rep from public.reports r where r.created_by = v_uid and r.device_record_id = v_dev;
    if found then
      v_result := jsonb_build_object('id', v_rep.id, 'report_code', v_rep.report_code, 'report_number', v_rep.report_number,
                                     'status', v_rep.status, 'updated_at', v_rep.updated_at, 'duplicate', true);
      insert into public.api_operations (op_id, user_id, kind, report_id, result) values (v_op, v_uid, 'save', v_rep.id, v_result);
      return v_result;
    end if;

    if v_is_commission then
      v_target_comm := nullif(v_f ->> 'community_id', '')::uuid;
    else
      v_target_comm := v_comm;
    end if;
    if v_target_comm is null then
      raise exception 'La communauté est obligatoire.' using errcode = 'PT422';
    end if;
    if nullif(v_f ->> 'activity_type_id', '') is null or nullif(v_f ->> 'activity_date', '') is null
       or nullif(btrim(v_f ->> 'writer_name'), '') is null then
      raise exception 'Le type d''activité, la date et le nom du rédacteur sont obligatoires.' using errcode = 'PT422';
    end if;

    v_src := nullif(p_payload ->> 'corrected_from', '')::uuid;
    if v_src is not null then
      select * into v_src_rep from public.reports r where r.id = v_src;
      if not found or v_src_rep.status <> 'validated'
         or (not v_is_commission and v_src_rep.community_id is distinct from v_comm) then
        raise exception 'La fiche à corriger doit exister, être validée et appartenir à votre communauté.' using errcode = 'PT422';
      end if;
    end if;

    insert into public.reports (
      community_id, activity_type_id, activity_description, activity_date, start_time, end_time,
      members_count, visitors_count, offering_fc, offering_usd, bible_text, writer_name, observations,
      intake_source, status, created_by, device_record_id, corrected_from
    ) values (
      v_target_comm, (v_f ->> 'activity_type_id')::uuid, nullif(btrim(v_f ->> 'activity_description'), ''),
      (v_f ->> 'activity_date')::date, nullif(v_f ->> 'start_time', '')::time, nullif(v_f ->> 'end_time', '')::time,
      coalesce((v_f ->> 'members_count')::int, 0), coalesce((v_f ->> 'visitors_count')::int, 0),
      coalesce((v_f ->> 'offering_fc')::numeric, 0), coalesce((v_f ->> 'offering_usd')::numeric, 0),
      nullif(btrim(v_f ->> 'bible_text'), ''), btrim(v_f ->> 'writer_name'), nullif(btrim(v_f ->> 'observations'), ''),
      case when v_is_commission then 'commission_transcription' else 'community_entry' end,
      'draft', v_uid, v_dev, v_src
    ) returning * into v_rep;
    v_old_status := 'draft';
    v_changed := false;
  else
    -- ===== Modification =====
    select * into v_rep from public.reports r where r.id = v_id for update;
    if not found then
      raise exception 'Fiche introuvable.' using errcode = 'PT404';
    end if;
    if v_rep.status = 'validated' then
      raise exception 'Cette fiche est validée : modification impossible. Créez une correction.' using errcode = 'PT423';
    end if;
    if not v_is_commission and (v_rep.community_id is distinct from v_comm or v_rep.status not in ('draft', 'needs_correction')) then
      raise exception 'Cette fiche n''est plus modifiable par le rapporteur.' using errcode = 'PT403';
    end if;
    if v_base is not null and v_rep.updated_at <> v_base then
      raise exception 'Cette fiche a été modifiée ailleurs.' using errcode = 'PT409';
    end if;
    v_old_status := v_rep.status;
    v_changed := (p_payload ? 'fields') or (p_payload ? 'officiants') or (p_payload ? 'acts');
    if v_changed then
      update public.reports set
        community_id = case when v_is_commission and nullif(v_f ->> 'community_id', '') is not null
                            then (v_f ->> 'community_id')::uuid else community_id end,
        activity_type_id = coalesce(nullif(v_f ->> 'activity_type_id', '')::uuid, activity_type_id),
        activity_description = case when v_f ? 'activity_description' then nullif(btrim(v_f ->> 'activity_description'), '') else activity_description end,
        activity_date = coalesce(nullif(v_f ->> 'activity_date', '')::date, activity_date),
        start_time = case when v_f ? 'start_time' then nullif(v_f ->> 'start_time', '')::time else start_time end,
        end_time = case when v_f ? 'end_time' then nullif(v_f ->> 'end_time', '')::time else end_time end,
        members_count = coalesce(nullif(v_f ->> 'members_count', '')::int, members_count),
        visitors_count = coalesce(nullif(v_f ->> 'visitors_count', '')::int, visitors_count),
        offering_fc = coalesce(nullif(v_f ->> 'offering_fc', '')::numeric, offering_fc),
        offering_usd = coalesce(nullif(v_f ->> 'offering_usd', '')::numeric, offering_usd),
        bible_text = case when v_f ? 'bible_text' then nullif(btrim(v_f ->> 'bible_text'), '') else bible_text end,
        writer_name = coalesce(nullif(btrim(v_f ->> 'writer_name'), ''), writer_name),
        observations = case when v_f ? 'observations' then nullif(btrim(v_f ->> 'observations'), '') else observations end
      where id = v_rep.id
      returning * into v_rep;
    end if;
  end if;

  -- Remplacement complet des intervenants et des actes (opération naturellement rejouable)
  if p_payload ? 'officiants' then
    delete from public.report_officiants where report_id = v_rep.id;
    v_pos := 0;
    for o in select value from jsonb_array_elements(p_payload -> 'officiants') loop
      v_pos := v_pos + 1;
      insert into public.report_officiants (report_id, name_as_reported, role_in_activity, position_order)
      values (v_rep.id, btrim(o ->> 'name_as_reported'), o ->> 'role_in_activity', v_pos);
    end loop;
  end if;
  if p_payload ? 'acts' then
    delete from public.religious_acts where report_id = v_rep.id;
    for o in select value from jsonb_array_elements(p_payload -> 'acts') loop
      insert into public.religious_acts (report_id, act_type, quantity, notes)
      values (v_rep.id, btrim(o ->> 'act_type'), (o ->> 'quantity')::int, nullif(btrim(o ->> 'notes'), ''));
    end loop;
  end if;

  -- Une fiche déjà contrôlée qui est modifiée doit être recontrôlée
  if v_old_status = 'checked' and v_changed then
    update public.reports set status = 'in_control' where id = v_rep.id returning * into v_rep;
  end if;

  if v_submit then
    if v_rep.status not in ('draft', 'needs_correction') then
      raise exception 'Cette fiche est déjà transmise.' using errcode = 'PT409';
    end if;
    update public.reports set status = 'submitted' where id = v_rep.id returning * into v_rep;
  end if;

  select * into v_rep from public.reports r where r.id = v_rep.id;
  v_result := jsonb_build_object('id', v_rep.id, 'report_code', v_rep.report_code, 'report_number', v_rep.report_number,
                                 'status', v_rep.status, 'updated_at', v_rep.updated_at, 'duplicate', false);
  insert into public.api_operations (op_id, user_id, kind, report_id, result) values (v_op, v_uid, 'save', v_rep.id, v_result);
  insert into public.audit_log (actor_id, entity_type, entity_id, action, details)
  values (v_uid, 'report', v_rep.id::text, 'save_report',
          jsonb_build_object('op_id', v_op, 'creation', v_id is null, 'submit', v_submit,
                             'officiants', case when p_payload ? 'officiants' then jsonb_array_length(p_payload -> 'officiants') end,
                             'acts', case when p_payload ? 'acts' then jsonb_array_length(p_payload -> 'acts') end));
  return v_result;
end $fn$;

-- ---------- 7. Fonction serveur : contrôler / valider (atomique, rejouable) ----------
create or replace function public.review_report(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_op uuid;
  v_prev jsonb;
  v_rep public.reports%rowtype;
  v_action text := p_payload ->> 'action';
  v_note text := nullif(btrim(p_payload ->> 'note'), '');
  v_from text;
  v_new text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = 'PT401';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_uid and p.active;
  if v_role is null or v_role not in ('commission', 'commission_deputy') then
    raise exception 'Seule la Commission de rédaction peut contrôler et valider les rapports.' using errcode = 'PT403';
  end if;
  v_op := nullif(p_payload ->> 'op_id', '')::uuid;
  if v_op is null then
    raise exception 'Identifiant d''opération manquant.' using errcode = 'PT400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('op:' || v_op::text, 0));
  select a.result into v_prev from public.api_operations a where a.op_id = v_op and a.user_id = v_uid;
  if found then
    return v_prev || jsonb_build_object('replayed', true);
  end if;

  select * into v_rep from public.reports r where r.id = nullif(p_payload ->> 'report_id', '')::uuid for update;
  if not found then
    raise exception 'Fiche introuvable.' using errcode = 'PT404';
  end if;
  if v_rep.status = 'validated' then
    raise exception 'Cette fiche est déjà validée.' using errcode = 'PT423';
  end if;
  v_from := v_rep.status;

  if v_action = 'start' then
    if v_from <> 'submitted' then
      raise exception 'Le statut de la fiche a changé (%). Actualisez la page.', v_from using errcode = 'PT409';
    end if;
    v_new := 'in_control';
  elsif v_action = 'ok' then
    if v_from <> 'in_control' then
      raise exception 'Le statut de la fiche a changé (%). Actualisez la page.', v_from using errcode = 'PT409';
    end if;
    insert into public.report_controls (report_id, controller_id, result, notes) values (v_rep.id, v_uid, 'match', v_note);
    v_new := 'checked';
  elsif v_action = 'correction' then
    if v_from <> 'in_control' then
      raise exception 'Le statut de la fiche a changé (%). Actualisez la page.', v_from using errcode = 'PT409';
    end if;
    if v_note is null then
      raise exception 'Précisez ce qu''il faut corriger.' using errcode = 'PT422';
    end if;
    insert into public.report_controls (report_id, controller_id, result, notes) values (v_rep.id, v_uid, 'correction_requested', v_note);
    v_new := 'needs_correction';
  elsif v_action = 'validate' then
    if v_from <> 'checked' then
      raise exception 'Le statut de la fiche a changé (%). Actualisez la page.', v_from using errcode = 'PT409';
    end if;
    insert into public.report_validations (report_id, validator_id, decision, note) values (v_rep.id, v_uid, 'validated', v_note);
    v_new := 'validated';
  elsif v_action = 'return' then
    if v_from <> 'checked' then
      raise exception 'Le statut de la fiche a changé (%). Actualisez la page.', v_from using errcode = 'PT409';
    end if;
    if v_note is null then
      raise exception 'Précisez le motif du renvoi.' using errcode = 'PT422';
    end if;
    insert into public.report_validations (report_id, validator_id, decision, note) values (v_rep.id, v_uid, 'returned_for_correction', v_note);
    v_new := 'needs_correction';
  else
    raise exception 'Action inconnue.' using errcode = 'PT400';
  end if;

  update public.reports
     set status = v_new,
         validated_at = case when v_new = 'validated' then now() else validated_at end
   where id = v_rep.id
   returning * into v_rep;

  v_result := jsonb_build_object('id', v_rep.id, 'report_code', v_rep.report_code, 'status', v_rep.status, 'updated_at', v_rep.updated_at);
  insert into public.api_operations (op_id, user_id, kind, report_id, result) values (v_op, v_uid, 'review', v_rep.id, v_result);
  insert into public.audit_log (actor_id, entity_type, entity_id, action, details)
  values (v_uid, 'report', v_rep.id::text, 'review_' || v_action,
          jsonb_build_object('op_id', v_op, 'from_status', v_from, 'to_status', v_new, 'note', v_note));
  return v_result;
end $fn$;

revoke all on function public.save_report(jsonb) from public, anon;
revoke all on function public.review_report(jsonb) from public, anon;
grant execute on function public.save_report(jsonb) to authenticated;
grant execute on function public.review_report(jsonb) to authenticated;
