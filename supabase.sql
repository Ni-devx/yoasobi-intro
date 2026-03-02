-- Supabase setup for YOASOBI Intro RTA
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.songs (
  id text primary key,
  title_ja text not null,
  title_en text not null,
  video_id text not null,
  answers_normalized text[] not null
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  song_id text not null references public.songs(id),
  mode text not null check (mode in ('intro', 'random')),
  started_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  song_id text references public.songs(id),
  mode text not null check (mode in ('intro', 'random')),
  time_ms integer not null check (time_ms between 1 and 10000),
  display_name text not null default 'Anonymous',
  created_at timestamptz not null default now()
);

alter table public.songs enable row level security;
alter table public.attempts enable row level security;
alter table public.scores enable row level security;

create policy "songs_read" on public.songs
  for select
  using (true);

create policy "scores_read" on public.scores
  for select
  using (true);

-- Leaderboard view with ranking numbers (Top 30 only)
create or replace view public.leaderboard as
select * from (
  select
    row_number() over (partition by mode, song_id order by time_ms asc, created_at asc) as rank,
    mode,
    song_id,
    time_ms,
    display_name
  from public.scores
) ranked
where rank <= 30;

grant select on public.leaderboard to anon, authenticated;

create or replace function public.trim_leaderboard(p_mode text, p_song_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      id,
      row_number() over (order by time_ms asc, created_at asc) as rn
    from public.scores
    where mode = p_mode
      and ((p_song_id is null and song_id is null) or song_id = p_song_id)
  )
  delete from public.scores
  where id in (select id from ranked where rn > 30);
end;
$$;

create or replace function public.start_attempt(p_song_id text, p_mode text)
returns table (attempt_id uuid, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mode not in ('intro', 'random') then
    raise exception 'invalid mode';
  end if;

  insert into public.attempts (song_id, mode)
  values (p_song_id, p_mode)
  returning id, started_at into attempt_id, started_at;

  return next;
end;
$$;

create or replace function public.finish_attempt(
  p_attempt_id uuid,
  p_answer_norm text,
  p_display_name text
)
returns table (status text, time_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt record;
  v_elapsed_ms integer;
  v_correct boolean;
  v_name text;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    return query select 'invalid_attempt', null;
    return;
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_attempt.started_at)) * 1000);
  if v_elapsed_ms < 1 then
    v_elapsed_ms := 1;
  end if;

  if v_elapsed_ms > 10000 then
    return query select 'timeout', null;
    return;
  end if;

  select (p_answer_norm = any(answers_normalized))
    into v_correct
  from public.songs
  where id = v_attempt.song_id;

  if not v_correct then
    return query select 'wrong', null;
    return;
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), 'Anonymous');

  insert into public.scores (song_id, mode, time_ms, display_name)
  values
    (v_attempt.song_id, v_attempt.mode, v_elapsed_ms, v_name),
    (null, v_attempt.mode, v_elapsed_ms, v_name);

  perform public.trim_leaderboard(v_attempt.mode, v_attempt.song_id);
  perform public.trim_leaderboard(v_attempt.mode, null);

  delete from public.attempts where id = v_attempt.id;

  return query select 'ok', v_elapsed_ms;
end;
$$;

grant execute on function public.start_attempt(text, text) to anon, authenticated;
grant execute on function public.finish_attempt(uuid, text, text) to anon, authenticated;
