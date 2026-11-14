-- Tests transactionnels de la base (40 vérifications). Se terminent par une exception volontaire : tout est annulé.
-- =====================================================================
-- Tests de la migration 1 (V12). Exécutés dans une transaction qui se termine
-- par une erreur volontaire : rien n'est conservé, les résultats sont dans le message.
-- =====================================================================
create temp table tr (n serial primary key, name text, ok boolean, detail text);
create temp table ctx (k text primary key, v text);

create function pg_temp.run_as(p_uid uuid, p_sql text) returns text
language plpgsql as $f$
declare v_txt text; v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
  begin
    if lower(left(btrim(p_sql), 6)) = 'select' then
      execute p_sql into v_txt;
      v_res := 'OK:' || coalesce(v_txt, 'null');
    else
      execute p_sql;
      get diagnostics v_n = row_count;
      v_res := 'OK:rows=' || v_n;
    end if;
  exception when others then
    v_res := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return v_res;
end $f$;

create function pg_temp.save(p_uid uuid, p_payload jsonb) returns text
language sql as $f$ select pg_temp.run_as(p_uid, 'select public.save_report(' || quote_literal(p_payload::text) || '::jsonb)::text') $f$;
create function pg_temp.review(p_uid uuid, p_report uuid, p_action text, p_note text) returns text
language sql as $f$ select pg_temp.run_as(p_uid, 'select public.review_report(' || quote_literal(jsonb_build_object('op_id', gen_random_uuid(), 'report_id', p_report, 'action', p_action, 'note', p_note)::text) || '::jsonb)::text') $f$;
create function pg_temp.pay(p_dev text, p_offs jsonb, p_acts jsonb) returns jsonb
language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'op_id', gen_random_uuid(), 'device_record_id', p_dev,
    'fields', jsonb_build_object('activity_type_id', '7c17c522-2ae0-41b0-aecc-4233ab3cbb1b', 'activity_date', '2026-10-25',
      'members_count', 10, 'visitors_count', 2, 'offering_fc', 1000, 'offering_usd', 5, 'writer_name', 'Testeur'),
    'officiants', p_offs, 'acts', p_acts))
$f$;
create function pg_temp.off(p_name text, p_role text) returns jsonb
language sql as $f$ select jsonb_build_object('name_as_reported', p_name, 'role_in_activity', p_role) $f$;

do $t$
declare
  armine uuid := 'abd89ac5-2bdc-463b-8db9-bd6c173cc370';
  gustave uuid := '8257e03f-c358-4435-9534-6c0c6cd2e055';
  adm uuid := 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac';
  comm uuid := 'b9341502-166c-4290-aa10-1218f9650058';
  other_comm uuid := 'c4bd389a-2772-43ad-877a-d880667927fa';
  other uuid := '99999999-9999-9999-9999-999999999999';
  r text; j jsonb; rid uuid; rid2 uuid; rid3 uuid; rid5 uuid; rid9 uuid; pay jsonb; n int; upd text; st text;
