-- ============================================================
-- YOASOBI Intro RTA — Supabase setup (simplified)
-- ⚠ 初回または完全リセット時にそのまま実行してください
--   songs / scores に既存データがある場合は事前にバックアップを
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 旧テーブル・関数の削除（冪等に実行できるよう cascade）
-- ------------------------------------------------------------
drop function if exists public.draw_single_song()                     cascade;
drop function if exists public.start_single(text,text,integer)        cascade;
drop function if exists public.finish_single(uuid,text,text)          cascade;
drop function if exists public.start_marathon(text,text)              cascade;
drop function if exists public.start_marathon(text)                   cascade;
drop function if exists public.start_marathon_song(uuid,text,integer) cascade;
drop function if exists public.finish_marathon_song(uuid,text)        cascade;
drop function if exists public.submit_score(uuid,text)                cascade;
drop function if exists public.trim_leaderboard(text,text,text)       cascade;
drop view   if exists public.leaderboard                              cascade;

drop table if exists public.pending_scores    cascade;
drop table if exists public.marathon_splits   cascade;
drop table if exists public.marathon_attempts cascade;
drop table if exists public.single_attempts   cascade;
drop table if exists public.scores            cascade;
drop table if exists public.marathon_runs     cascade;
-- songs を残す場合は次の行をコメントアウト
drop table if exists public.songs             cascade;

-- ============================================================
-- テーブル (4つ)
-- ============================================================

-- 曲マスタ
create table public.songs (
  id                 text    primary key,
  title_ja           text    not null,
  title_en           text    not null,
  video_id           text    not null,
  answers_normalized text[]  not null
);

-- マラソンランの状態管理
-- total_ms_so_far: 旧 marathon_splits の代替。正解するたびに加算。
create table public.marathon_runs (
  id              uuid        primary key default gen_random_uuid(),
  mode            text        not null check (mode in ('intro','random')),
  song_order      text[]      not null,
  total_songs     integer     not null,
  current_pos     integer     not null default 1,
  total_ms_so_far integer     not null default 0,
  status          text        not null default 'in_progress'
                              check (status in ('in_progress','failed','completed')),
  started_at      timestamptz not null default now()
);

-- 計測中アテンプト (single / marathon 両用)
-- 旧 single_attempts + marathon_attempts を統合
create table public.attempts (
  id         uuid        primary key default gen_random_uuid(),
  song_id    text        not null references public.songs(id),
  mode       text        not null check (mode in ('intro','random')),
  scope      text        not null check (scope in ('single','marathon')),
  run_id     uuid        references public.marathon_runs(id) on delete cascade,
  song_pos   integer,                         -- marathon のみ使用
  start_sec  integer     not null default 0,
  started_at timestamptz not null default now()
);

