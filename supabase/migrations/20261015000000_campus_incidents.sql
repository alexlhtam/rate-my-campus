-- Campus incidents: time-limited safety heads-ups that students corroborate or
-- clear. Timestamps are Unix epoch milliseconds. Votes, reports, photos and
-- moderation retries reuse the existing community tables.
create table public.incidents (
  id text primary key,
  user_id text not null,
  category text not null check (category in ('violence', 'hazard', 'fire', 'medical', 'security', 'protest', 'disruption', 'other')),
  severity text not null check (severity in ('notice', 'warning', 'urgent')),
  title text not null,
  description text not null,
  location text not null,
  lat double precision not null,
  lng double precision not null,
  photo_key text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  moderation_reason text,
  moderation_revision integer not null default 0,
  created_at bigint not null,
  expires_at bigint not null,
  resolved_at bigint,
  resolution text check (resolution in ('reporter', 'community', 'moderator'))
);
create index incidents_live on public.incidents (status, expires_at, created_at);
create index incidents_owner on public.incidents (user_id, created_at);
create index incidents_photo on public.incidents (photo_key);
alter table public.incidents enable row level security;

-- Interrupted Claude checks on incidents join the same durable retry queue.
alter table public.moderation_retries drop constraint moderation_retries_kind_check;
alter table public.moderation_retries add constraint moderation_retries_kind_check check (kind in ('review', 'post', 'thread', 'reply', 'incident'));
