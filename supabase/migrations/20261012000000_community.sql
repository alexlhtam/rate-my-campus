-- Rate My Campus community storage. Timestamps are Unix epoch milliseconds.
-- The server connects as the database owner; RLS with no policies keeps these
-- tables out of reach of the public Data API (anon and authenticated keys).

create table public.profiles (
  user_id text primary key,
  email text not null,
  verified_at bigint not null,
  created_at bigint not null
);
create unique index profiles_email_unique on public.profiles (email);

create table public.rate_limits (
  key text primary key,
  count integer not null default 1,
  expires_at bigint not null
);

create table public.reviews (
  id text primary key,
  user_id text not null,
  place_id text not null,
  rating double precision not null,
  criteria text not null,
  tags text not null,
  text text not null,
  term text not null,
  recommend integer not null,
  status text not null default 'pending',
  moderation_reason text,
  created_at bigint not null
);
create unique index reviews_user_place on public.reviews (user_id, place_id);
create index reviews_status_created on public.reviews (status, created_at);

create table public.posts (
  id text primary key,
  user_id text not null,
  type text not null,
  title text not null,
  description text not null,
  location text not null,
  lat double precision not null,
  lng double precision not null,
  expires_at bigint not null,
  starts_at bigint,
  source_url text,
  source_name text,
  dietary text not null,
  photo_key text,
  price double precision,
  original_price double precision,
  status text not null default 'pending',
  moderation_reason text,
  created_at bigint not null
);
create index posts_status_expiry on public.posts (status, expires_at);
create unique index posts_source_url_unique on public.posts (source_url);

create table public.threads (
  id text primary key,
  user_id text not null,
  place_id text not null,
  title text not null,
  text text not null,
  status text not null default 'pending',
  moderation_reason text,
  created_at bigint not null
);
create index threads_place on public.threads (place_id);

create table public.replies (
  id text primary key,
  user_id text not null,
  thread_id text not null,
  text text not null,
  status text not null default 'pending',
  moderation_reason text,
  created_at bigint not null
);
create index replies_thread on public.replies (thread_id);

create table public.votes (
  id text primary key,
  user_id text not null,
  target_id text not null,
  kind text not null,
  created_at bigint not null
);
create unique index votes_user_target on public.votes (user_id, target_id);
create index votes_target on public.votes (target_id);

create table public.reports (
  id text primary key,
  user_id text not null,
  target_id text not null,
  reason text not null,
  created_at bigint not null
);
create unique index reports_user_target on public.reports (user_id, target_id);

create table public.photos (
  key text primary key,
  user_id text not null,
  mime text not null,
  bytes integer not null,
  created_at bigint not null
);

alter table public.profiles enable row level security;
alter table public.rate_limits enable row level security;
alter table public.reviews enable row level security;
alter table public.posts enable row level security;
alter table public.threads enable row level security;
alter table public.replies enable row level security;
alter table public.votes enable row level security;
alter table public.reports enable row level security;
alter table public.photos enable row level security;

-- Private bucket: photos are served only through /api/community/photo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
