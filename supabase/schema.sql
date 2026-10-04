-- Run this in the Supabase SQL editor for a new project.
create extension if not exists pgcrypto;

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  category text not null check (category in ('Furniture', 'Electronics', 'Home & living', 'Clothing', 'Books & hobbies')),
  price integer not null check (price > 0),
  condition text not null check (condition in ('Pre-loved', 'Like new', 'Good', 'Well-loved')),
  location text not null check (char_length(location) between 1 and 100),
  image text check (image is null or char_length(image) <= 2048),
  description text not null default '' check (char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'sold', 'removed')),
  created_at timestamptz not null default now()
);

create index if not exists listings_active_created_idx on public.listings (status, created_at desc);
create index if not exists listings_seller_idx on public.listings (seller_id);

alter table public.listings enable row level security;

create policy "Anyone can view active listings"
  on public.listings for select
  using (status = 'active' or (auth.uid() = seller_id));

create policy "Signed-in users can create listings as themselves"
  on public.listings for insert to authenticated
  with check (auth.uid() = seller_id);

create policy "Sellers can update their own listings"
  on public.listings for update to authenticated
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

create policy "Sellers can remove their own listings"
  on public.listings for delete to authenticated
  using (auth.uid() = seller_id);

grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
