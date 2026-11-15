-- Retire TOUTES les données fictives ajoutées par tools/donnees-demo.sql (repère : device_record_id 'demo-%').
-- Les fiches réelles ne sont pas touchées. Puis la numérotation reprend après la dernière fiche réelle.
with d as (select id from public.reports where device_record_id like 'demo-%'),
     a as (delete from public.report_officiants where report_id in (select id from d)),
     b as (delete from public.report_controls where report_id in (select id from d)),
     c as (delete from public.report_validations where report_id in (select id from d)),
     e as (delete from public.audit_log where entity_type = 'report' and entity_id in (select id::text from d))
delete from public.reports where id in (select id from d);

select setval(pg_get_serial_sequence('public.reports', 'report_number'),
              (select coalesce(max(report_number), 1) from public.reports));
