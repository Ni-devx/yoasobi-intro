-- Supabase setup for YOASOBI Intro RTA
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- Songs (source of truth for server-side answer validation)
create table if not exists public.songs (
  id text primary key,
  title_ja text not null,
  title_en text not null,
  video_id text not null,
  answers_normalized text[] not null
);

-- Single-song attempts (1曲ランキング用)
create table if not exists public.single_attempts (
  id uuid primary key default gen_random_uuid(),
  song_id text not null references public.songs(id),
  mode text not null check (mode in ('intro', 'random')),
  start_sec integer not null default 0,
  started_at timestamptz not null default now()
);

-- Marathon run master (全曲ランキング用)
create table if not exists public.marathon_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('intro', 'random')),
  song_order text[] not null,
  total_songs integer not null,
  current_pos integer not null default 1,
  display_name text not null default 'Anonymous',
  status text not null default 'in_progress'
    check (status in ('in_progress', 'failed', 'completed')),
  started_at timestamptz not null default now()
);

-- Per-song attempts inside a marathon run
create table if not exists public.marathon_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marathon_runs(id) on delete cascade,
  song_id text not null references public.songs(id),
  song_pos integer not null,
  mode text not null check (mode in ('intro', 'random')),
  start_sec integer not null default 0,
  started_at timestamptz not null default now()
);

-- Per-song splits for marathon (time per song)
create table if not exists public.marathon_splits (
  run_id uuid not null references public.marathon_runs(id) on delete cascade,
  song_pos integer not null,
  song_id text not null references public.songs(id),
  time_ms integer not null check (time_ms between 1 and 10000),
  created_at timestamptz not null default now(),
  primary key (run_id, song_pos)
);

-- Scores (single-song + marathon)
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('single', 'marathon')),
  mode text not null check (mode in ('intro', 'random')),
  song_id text references public.songs(id),
  time_ms integer not null,
  display_name text not null default 'Anonymous',
  created_at timestamptz not null default now(),
  check (
    (scope = 'single' and song_id is not null and time_ms between 1 and 10000)
    or
    (scope = 'marathon' and song_id is null and time_ms >= 1)
  )
);

alter table public.songs enable row level security;
alter table public.single_attempts enable row level security;
alter table public.marathon_runs enable row level security;
alter table public.marathon_attempts enable row level security;
alter table public.marathon_splits enable row level security;
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
    row_number() over (partition by scope, mode, song_id order by time_ms asc, created_at asc) as rank,
    scope,
    mode,
    song_id,
    time_ms,
    display_name
  from public.scores
) ranked
where rank <= 30;

grant select on public.leaderboard to anon, authenticated;

create or replace function public.trim_leaderboard(
  p_scope text,
  p_mode text,
  p_song_id text
)
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
    where scope = p_scope
      and mode = p_mode
      and ((p_song_id is null and song_id is null) or song_id = p_song_id)
  )
  delete from public.scores
  where id in (select id from ranked where rn > 30);
end;
$$;

-- Draw a random song for single mode
create or replace function public.draw_single_song()
returns table (song_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  select id into song_id from public.songs order by random() limit 1;
  if song_id is null then
    raise exception 'no songs';
  end if;
  return next;
end;
$$;

-- Single song start (server time 기준)
create or replace function public.start_single(
  p_song_id text,
  p_mode text,
  p_max_start_sec integer
)
returns table (attempt_id uuid, started_at timestamptz, start_sec integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_sec integer;
  v_max integer;
begin
  if p_mode not in ('intro', 'random') then
    raise exception 'invalid mode';
  end if;
  if not exists (select 1 from public.songs where id = p_song_id) then
    raise exception 'invalid song';
  end if;

  if p_mode = 'intro' then
    v_start_sec := 0;
  else
    v_max := greatest(coalesce(p_max_start_sec, 0), 0);
    v_start_sec := floor(random() * (v_max + 1))::int;
  end if;

  insert into public.single_attempts (song_id, mode, start_sec)
  values (p_song_id, p_mode, v_start_sec)
  returning id, started_at into attempt_id, started_at;

  start_sec := v_start_sec;
  return next;
end;
$$;

-- Single song finish
create or replace function public.finish_single(
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
  select * into v_attempt from public.single_attempts where id = p_attempt_id;
  if not found then
    return query select 'invalid_attempt', null;
    return;
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_attempt.started_at)) * 1000);
  if v_elapsed_ms < 1 then
    v_elapsed_ms := 1;
  end if;

  if v_elapsed_ms > 10000 then
    delete from public.single_attempts where id = v_attempt.id;
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

  insert into public.scores (scope, mode, song_id, time_ms, display_name)
  values ('single', v_attempt.mode, v_attempt.song_id, v_elapsed_ms, v_name);

  perform public.trim_leaderboard('single', v_attempt.mode, v_attempt.song_id);

  delete from public.single_attempts where id = v_attempt.id;

  return query select 'ok', v_elapsed_ms;
end;
$$;

