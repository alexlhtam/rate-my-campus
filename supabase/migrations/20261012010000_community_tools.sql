-- Community tools; private support requests are never served by the public Data API.
alter table public.posts add column collection_instructions text not null default '';
alter table public.posts add column portions_remaining integer check (portions_remaining between 0 and 10000);
alter table public.photos add column content_hash text;
create index photos_content_hash on public.photos(content_hash);
create index reviews_place_status on public.reviews(place_id, status, created_at);
create index posts_active_duplicates on public.posts(lower(title), lower(location), expires_at);

create table public.community_requests (
  id text primary key,
  kind text not null check (kind in ('correction', 'takedown')),
  user_id text,
  contact text,
  target_id text not null,
  reason text not null,
  evidence_url text,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  moderator_note text,
  created_at bigint not null,
  resolved_at bigint
);
create index community_requests_queue on public.community_requests(status, created_at);
alter table public.community_requests enable row level security;

create table public.community_preferences (
  user_id text primary key,
  collections text not null default '[]',
  follows text not null default '[]',
  inbox_read_at bigint not null default 0,
  -- At most 500 explicitly seen contribution revisions, independent of draft dates.
  inbox_seen_ids text not null default '[]',
  updated_at bigint not null
);
alter table public.community_preferences enable row level security;

alter table public.reviews add column moderation_revision integer not null default 0;
alter table public.posts add column moderation_revision integer not null default 0;
alter table public.threads add column moderation_revision integer not null default 0;
alter table public.replies add column moderation_revision integer not null default 0;
create table public.moderation_retries (
  target_id text primary key,
  kind text not null check (kind in ('review', 'post', 'thread', 'reply')),
  revision integer not null,
  attempts integer not null default 0,
  next_attempt_at bigint not null,
  lease_until bigint
);
create index moderation_retries_due on public.moderation_retries(next_attempt_at);
alter table public.moderation_retries enable row level security;
