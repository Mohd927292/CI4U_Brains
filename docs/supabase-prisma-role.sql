-- Run this manually in the Supabase SQL Editor if you want a dedicated
-- Prisma database user instead of using the project postgres user.
--
-- Replace <strong-generated-password> before running.
-- Do not commit the real password anywhere.

create user "prisma" with password '<strong-generated-password>' bypassrls createdb;

grant "prisma" to "postgres";

grant usage on schema public to prisma;
grant create on schema public to prisma;
grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;

alter default privileges for role postgres in schema public grant all on tables to prisma;
alter default privileges for role postgres in schema public grant all on routines to prisma;
alter default privileges for role postgres in schema public grant all on sequences to prisma;