-- Marathon start (create run + shuffled order)
create or replace function public.start_marathon(
  p_mode text,
  p_display_name text
)
returns table (run_id uuid, total_songs integer, current_position integer, song_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_song_order text[];
  v_total integer;
  v_name text;
begin
  if p_mode not in ('intro', 'random') then
    raise exception 'invalid mode';
  end if;

  select array_agg(id order by random()) into v_song_order from public.songs;
  v_total := coalesce(array_length(v_song_order, 1), 0);
  if v_total = 0 then
    raise exception 'no songs';
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), 'Anonymous');

  insert into public.marathon_runs (mode, song_order, total_songs, display_name)
  values (p_mode, v_song_order, v_total, v_name)
  returning id into run_id;

  total_songs := v_total;
  current_position := 1;
  song_id := v_song_order[1];
  return next;
end;
$$;

-- Start a song inside a marathon run (server time 기준)
create or replace function public.start_marathon_song(
  p_run_id uuid,
  p_max_start_sec integer
)
returns table (attempt_id uuid, started_at timestamptz, song_id text, start_sec integer, song_pos integer, total_songs integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.marathon_runs%rowtype;
  v_song_id text;
  v_start_sec integer;
  v_max integer;
begin
  select * into v_run from public.marathon_runs where id = p_run_id;
  if not found then
    raise exception 'invalid run';
  end if;
  if v_run.status <> 'in_progress' then
    raise exception 'run not active';
  end if;

  v_song_id := v_run.song_order[v_run.current_pos];
  if v_song_id is null then
    raise exception 'invalid position';
  end if;

  if v_run.mode = 'intro' then
    v_start_sec := 0;
  else
    v_max := greatest(coalesce(p_max_start_sec, 0), 0);
    v_start_sec := floor(random() * (v_max + 1))::int;
  end if;

  insert into public.marathon_attempts (run_id, song_id, song_pos, mode, start_sec)
  values (v_run.id, v_song_id, v_run.current_pos, v_run.mode, v_start_sec)
  returning id, started_at into attempt_id, started_at;

  song_id := v_song_id;
  start_sec := v_start_sec;
  song_pos := v_run.current_pos;
  total_songs := v_run.total_songs;
  return next;
end;
$$;

-- Finish a song inside a marathon run
create or replace function public.finish_marathon_song(
  p_attempt_id uuid,
  p_answer_norm text
)
returns table (status text, time_ms integer, next_song_id text, next_song_pos integer, total_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt record;
  v_elapsed_ms integer;
  v_correct boolean;
  v_next_pos integer;
  v_total_ms integer;
begin
  select
    a.*,
    r.mode as run_mode,
    r.song_order,
    r.total_songs,
    r.display_name,
    r.status as run_status
  into v_attempt
  from public.marathon_attempts a
  join public.marathon_runs r on r.id = a.run_id
  where a.id = p_attempt_id;

  if not found then
    return query select 'invalid_attempt', null, null, null, null;
    return;
  end if;

  if v_attempt.run_status <> 'in_progress' then
    return query select 'run_not_active', null, null, null, null;
    return;
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_attempt.started_at)) * 1000);
  if v_elapsed_ms < 1 then
    v_elapsed_ms := 1;
  end if;

  if v_elapsed_ms > 10000 then
    update public.marathon_runs set status = 'failed' where id = v_attempt.run_id;
    delete from public.marathon_attempts where id = v_attempt.id;
    return query select 'timeout', null, null, null, null;
    return;
  end if;

  select (p_answer_norm = any(answers_normalized))
    into v_correct
  from public.songs
  where id = v_attempt.song_id;

  if not v_correct then
    return query select 'wrong', null, null, null, null;
    return;
  end if;

  insert into public.marathon_splits (run_id, song_pos, song_id, time_ms)
  values (v_attempt.run_id, v_attempt.song_pos, v_attempt.song_id, v_elapsed_ms)
  on conflict do nothing;

  delete from public.marathon_attempts where id = v_attempt.id;

  v_next_pos := v_attempt.song_pos + 1;

  if v_next_pos > v_attempt.total_songs then
    select coalesce(sum(time_ms), 0) into v_total_ms
    from public.marathon_splits
    where run_id = v_attempt.run_id;

    insert into public.scores (scope, mode, song_id, time_ms, display_name)
    values ('marathon', v_attempt.run_mode, null, v_total_ms, v_attempt.display_name);

    perform public.trim_leaderboard('marathon', v_attempt.run_mode, null);

    update public.marathon_runs
      set status = 'completed', current_pos = v_next_pos
      where id = v_attempt.run_id;

    return query select 'completed', v_elapsed_ms, null, null, v_total_ms;
    return;
  end if;

  update public.marathon_runs set current_pos = v_next_pos where id = v_attempt.run_id;

  return query select 'next', v_elapsed_ms, v_attempt.song_order[v_next_pos], v_next_pos, null;
end;
$$;

grant execute on function public.draw_single_song() to anon, authenticated;
grant execute on function public.start_single(text, text, integer) to anon, authenticated;
grant execute on function public.finish_single(uuid, text, text) to anon, authenticated;
grant execute on function public.start_marathon(text, text) to anon, authenticated;
grant execute on function public.start_marathon_song(uuid, integer) to anon, authenticated;
grant execute on function public.finish_marathon_song(uuid, text) to anon, authenticated;
