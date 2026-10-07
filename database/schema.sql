-- Apply this file in the Supabase SQL Editor before using AgriVaanix.
-- Every row is owned by a Supabase Auth user and protected by RLS.

create table if not exists public.farm_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  region text not null default '',
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'hi', 'te')),
  land_area numeric not null default 0 check (land_area >= 0),
  land_unit text not null default 'acres'
    check (land_unit in ('acres', 'hectares')),
  irrigation_source text not null default '',
  soil_type text not null default '',
  soil_ph numeric check (soil_ph is null or (soil_ph >= 0 and soil_ph <= 14)),
  primary_crops text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  domain text not null default 'general'
    check (domain in (
      'crop_planning',
      'pest_diagnosis',
      'weather_irrigation',
      'soil_fertilizer',
      'government_schemes',
      'market_prices',
      'general'
    )),
  language text not null default 'en',
  action_items text[] not null default '{}',
  safety_notes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists messages_user_role_idx
  on public.messages (user_id, role);

alter table public.farm_profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "farm_profiles_owner_all" on public.farm_profiles;
create policy "farm_profiles_owner_all"
  on public.farm_profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conversations_owner_all" on public.conversations;
create policy "conversations_owner_all"
  on public.conversations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "messages_owner_all" on public.messages;
create policy "messages_owner_all"
  on public.messages
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );
