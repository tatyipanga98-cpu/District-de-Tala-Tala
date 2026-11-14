-- ============================================================================
-- Version 16 : numéro de reçu territorial (facultatif, unique).
-- Migration ADDITIVE : n'enlève ni ne modifie aucune donnée existante.
-- Les anciennes versions de l'application continuent de fonctionner (elles ignorent la colonne).
--
-- Règle : un même numéro (sans tenir compte des majuscules ni des espaces autour) ne peut servir
-- que sur une seule fiche. Exception : une fiche de correction peut reprendre le numéro de la
-- fiche validée qu'elle remplace.
--
-- La fonction save_report est modifiée par remplacement de texte contrôlé : si l'un des repères
-- n'est pas trouvé exactement une fois (fonction déjà modifiée ou différente), la migration
-- s'arrête avec une erreur et RIEN n'est changé.
-- ============================================================================

alter table public.reports add column if not exists territorial_receipt text;

alter table public.reports drop constraint if exists reports_territorial_receipt_len;
alter table public.reports add constraint reports_territorial_receipt_len
  check (territorial_receipt is null or char_length(territorial_receipt) between 1 and 40);

-- Filet de sécurité contre deux envois simultanés (la fonction vérifie aussi, avec un message clair).
create unique index if not exists reports_territorial_receipt_uniq
  on public.reports (lower(territorial_receipt))
  where territorial_receipt is not null and corrected_from is null;

do $mig$
declare
  v_def text;
  v_oid oid;
  procedure_marker text := 'territorial_receipt';
  function_patch constant text[][] := array[
    -- 1. variable
    array[
      $a$  v_pos int := 0;
begin$a$,
      $b$  v_pos int := 0;
  v_receipt text := nullif(btrim(v_f ->> 'territorial_receipt'), '');
begin$b$
    ],
    -- 2. vérification avant création
    array[
      $a$    insert into public.reports ($a$,
      $b$    if v_receipt is not null and exists (
         select 1 from public.reports r
         where lower(r.territorial_receipt) = lower(v_receipt) and r.id is distinct from v_src
       ) then
      raise exception 'Ce numéro de reçu territorial est déjà utilisé par une autre fiche.' using errcode = 'PT422';
    end if;

    insert into public.reports ($b$
    ],
    -- 3. colonnes de création
    array[
      $a$      intake_source, status, created_by, device_record_id, corrected_from
    ) values ($a$,
      $b$      intake_source, status, created_by, device_record_id, corrected_from, territorial_receipt
    ) values ($b$
    ],
    -- 4. valeurs de création
    array[
      $a$      'draft', v_uid, v_dev, v_src
    ) returning * into v_rep;$a$,
      $b$      'draft', v_uid, v_dev, v_src, v_receipt
    ) returning * into v_rep;$b$
    ],
    -- 5. vérification avant modification
    array[
      $a$    if v_changed then
      update public.reports set$a$,
      $b$    if v_changed and v_f ? 'territorial_receipt' and v_receipt is not null and exists (
         select 1 from public.reports r
         where lower(r.territorial_receipt) = lower(v_receipt)
           and r.id is distinct from v_rep.id and r.id is distinct from v_rep.corrected_from
       ) then
      raise exception 'Ce numéro de reçu territorial est déjà utilisé par une autre fiche.' using errcode = 'PT422';
    end if;
    if v_changed then
      update public.reports set$b$
    ],
    -- 6. modification
    array[
      $a$        observations = case when v_f ? 'observations' then nullif(btrim(v_f ->> 'observations'), '') else observations end
      where id = v_rep.id$a$,
      $b$        observations = case when v_f ? 'observations' then nullif(btrim(v_f ->> 'observations'), '') else observations end,
        territorial_receipt = case when v_f ? 'territorial_receipt' then nullif(btrim(v_f ->> 'territorial_receipt'), '') else territorial_receipt end
      where id = v_rep.id$b$
    ]
  ];
  i int;
  n int;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'save_report';
  if v_oid is null then raise exception 'Fonction public.save_report introuvable.'; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(procedure_marker in v_def) > 0 then
    raise exception 'save_report contient déjà la gestion du reçu territorial : migration déjà appliquée ?';
  end if;
  for i in 1 .. array_length(function_patch, 1) loop
    n := (length(v_def) - length(replace(v_def, function_patch[i][1], ''))) / length(function_patch[i][1]);
    if n <> 1 then
      raise exception 'Repère % de save_report trouvé % fois (attendu : 1). Aucune modification faite.', i, n;
    end if;
    v_def := replace(v_def, function_patch[i][1], function_patch[i][2]);
  end loop;
  execute v_def;
end
$mig$;
