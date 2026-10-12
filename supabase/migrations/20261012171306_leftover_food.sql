-- Collection metadata is supplied by the poster, never inferred or verified by the app.
alter table public.posts add column food_details text not null default '{}';
alter table public.posts add column closure_reason text check (closure_reason in ('collected', 'ended', 'withdrawn', 'community-gone'));
alter table public.posts add column closed_at bigint;
alter table public.posts add column availability_updated_at bigint;
update public.posts set availability_updated_at = created_at where type = 'food';
create index posts_live_food on public.posts (type, status, expires_at, created_at);
create index votes_recent_availability on public.votes(target_id, kind, created_at);
