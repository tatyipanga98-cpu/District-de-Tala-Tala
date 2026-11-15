-- Données FICTIVES de démonstration : 8 communautés, du 4 janvier au 14 novembre 2026.
-- Chaque fiche est marquée : device_record_id commence par 'demo-' et observations = '[DÉMO] …'.
-- Retrait complet : tools/donnees-demo-retrait.sql
-- Les 3 fiches réelles existantes ne sont pas touchées (leurs dates sont exclues pour Source de vie).
-- Exécution : une seule instruction (tout ou rien). Aléa fixé par setseed : résultat reproductible.
select setseed(0.42);
with
dc(name, base, vp, clerk) as (values
  ('Makambo 1',     62, 0.55, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid),
  ('Makambo 2',     48, 0.45, '96e8c3b5-fe6f-48db-ace1-0413631ba4df'::uuid),
  ('Règne',         85, 0.80, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid),
  ('Révélation',    40, 0.30, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid),
  ('Source de vie', 55, 0.50, 'abd89ac5-2bdc-463b-8db9-bd6c173cc370'::uuid),
  ('Tala-Tala 1',   95, 0.97, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid),
  ('Tala-Tala 2',   70, 0.70, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid),
  ('Temps',         33, 0.20, 'd6934875-9f5b-4ef6-a126-bd52f5eaf5ac'::uuid)),
comm as materialized (
  select c.id as community_id, dc.name, dc.base, dc.vp, dc.clerk
  from dc join public.communities c on c.name = dc.name),
cand as materialized (
  select cm.*, g.d::date as d, extract(dow from g.d)::int as dow,
         random() as r1, random() as r2, random() as r3, random() as r4,
         random() as r5, random() as r6, random() as r7
  from comm cm cross join generate_series('2026-01-04'::date, '2026-11-14'::date, '1 day') as g(d)),
typed as materialized (
  select cand.*, case
      when d in ('2026-03-14','2026-06-13','2026-09-12','2026-11-07') and r1 < 0.6 then 'Conférence'
      when d in ('2026-01-01','2026-05-24') then 'Service divin spécial'
      when dow = 0 and extract(day from d) <= 7 then 'Service divin spécial'
      when dow = 0 then 'Service divin ordinaire'
      when dow = 3 then 'Service divin ordinaire'
      when dow = 6 and extract(week from d)::int % 2 = 0 then 'Service divin de jeunesse'
      when dow = 4 and extract(day from d) between 15 and 21 then 'Réunion'
      when dow in (1,2,4,5) and r2 < 0.013 then 'Service funèbre'
      when dow = 6 and r2 < 0.03 then 'Mariage'
      when dow = 6 and r2 < 0.05 then 'Autres activités'
    end as label
  from cand),
calc as materialized (
  select t.*,
    case label
      when 'Service divin ordinaire' then case when dow = 0 then 1.0 else 0.55 end
      when 'Service divin spécial' then 1.25 when 'Service divin de jeunesse' then 0.45
      when 'Réunion' then 0.3 when 'Conférence' then 0.7 when 'Service funèbre' then 0.6
      when 'Mariage' then 0.8 else 0.35 end as f,
    (1 + 0.0008 * (d - date '2026-01-01')) as growth,
    case when extract(month from d) = 8 then 0.9 else 1.0 end as season
  from typed t
  where label is not null
    and not (name = 'Source de vie' and d in ('2026-10-21','2026-10-24','2026-10-25'))
    and (label <> 'Service divin ordinaire' or r7 > case when d >= '2026-10-25' then 0.15 else 0.04 end)),
fin as materialized (
  select c.*, greatest(3, round(base * f * growth * season * (0.85 + 0.3 * r3)))::int as members from calc c),
