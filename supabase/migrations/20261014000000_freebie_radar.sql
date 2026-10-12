-- Freebie Radar: resumable private scans and source-grounded public event pins.
create table public.freebie_scans (
  id text primary key, ordinal bigserial unique,
  start_date text not null, end_date text not null, status text not null,
  created_at text not null, updated_at text not null,
  next_page integer not null default 0, exhausted integer not null default 0,
  source_count integer not null default 0, warnings_json text not null default '[]', error text,
  active_slot integer unique check (active_slot = 1), lock_token text, lock_until bigint not null default 0,
  auto_retries integer not null default 0
);
create table public.freebie_tasks (
  id text primary key, ordinal bigserial unique,
  run_id text not null references public.freebie_scans(id) on delete cascade,
  event_id text not null, source_json text not null,
  page_json text, jev_json text, extraction_json text, claude_model text,
  status text not null default 'queued', error text, failed_stage text,
  attempts integer not null default 0, checked_at text,
  published_post_id text, publication_state text,
  unique(run_id, event_id)
);
create index freebie_tasks_queue on public.freebie_tasks(run_id, status, ordinal);
alter table public.freebie_scans enable row level security;
alter table public.freebie_tasks enable row level security;

-- Unknown source venues remain in the list without a fabricated map position.
-- Ordinary student post validation still requires a confirmed location.
alter table public.posts alter column lat drop not null;
alter table public.posts alter column lng drop not null;
alter table public.posts add column source_event_key text;
alter table public.posts add column freebie_json text;
alter table public.posts add column source_checked_at bigint;
alter table public.posts add column source_location_revision integer not null default 0;
create unique index posts_source_event_key on public.posts(source_event_key);
drop index public.posts_source_url_unique;
create unique index posts_manual_source_url_unique on public.posts(source_url) where source_event_key is null;

create table public.freebie_worker (
  id text primary key check (id='union'), lock_token text, lock_until bigint not null default 0
);
insert into public.freebie_worker(id) values('union');
alter table public.freebie_worker enable row level security;
create table public.freebie_venues (
  query text primary key, place_id text, lat double precision, lng double precision,
  expires_at bigint not null, lock_until bigint not null default 0
);
alter table public.freebie_venues enable row level security;
