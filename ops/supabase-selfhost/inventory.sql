\pset tuples_only on
\pset format unaligned

select 'postgres_version|' || current_setting('server_version');
select 'database_bytes|' || pg_database_size(current_database());
select 'auth_users|' || count(*) from auth.users;
select 'auth_identities|' || count(*) from auth.identities;
select 'storage_buckets|' || count(*) from storage.buckets;
select 'storage_objects|' || count(*) from storage.objects;
select 'migrations|' || count(*) from supabase_migrations.schema_migrations;
select 'user_triggers|' || count(*)
from pg_trigger
where not tgisinternal;
select 'rls_policies|' || count(*) from pg_policies;
select 'publications|' || count(*) from pg_publication;

select 'schema_tables|' || schemaname || '|' || count(*)
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
group by schemaname
order by schemaname;

select 'extension|' || extname || '|' || extversion
from pg_extension
order by extname;

select 'publication_table|' || pubname || '|' || schemaname || '|' || tablename
from pg_publication_tables
order by pubname, schemaname, tablename;