-- スコア (旧 scores + pending_scores を統合)
-- confirmed=false: 名前入力待ち / confirmed=true: ランキング掲載済み
create table public.scores (
  id           uuid        primary key default gen_random_uuid(),
  scope        text        not null check (scope in ('single','marathon')),
  mode         text        not null check (mode in ('intro','random')),
  song_id      text        references public.songs(id),
  time_ms      integer     not null,
  display_name text        not null default 'Anonymous',
  confirmed    boolean     not null default false,
  created_at   timestamptz not null default now(),
  check (
    (scope = 'single'   and song_id is not null and time_ms between 1 and 10000)
    or
    (scope = 'marathon' and song_id is null     and time_ms >= 1)
  )
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.songs         enable row level security;
alter table public.marathon_runs enable row level security;
alter table public.attempts      enable row level security;
alter table public.scores        enable row level security;

create policy "songs_read"  on public.songs  for select using (true);
create policy "scores_read" on public.scores for select using (true);

-- ============================================================
-- ランキングビュー (confirmed のみ・Top 30)
-- ============================================================
create or replace view public.leaderboard as
select * from (
  select
    row_number() over (
      partition by scope, mode, song_id
      order by time_ms asc, created_at asc
    ) as rank,
    scope, mode, song_id, time_ms, display_name
  from public.scores
  where confirmed = true
) ranked
where rank <= 30;

grant select on public.leaderboard to anon, authenticated;

-- ============================================================
-- 関数 (4つ)
-- ============================================================

-- ------------------------------------------------------------
-- start_attempt: シングル・マラソン共通の計測開始
--   p_run_id = null   → シングルモード
--   p_run_id = <uuid> → マラソンモード
-- ------------------------------------------------------------
create or replace function public.start_attempt(
  p_song_id       text,
  p_mode          text,
  p_run_id        uuid    default null,
  p_max_start_sec integer default 0
)
returns table (attempt_id uuid, start_sec integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_scope     text;
  v_song_pos  integer;
  v_start_sec integer;
  v_run       public.marathon_runs%rowtype;
  v_id        uuid;
begin
  if p_mode not in ('intro','random') then raise exception 'invalid mode'; end if;
  if not exists (select 1 from public.songs where id = p_song_id) then
    raise exception 'invalid song';
  end if;

  if p_run_id is null then
    v_scope    := 'single';
    v_song_pos := null;
  else
    select * into v_run from public.marathon_runs where id = p_run_id;
    if not found                                        then raise exception 'invalid run';    end if;
    if v_run.status <> 'in_progress'                    then raise exception 'run not active'; end if;
    if v_run.song_order[v_run.current_pos] <> p_song_id then raise exception 'song mismatch'; end if;
    v_scope    := 'marathon';
    v_song_pos := v_run.current_pos;
  end if;

  v_start_sec := case
    when p_mode = 'intro' then 0
    else floor(random() * (greatest(coalesce(p_max_start_sec,0), 0) + 1))::integer
  end;

  insert into public.attempts (song_id, mode, scope, run_id, song_pos, start_sec)
  values (p_song_id, p_mode, v_scope, p_run_id, v_song_pos, v_start_sec)
  returning id into v_id;

  attempt_id := v_id;
  start_sec  := v_start_sec;
  return next;
end;
$$;

-- ------------------------------------------------------------
-- start_marathon: マラソンラン開始（曲順シャッフル）
-- ------------------------------------------------------------
create or replace function public.start_marathon(p_mode text)
returns table (run_id uuid, total_songs integer, current_position integer, song_id text)
language plpgsql security definer set search_path = public
as $$
declare
  v_song_order text[];
  v_total      integer;
  v_run_id     uuid;
begin
  if p_mode not in ('intro','random') then raise exception 'invalid mode'; end if;
  select array_agg(id order by random()) into v_song_order from public.songs;
  v_total := coalesce(array_length(v_song_order,1), 0);
  if v_total = 0 then raise exception 'no songs'; end if;

  insert into public.marathon_runs (mode, song_order, total_songs)
  values (p_mode, v_song_order, v_total)
  returning id into v_run_id;

  run_id           := v_run_id;
  total_songs      := v_total;
  current_position := 1;
  song_id          := v_song_order[1];
  return next;
end;
$$;

-- ------------------------------------------------------------
-- submit_score: 名前入力でスコアを確定 (confirmed=false → true)
-- ------------------------------------------------------------
create or replace function public.submit_score(p_score_id uuid, p_display_name text)
returns table (status text)
language plpgsql security definer set search_path = public
as $$
declare
  v_score public.scores%rowtype;
begin
  select * into v_score from public.scores where id = p_score_id and confirmed = false;
  if not found then
    return query select 'invalid_score'::text;
    return;
  end if;

  update public.scores
  set display_name = coalesce(nullif(trim(p_display_name),''), 'Anonymous'),
      confirmed    = true
  where id = p_score_id;

  -- Top30 超えスコアを削除
  delete from public.scores
  where id in (
    select id from (
      select id,
        row_number() over (
          partition by scope, mode, song_id
          order by time_ms asc, created_at asc
        ) as rn
      from public.scores
      where scope = v_score.scope and mode = v_score.mode
        and (song_id = v_score.song_id or (song_id is null and v_score.song_id is null))
        and confirmed = true
    ) ranked
    where rn > 30
  );

  return query select 'ok'::text;
end;
$$;

-- ============================================================
-- 権限付与
-- ============================================================
grant execute on function public.start_attempt(text,text,uuid,integer) to anon, authenticated;
grant execute on function public.finish_attempt(uuid,text)             to anon, authenticated;
grant execute on function public.start_marathon(text)                  to anon, authenticated;
grant execute on function public.submit_score(uuid,text)               to anon, authenticated;

-- ============================================================
-- finish_attempt の再構築
-- タイム計測をクライアント側に移管し、広告時間を除外可能にする
-- また "column reference time_ms is ambiguous" (42702) を修正
-- ============================================================

-- ------------------------------------------------------------
-- finish_attempt: シングル・マラソン共通の回答処理
--   p_time_ms: クライアント計測タイム（広告時間除外済み・ミリ秒）
--
--   返値:
--     status        — ok / wrong / invalid_attempt
--                     next (marathon途中) / completed (marathon完走)
--     time_ms       — 今回の曲のタイム（クライアント計測値）
--     next_song_id  — 次曲ID        (marathon:next のみ)
--     next_song_pos — 次曲の位置    (marathon:next のみ)
--     total_ms      — 合計タイム    (marathon:completed のみ)
--     score_id      — Top30入りなら pending スコアID、それ以外 null
-- ------------------------------------------------------------
create or replace function public.finish_attempt(
  p_attempt_id  uuid,
  p_answer_norm text,
  p_time_ms     integer   -- クライアント計測タイム（広告除外済み）
)
returns table (
  status        text,
  song_time_ms  integer,  -- 曲ごとのタイム（"time_ms" との名前衝突を回避）
  next_song_id  text,
  next_song_pos integer,
  total_ms      integer,
  score_id      uuid
)
language plpgsql security definer set search_path = public
as $$
declare
  v_attempt       public.attempts%rowtype;
  v_run           public.marathon_runs%rowtype;
  v_correct       boolean;
  v_next_pos      integer;
  v_total_ms      integer;
  v_30th_ms       integer;
  v_score_id      uuid;
  v_clamped_ms    integer;  -- スコア保存用タイム（1〜10000にクランプ）
begin
  -- アテンプト取得
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    return query select
      'invalid_attempt'::text, null::integer, null::text,
      null::integer, null::integer, null::uuid;
    return;
  end if;

  -- タイム検証（1ms未満は不正、シングルは10秒上限）
  if p_time_ms is null or p_time_ms < 1 then
    return query select
      'invalid_attempt'::text, null::integer, null::text,
      null::integer, null::integer, null::uuid;
    return;
  end if;

  -- シングルはクライアント側で10秒を超えた場合もタイムアウト扱い
  if v_attempt.scope = 'single' and p_time_ms > 10000 then
    delete from public.attempts where id = p_attempt_id;
    return query select
      'wrong'::text, null::integer, null::text,
      null::integer, null::integer, null::uuid;
    return;
  end if;

  -- スコア保存用タイムをクランプ（念のため上限保護）
  v_clamped_ms := greatest(1, least(p_time_ms, 10000));

  -- 回答検証
  select (p_answer_norm = any(s.answers_normalized))
  into v_correct
  from public.songs s
  where s.id = v_attempt.song_id;

  if not v_correct then
    if v_attempt.scope = 'marathon' then
      update public.marathon_runs
      set status = 'failed'
      where id = v_attempt.run_id;
    end if;
    delete from public.attempts where id = p_attempt_id;
    return query select
      'wrong'::text, null::integer, null::text,
      null::integer, null::integer, null::uuid;
    return;
  end if;

  delete from public.attempts where id = p_attempt_id;

  -- ── シングルモード ──────────────────────────────────────
  if v_attempt.scope = 'single' then
    select sc.time_ms into v_30th_ms
    from public.scores sc
    where sc.scope = 'single'
      and sc.mode = v_attempt.mode
      and sc.song_id = v_attempt.song_id
      and sc.confirmed = true
    order by sc.time_ms asc
    limit 1 offset 29;

    if v_30th_ms is null or v_clamped_ms < v_30th_ms then
      insert into public.scores (scope, mode, song_id, time_ms)
      values ('single', v_attempt.mode, v_attempt.song_id, v_clamped_ms)
      returning id into v_score_id;
    end if;

    return query select
      'ok'::text, v_clamped_ms, null::text,
      null::integer, null::integer, v_score_id;
    return;
  end if;

  -- ── マラソンモード ─────────────────────────────────────
  select * into v_run from public.marathon_runs where id = v_attempt.run_id;
  v_next_pos := v_attempt.song_pos + 1;

  if v_next_pos > v_run.total_songs then
    -- 全曲完走
    v_total_ms := v_run.total_ms_so_far + v_clamped_ms;
    update public.marathon_runs
    set status          = 'completed',
        current_pos     = v_next_pos,
        total_ms_so_far = v_total_ms
    where id = v_run.id;

    select sc.time_ms into v_30th_ms
    from public.scores sc
    where sc.scope = 'marathon'
      and sc.mode = v_run.mode
      and sc.song_id is null
      and sc.confirmed = true
    order by sc.time_ms asc
    limit 1 offset 29;

    if v_30th_ms is null or v_total_ms < v_30th_ms then
      insert into public.scores (scope, mode, song_id, time_ms)
      values ('marathon', v_run.mode, null, v_total_ms)
      returning id into v_score_id;
    end if;

    return query select
      'completed'::text, v_clamped_ms, null::text,
      null::integer, v_total_ms, v_score_id;
    return;
  end if;

  -- 途中: 累積タイムと現在位置を更新して次の曲を返す
  update public.marathon_runs
  set current_pos     = v_next_pos,
      total_ms_so_far = total_ms_so_far + v_clamped_ms
  where id = v_run.id;

  return query select
    'next'::text, v_clamped_ms,
    v_run.song_order[v_next_pos], v_next_pos,
    null::integer, null::uuid;
end;
$$;

-- 権限付与（新シグネチャ）
grant execute on function public.finish_attempt(uuid, text, integer) to anon, authenticated;