begin
  -- T01 : codes des rapports existants
  insert into tr(name, ok, detail)
  select 'T01 codes des rapports existants', count(*) >= 2 and bool_and(report_code ~ '^TT-[0-9]{4}-[0-9]{6}$'), string_agg(report_code, ',' order by report_number) from public.reports;

  -- T02 : création d'un brouillon (1 officiant + 1 assistant) par un rapporteur
  pay := pg_temp.pay('dev-1', jsonb_build_array(pg_temp.off('P. Test', 'principal'), pg_temp.off('Assistant 1', 'assistant')), '[]'::jsonb);
  r := pg_temp.save(armine, pay);
  j := substr(r, 4)::jsonb;
  rid := (j ->> 'id')::uuid;
  insert into tr(name, ok, detail) values ('T02 création brouillon avec code TT-AAAA-NNNNNN', r like 'OK:%' and j ->> 'status' = 'draft' and j ->> 'report_code' ~ '^TT-[0-9]{4}-[0-9]{6}$', r);

  -- T03 : rejouer la même opération ne crée rien
  r := pg_temp.save(armine, pay);
  select count(*) into n from public.reports where device_record_id = 'dev-1';
  insert into tr(name, ok, detail) values ('T03 rejeu de la même opération = pas de doublon', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'replayed') = 'true' and n = 1, r || ' / lignes=' || n);

  -- T04 : même saisie hors connexion avec une autre opération (réponse perdue) = même fiche
  r := pg_temp.save(armine, pg_temp.pay('dev-1', jsonb_build_array(pg_temp.off('P. Test', 'principal')), '[]'::jsonb));
  select count(*) into n from public.reports where device_record_id = 'dev-1';
  insert into tr(name, ok, detail) values ('T04 même référence d''appareil = même fiche', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'id')::uuid = rid and n = 1, r || ' / lignes=' || n);

  -- T05 : le rapporteur transmet sa fiche
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid, 'submit', true));
  insert into tr(name, ok, detail) values ('T05 transmission par le rapporteur', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'submitted', r);

  -- T06 : fiche transmise = verrouillée pour le rapporteur (fonction + accès direct)
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid, 'fields', jsonb_build_object('observations', 'tentative')));
  insert into tr(name, ok, detail) values ('T06a modification par fonction refusée', r like 'ERR:PT403:%', r);
  r := pg_temp.run_as(armine, format('update public.reports set observations = %L where id = %L', 'contournement', rid));
  insert into tr(name, ok, detail) values ('T06b modification directe refusée (0 ligne)', r = 'OK:rows=0', r);
  r := pg_temp.run_as(armine, format('update public.reports set status = %L where id = %L', 'validated', rid));
  insert into tr(name, ok, detail) values ('T06c auto-validation directe refusée', r = 'OK:rows=0' or r like 'ERR:%', r);
  r := pg_temp.run_as(armine, format('insert into public.report_officiants(report_id, name_as_reported, role_in_activity, position_order) values (%L, %L, %L, 9)', rid, 'Intrus', 'assistant'));
  insert into tr(name, ok, detail) values ('T06d ajout direct d''intervenant sur fiche transmise refusé', r like 'ERR:%', r);
  r := pg_temp.run_as(armine, format('delete from public.report_officiants where report_id = %L', rid));
  insert into tr(name, ok, detail) values ('T06e suppression directe d''intervenants refusée (0 ligne)', r = 'OK:rows=0' or r like 'ERR:%', r);
  select count(*) into n from public.report_officiants where report_id = rid;
  insert into tr(name, ok, detail) values ('T06f intervenants intacts', n = 2, 'n=' || n);

  -- T07 : administrateur en lecture seule
  r := pg_temp.save(adm, pg_temp.pay('dev-adm', jsonb_build_array(pg_temp.off('X', 'principal')), '[]'::jsonb));
  insert into tr(name, ok, detail) values ('T07a admin : création par fonction refusée', r like 'ERR:PT403:%', r);
  r := pg_temp.run_as(adm, format('update public.reports set observations = %L where id = %L', 'admin', rid));
  insert into tr(name, ok, detail) values ('T07b admin : modification directe refusée', r = 'OK:rows=0', r);
  r := pg_temp.run_as(adm, format('insert into public.reports(community_id, activity_type_id, activity_date, writer_name, intake_source, status, created_by) values (%L, %L, %L, %L, %L, %L, %L)', comm, '7c17c522-2ae0-41b0-aecc-4233ab3cbb1b', '2026-10-25', 'Admin', 'commission_transcription', 'draft', adm));
  insert into tr(name, ok, detail) values ('T07c admin : insertion directe refusée', r like 'ERR:%', r);
  r := pg_temp.run_as(adm, 'select count(*) from public.reports');
  insert into tr(name, ok, detail) values ('T07d admin : lecture de tous les rapports', r like 'OK:%' and substr(r, 4)::int >= 3, r);
  r := pg_temp.review(adm, rid, 'start', null);
  insert into tr(name, ok, detail) values ('T07e admin : contrôle refusé', r like 'ERR:PT403:%', r);

  -- T08 : limites des intervenants
  r := pg_temp.save(armine, pg_temp.pay('dev-2', jsonb_build_array(pg_temp.off('A', 'principal'), pg_temp.off('B', 'principal')), '[]'::jsonb));
  insert into tr(name, ok, detail) values ('T08a deux officiants refusés', r like 'ERR:PT422:%', r);
  r := pg_temp.save(armine, pg_temp.pay('dev-2', jsonb_build_array(pg_temp.off('A', 'principal'), pg_temp.off('1', 'assistant'), pg_temp.off('2', 'assistant'), pg_temp.off('3', 'assistant'), pg_temp.off('4', 'assistant'), pg_temp.off('5', 'assistant'), pg_temp.off('6', 'assistant')), '[]'::jsonb));
  insert into tr(name, ok, detail) values ('T08b six assistants refusés', r like 'ERR:PT422:%', r);
  r := pg_temp.save(armine, pg_temp.pay('dev-2', jsonb_build_array(pg_temp.off('A', 'principal'), pg_temp.off('1', 'assistant'), pg_temp.off('2', 'assistant'), pg_temp.off('3', 'assistant'), pg_temp.off('4', 'assistant'), pg_temp.off('5', 'assistant')), '[]'::jsonb));
  insert into tr(name, ok, detail) values ('T08c un officiant et cinq assistants acceptés', r like 'OK:%', r);
  rid2 := (substr(r, 4)::jsonb ->> 'id')::uuid;
  begin
    insert into public.report_officiants(report_id, name_as_reported, role_in_activity, position_order) values (rid2, 'Sixième', 'assistant', 7);
    insert into tr(name, ok, detail) values ('T08d sixième assistant direct refusé par la base', false, 'accepté à tort');
  exception when others then
    insert into tr(name, ok, detail) values ('T08d sixième assistant direct refusé par la base', sqlstate = 'PT422', sqlstate || ' ' || sqlerrm);
  end;
  begin
    insert into public.report_officiants(report_id, name_as_reported, role_in_activity, position_order) values (rid2, 'Second officiant', 'principal', 8);
    insert into tr(name, ok, detail) values ('T08e second officiant direct refusé par la base', false, 'accepté à tort');
  exception when others then
    insert into tr(name, ok, detail) values ('T08e second officiant direct refusé par la base', sqlstate = '23505', sqlstate || ' ' || sqlerrm);
  end;
  begin
    insert into public.report_officiants(report_id, name_as_reported, role_in_activity, position_order) values (rid2, 'Autre', 'other', 9);
    insert into tr(name, ok, detail) values ('T08f rôle « autre » refusé par la base', false, 'accepté à tort');
  exception when others then
    insert into tr(name, ok, detail) values ('T08f rôle « autre » refusé par la base', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  -- T09 : officiant obligatoire à la transmission
  r := pg_temp.save(armine, pg_temp.pay('dev-3', null, null));
  rid3 := (substr(r, 4)::jsonb ->> 'id')::uuid;
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid3, 'submit', true));
  insert into tr(name, ok, detail) values ('T09 transmission sans officiant refusée', r like 'ERR:PT422:%', r);

  -- T10 : atomicité (échec tardif = rien n'est modifié)
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid2, 'officiants', jsonb_build_array(pg_temp.off('Seulement assistant', 'assistant')), 'submit', true));
  select count(*) into n from public.report_officiants where report_id = rid2 and role_in_activity = 'principal';
  select status into st from public.reports where id = rid2;
  insert into tr(name, ok, detail) values ('T10 échec tardif annule tout (officiant conservé, statut inchangé)', r like 'ERR:PT422:%' and n = 1 and st = 'draft', r || ' / officiants principaux=' || n || ' / statut=' || st);

  -- T11 : conflit de version
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid2, 'base_updated_at', '2000-01-01T00:00:00+00', 'fields', jsonb_build_object('observations', 'x')));
  insert into tr(name, ok, detail) values ('T11 conflit de version détecté', r like 'ERR:PT409:%', r);
  select updated_at::text into upd from public.reports where id = rid2;
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid2, 'base_updated_at', upd, 'fields', jsonb_build_object('observations', 'ok')));
  insert into tr(name, ok, detail) values ('T11b modification avec la bonne version acceptée', r like 'OK:%', r);

  -- T12 : parcours de la commission
  r := pg_temp.review(armine, rid, 'start', null);
  insert into tr(name, ok, detail) values ('T12a rapporteur ne peut pas contrôler', r like 'ERR:PT403:%', r);
  r := pg_temp.review(gustave, rid, 'validate', null);
  insert into tr(name, ok, detail) values ('T12b validation impossible avant contrôle', r like 'ERR:PT409:%', r);
  r := pg_temp.review(gustave, rid, 'start', null);
  insert into tr(name, ok, detail) values ('T12c début du contrôle', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'in_control', r);
  r := pg_temp.save(gustave, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid, 'fields', jsonb_build_object('observations', 'corrigé par la commission')));
  insert into tr(name, ok, detail) values ('T12d modification par la commission pendant le contrôle (statut conservé)', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'in_control', r);
  r := pg_temp.review(gustave, rid, 'ok', 'conforme');
  insert into tr(name, ok, detail) values ('T12e contrôle conforme', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'checked', r);
  r := pg_temp.save(gustave, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid, 'fields', jsonb_build_object('offering_usd', 6)));
  insert into tr(name, ok, detail) values ('T12f modification après contrôle = retour au contrôle', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'in_control', r);
  r := pg_temp.review(gustave, rid, 'ok', null);
  r := pg_temp.review(gustave, rid, 'validate', null);
  insert into tr(name, ok, detail) values ('T12g validation', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'validated', r);
  select count(*) into n from public.report_controls where report_id = rid;
  insert into tr(name, ok, detail) values ('T12h historique cohérent (2 contrôles)', n = 2 and exists (select 1 from public.report_validations where report_id = rid and decision = 'validated') and exists (select 1 from public.reports where id = rid and validated_at is not null), 'contrôles=' || n);
  r := pg_temp.save(gustave, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid, 'fields', jsonb_build_object('observations', 'après validation')));
  insert into tr(name, ok, detail) values ('T12i fiche validée verrouillée pour tous', r like 'ERR:PT423:%', r);
  r := pg_temp.run_as(gustave, format('update public.reports set observations = %L where id = %L', 'direct', rid));
  insert into tr(name, ok, detail) values ('T12j fiche validée verrouillée en accès direct', r = 'OK:rows=0', r);

  -- T13 : gardes de la base (accès direct)
  r := pg_temp.run_as(gustave, format('update public.reports set report_code = %L where id = %L', 'TT-0000-000000', rid2));
  insert into tr(name, ok, detail) values ('T13a code du rapport non modifiable', r like 'ERR:PT403:%', r);
  r := pg_temp.run_as(gustave, format('update public.reports set status = %L where id = %L', 'checked', rid2));
  insert into tr(name, ok, detail) values ('T13b saut de statut brouillon vers contrôlé refusé', r like 'ERR:PT403:%', r);
  r := pg_temp.run_as(armine, 'select count(*) from public.api_operations');
  insert into tr(name, ok, detail) values ('T13c journal des opérations inaccessible aux utilisateurs', r like 'ERR:%', r);
  insert into tr(name, ok, detail) values ('T13d droits d''exécution des fonctions',
    not has_function_privilege('anon', 'public.save_report(jsonb)', 'execute') and not has_function_privilege('anon', 'public.review_report(jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.save_report(jsonb)', 'execute') and has_function_privilege('authenticated', 'public.review_report(jsonb)', 'execute'), 'anon sans accès, utilisateurs connectés avec accès');

  -- T14 : fiche n° 9 existante (transmise sans officiant)
  select id into rid9 from public.reports where report_number = 9;
  if rid9 is not null then
    r := pg_temp.review(gustave, rid9, 'start', null);
    insert into tr(name, ok, detail) values ('T14a fiche 9 : contrôle commencé', r like 'OK:%', r);
    r := pg_temp.review(gustave, rid9, 'ok', null);
    insert into tr(name, ok, detail) values ('T14b fiche 9 : contrôle conforme refusé sans officiant', r like 'ERR:PT422:%', r);
    r := pg_temp.save(gustave, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid9, 'officiants', jsonb_build_array(pg_temp.off('Officiant ajouté', 'principal'))));
    insert into tr(name, ok, detail) values ('T14c fiche 9 : la commission ajoute l''officiant', r like 'OK:%', r);
    r := pg_temp.review(gustave, rid9, 'ok', null);
    insert into tr(name, ok, detail) values ('T14d fiche 9 : contrôle conforme accepté', r like 'OK:%' and (substr(r, 4)::jsonb ->> 'status') = 'checked', r);
  end if;

  -- T15 : correction d'une fiche validée
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'device_record_id', 'dev-corr', 'corrected_from', rid,
        'fields', jsonb_build_object('activity_type_id', '7c17c522-2ae0-41b0-aecc-4233ab3cbb1b', 'activity_date', '2026-10-25', 'writer_name', 'Testeur'),
        'officiants', jsonb_build_array(pg_temp.off('P. Test', 'principal'))));
  insert into tr(name, ok, detail) values ('T15a correction d''une fiche validée de sa communauté', r like 'OK:%', r);
  r := pg_temp.save(armine, jsonb_build_object('op_id', gen_random_uuid(), 'device_record_id', 'dev-corr2', 'corrected_from', rid2,
        'fields', jsonb_build_object('activity_type_id', '7c17c522-2ae0-41b0-aecc-4233ab3cbb1b', 'activity_date', '2026-10-25', 'writer_name', 'Testeur')));
  insert into tr(name, ok, detail) values ('T15b correction d''une fiche non validée refusée', r like 'ERR:PT422:%', r);

  -- T16 : isolation entre communautés (compte de test créé dans la transaction)
  begin
    insert into auth.users (id, instance_id, aud, role, email) values (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'autre@example.invalid');
    insert into public.profiles (id, display_name, role, community_id, active, must_change_password) values (other, 'Rapporteur test autre communauté', 'community_clerk', other_comm, true, false);
    r := pg_temp.run_as(other, format('select count(*) from public.reports where id = %L', rid2));
    insert into tr(name, ok, detail) values ('T16a une autre communauté ne voit pas la fiche', r = 'OK:0', r);
    r := pg_temp.save(other, jsonb_build_object('op_id', gen_random_uuid(), 'id', rid2, 'fields', jsonb_build_object('observations', 'intrusion')));
    insert into tr(name, ok, detail) values ('T16b une autre communauté ne peut pas modifier la fiche', r like 'ERR:PT403:%', r);
  exception when others then
    insert into tr(name, ok, detail) values ('T16 compte de test impossible à créer', null, sqlstate || ' ' || sqlerrm);
  end;
end $t$;

do $r$
begin
  raise exception E'RESULTATS_DES_TESTS\n%', (select string_agg(format('%s | %s | %s', case when ok then 'OK ' when ok is null then 'N/A' else 'ECHEC' end, name, left(coalesce(detail, ''), 160)), E'\n' order by n) from tr);
end $r$;