fin2 as materialized (
  select fin.*,
    case when label = 'Réunion' then 0
         else round(members * (case when label in ('Service funèbre','Mariage') then 0.2 else 0.06 end + 0.08 * r4))::int end as visitors,
    case when label = 'Réunion' then 0::numeric
         else round(members * (900 + 700 * r5) * (case when label in ('Service funèbre','Mariage') then 1.5 else 1 end) / 500)::numeric * 500 end as fc,
    case when label = 'Réunion' then 0::numeric
         when r5 > 0.25 then round((members * (0.04 + 0.18 * r4) * 2)::numeric) / 2 else 0::numeric end as usd,
    case
      when d < '2026-10-01' then 'validated'
      when d < '2026-11-01' then
        case when r6 < least(0.97, vp + 0.3) then 'validated'
             when r5 < 0.4 then 'checked' when r5 < 0.7 then 'in_control'
             when r5 < 0.9 then 'submitted' else 'needs_correction' end
      else
        case when r6 < vp * 0.9 then 'validated'
             when r5 < 0.28 then 'submitted' when r5 < 0.5 then 'in_control'
             when r5 < 0.7 then 'checked' when r5 < 0.8 then 'needs_correction'
             else case when d >= '2026-11-08' then 'draft' else 'submitted' end end
    end as st,
    case label
      when 'Service divin ordinaire' then case when dow = 0 then time '09:00' else time '18:00' end
      when 'Service divin de jeunesse' then time '15:00' when 'Réunion' then time '18:00'
      when 'Conférence' then time '09:00' when 'Service funèbre' then time '10:00'
      when 'Mariage' then time '11:00' when 'Service divin spécial' then time '09:00' else time '14:00' end as t0,
    case label
      when 'Service divin ordinaire' then case when dow = 0 then time '11:30' else time '19:30' end
      when 'Service divin de jeunesse' then time '17:00' when 'Réunion' then time '19:30'
      when 'Conférence' then time '13:00' when 'Service funèbre' then time '12:00'
      when 'Mariage' then time '13:00' when 'Service divin spécial' then time '12:30' else time '16:00' end as t1
  from fin),
ins as (
  insert into public.reports (community_id, activity_type_id, activity_description, activity_date, start_time, end_time,
      members_count, visitors_count, offering_fc, offering_usd, hymns, bible_text, writer_name, observations,
      intake_source, status, created_by, device_record_id, created_at, updated_at, validated_at)
  select f.community_id, t.id,
    case when f.label = 'Autres activités' then 'Journée de salubrité de la communauté' end,
    f.d, f.t0, f.t1, f.members, f.visitors, f.fc, f.usd,
    'Cantique ' || (1 + floor(f.r4 * 220))::int || ' et ' || (1 + floor(f.r5 * 220))::int,
    (array['Jean 3:16','Psaume 23','Matthieu 5:1-12','Romains 8:28','Ésaïe 40:31','Luc 15:11-24','1 Corinthiens 13','Hébreux 11:1','Psaume 121','Jacques 1:2-4'])[1 + floor(f.r3 * 10)::int],
    (array['Sr. Marie KABEYA','Fr. Jean MAVUNGU','Sr. Esther NSIMBA','Fr. Paul LUKAMBA'])[1 + floor(f.r2 * 4)::int] || ' (démo)',
    '[DÉMO] Donnée fictive pour la démonstration.',
    'community_entry', f.st, f.clerk, 'demo-' || md5(f.community_id::text || f.d::text || f.label),
    least(((f.d + time '20:00') at time zone 'Africa/Kinshasa') + f.r4 * interval '10 hours', now()),
    least(((f.d + time '20:00') at time zone 'Africa/Kinshasa') + f.r4 * interval '10 hours', now()),
    case when f.st = 'validated'
         then least(((f.d + time '20:00') at time zone 'Africa/Kinshasa') + (1 + 3 * f.r6) * interval '1 day', now()) end
  from fin2 f join public.activity_types t on t.label = f.label
  returning id, status, created_at, validated_at),
off as (
  insert into public.report_officiants (report_id, name_as_reported, role_in_activity, position_order)
  select id, (array['Fr. Daniel MUKENDI','Fr. Joseph KALALA','Fr. Samuel TSHIMANGA','Fr. Eliézer MBUYI','Fr. Moïse KASONGO'])
             [1 + get_byte(decode(substr(md5(id::text), 1, 2), 'hex'), 0) % 5], 'principal', 1
  from ins returning 1),
ctl as (
  insert into public.report_controls (report_id, controller_id, result, notes, created_at)
  select id, '8257e03f-c358-4435-9534-6c0c6cd2e055'::uuid,
         case status when 'validated' then 'match' when 'checked' then 'checked' else 'correction_requested' end,
         '[DÉMO]', least(created_at + interval '1 day', now())
  from ins where status in ('validated', 'checked', 'needs_correction') returning 1),
val as (
  insert into public.report_validations (report_id, validator_id, decision, note, created_at)
  select id, '8257e03f-c358-4435-9534-6c0c6cd2e055'::uuid,
         case status when 'validated' then 'validated' else 'returned_for_correction' end,
         case when status = 'needs_correction' then 'Précisez les chiffres (démo).' end,
         coalesce(validated_at, least(created_at + interval '2 days', now()))
  from ins where status in ('validated', 'needs_correction') returning 1)
select (select count(*) from ins) as fiches, (select count(*) from off) as officiants,
       (select count(*) from ctl) as controles, (select count(*) from val) as validations;
