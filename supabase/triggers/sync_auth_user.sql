-- Idempotent: safe to re-run.
-- Apply manually in the Supabase SQL editor for each environment (dev/staging/prod).
-- This is NOT a Prisma migration — do not run via prisma migrate.
-- Mirrors auth.users -> public."User" on signup.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public."User" (id, email, name, role, "createdAt")
  values (
    new.id::text,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', null),
    'CUSTOMER',
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();
