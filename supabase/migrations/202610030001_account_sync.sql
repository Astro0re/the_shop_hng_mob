-- Shared signed-in basket and saved finds for the web and mobile clients.
-- Run after supabase/schema.sql in the Supabase SQL editor.

create table if not exists public.basket_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  in_basket boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists basket_items_listing_idx on public.basket_items (listing_id);
create index if not exists basket_items_user_updated_idx on public.basket_items (user_id, updated_at desc);

create table if not exists public.saved_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists saved_items_listing_idx on public.saved_items (listing_id);

create or replace function public.set_basket_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists basket_items_updated_at on public.basket_items;
create trigger basket_items_updated_at
  before update on public.basket_items
  for each row execute function public.set_basket_item_updated_at();

alter table public.basket_items enable row level security;
alter table public.saved_items enable row level security;

drop policy if exists "Users can view their basket rows" on public.basket_items;
create policy "Users can view their basket rows"
  on public.basket_items for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add to their basket" on public.basket_items;
create policy "Users can add to their basket"
  on public.basket_items for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their basket rows" on public.basket_items;
create policy "Users can update their basket rows"
  on public.basket_items for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can view their saved rows" on public.saved_items;
create policy "Users can view their saved rows"
  on public.saved_items for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can save listings for themselves" on public.saved_items;
create policy "Users can save listings for themselves"
  on public.saved_items for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their saved listings" on public.saved_items;
create policy "Users can remove their saved listings"
  on public.saved_items for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update on public.basket_items to authenticated;
grant select, insert, delete on public.saved_items to authenticated;

-- Realtime is optional. Add the tables if this project's default publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'basket_items'
    ) then
      alter publication supabase_realtime add table public.basket_items;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'saved_items'
    ) then
      alter publication supabase_realtime add table public.saved_items;
    end if;
  end if;
end;
$$;
