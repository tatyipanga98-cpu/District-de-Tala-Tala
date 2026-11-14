-- Export des définitions réellement en production (à exécuter dans l'éditeur SQL Supabase, lecture seule).
-- Sert à vérifier que la base correspond aux fichiers du dossier migrations/.
select 'fonction' as type, p.proname as nom, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('save_report', 'review_report', 'mark_password_changed')
union all
select 'politique', tablename || '.' || policyname, coalesce(qual, '') || ' | verif: ' || coalesce(with_check, '') || ' | ' || cmd
from pg_policies where schemaname = 'public'
order by 1, 2;
