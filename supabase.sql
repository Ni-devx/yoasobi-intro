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

  -- スコア保存用タイムをクランプ
  -- シングルは 1〜10000ms、マラソンは下限 1ms のみ（上限なし）
  -- ※ シングルは既に上の if で 10000ms 超を reject 済みなので実質 greatest(1, p_time_ms)
  v_clamped_ms := case
    when v_attempt.scope = 'single' then greatest(1, least(p_time_ms, 10000))
    else greatest(1, p_time_ms)
  end;

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

grant execute on function public.finish_attempt(uuid, text, integer) to anon, authenticated;
grant execute on function public.submit_score(uuid, text)             to anon, authenticated;

-- ============================================================
-- Flash モード追加 マイグレーション
-- 既存 DB に対して実行してください（データは消えません）
-- ============================================================

-- ------------------------------------------------------------
-- 1. marathon_runs: scope と correct_count 列を追加
-- ------------------------------------------------------------
ALTER TABLE public.marathon_runs
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'marathon',
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.marathon_runs
  DROP CONSTRAINT IF EXISTS marathon_runs_scope_check;
ALTER TABLE public.marathon_runs
  ADD CONSTRAINT marathon_runs_scope_check
    CHECK (scope IN ('marathon', 'flash'));

-- ------------------------------------------------------------
-- 2. attempts: scope に 'flash' を追加
-- ------------------------------------------------------------
ALTER TABLE public.attempts
  DROP CONSTRAINT IF EXISTS attempts_scope_check;
ALTER TABLE public.attempts
  ADD CONSTRAINT attempts_scope_check
    CHECK (scope IN ('single', 'marathon', 'flash'));

-- ------------------------------------------------------------
-- 3. scores: correct_count 列追加 + 制約を更新
-- ------------------------------------------------------------
ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS correct_count integer;

ALTER TABLE public.scores
  DROP CONSTRAINT IF EXISTS scores_scope_check;
ALTER TABLE public.scores
  ADD CONSTRAINT scores_scope_check
    CHECK (scope IN ('single', 'marathon', 'flash'));

ALTER TABLE public.scores
  DROP CONSTRAINT IF EXISTS scores_check;
ALTER TABLE public.scores
  ADD CONSTRAINT scores_check CHECK (
    (scope = 'single'   AND song_id IS NOT NULL AND time_ms BETWEEN 1 AND 10000)
    OR (scope = 'marathon' AND song_id IS NULL AND time_ms >= 1)
    OR (scope = 'flash'    AND song_id IS NULL AND time_ms >= 0
        AND correct_count IS NOT NULL)
  );

-- ------------------------------------------------------------
-- 4. leaderboard view 更新
--    Flash: correct_count DESC → time_ms ASC
--    それ以外: time_ms ASC（従来通り）
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT * FROM (
  SELECT
    row_number() OVER (
      PARTITION BY scope, mode, song_id
      ORDER BY
        CASE WHEN scope = 'flash' THEN correct_count END DESC NULLS LAST,
        time_ms ASC,
        created_at ASC
    ) AS rank,
    scope, mode, song_id, time_ms, display_name, correct_count
  FROM public.scores
  WHERE confirmed = true
) ranked
WHERE rank <= 30;

GRANT SELECT ON public.leaderboard TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. start_attempt 更新
--    run の scope を引き継ぐ（'marathon' ハードコードを廃止）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_attempt(
  p_song_id       text,
  p_mode          text,
  p_run_id        uuid    DEFAULT NULL,
  p_max_start_sec integer DEFAULT 0
)
RETURNS TABLE (attempt_id uuid, start_sec integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope     text;
  v_song_pos  integer;
  v_start_sec integer;
  v_run       public.marathon_runs%rowtype;
  v_id        uuid;
BEGIN
  IF p_mode NOT IN ('intro','random') THEN RAISE EXCEPTION 'invalid mode'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.songs WHERE id = p_song_id) THEN
    RAISE EXCEPTION 'invalid song';
  END IF;

  IF p_run_id IS NULL THEN
    v_scope    := 'single';
    v_song_pos := NULL;
  ELSE
    SELECT * INTO v_run FROM public.marathon_runs WHERE id = p_run_id;
    IF NOT FOUND                                        THEN RAISE EXCEPTION 'invalid run';    END IF;
    IF v_run.status <> 'in_progress'                    THEN RAISE EXCEPTION 'run not active'; END IF;
    IF v_run.song_order[v_run.current_pos] <> p_song_id THEN RAISE EXCEPTION 'song mismatch'; END IF;
    v_scope    := v_run.scope;   -- 'marathon' or 'flash'
    v_song_pos := v_run.current_pos;
  END IF;

  v_start_sec := CASE
    WHEN p_mode = 'intro' THEN 0
    ELSE floor(random() * (greatest(coalesce(p_max_start_sec, 0), 0) + 1))::integer
  END;

  INSERT INTO public.attempts (song_id, mode, scope, run_id, song_pos, start_sec)
  VALUES (p_song_id, p_mode, v_scope, p_run_id, v_song_pos, v_start_sec)
  RETURNING id INTO v_id;

  attempt_id := v_id;
  start_sec  := v_start_sec;
  RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- 6. start_flash 新関数
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_flash()
RETURNS TABLE (run_id uuid, total_songs integer, current_position integer, song_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_song_order text[];
  v_total      integer;
  v_run_id     uuid;
BEGIN
  SELECT array_agg(id ORDER BY random()) INTO v_song_order FROM public.songs;
  v_total := coalesce(array_length(v_song_order, 1), 0);
  IF v_total = 0 THEN RAISE EXCEPTION 'no songs'; END IF;

  INSERT INTO public.marathon_runs (mode, scope, song_order, total_songs)
  VALUES ('random', 'flash', v_song_order, v_total)
  RETURNING id INTO v_run_id;

  run_id           := v_run_id;
  total_songs      := v_total;
  current_position := 1;
  song_id          := v_song_order[1];
  RETURN NEXT;
END;
$$;

-- ------------------------------------------------------------
-- 7. finish_flash_song 新関数
--    正解でも不正解でもゲーム継続。全曲終了でスコア保存。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_flash_song(
  p_attempt_id  uuid,
  p_answer_norm text,    -- 空文字列 = タイムアウト = 不正解
  p_time_ms     integer  -- 曲ごとのタイム（0〜10000ms）
)
RETURNS TABLE (
  status        text,         -- 'correct' / 'wrong' / 'completed'
  is_correct    boolean,
  next_song_id  text,
  next_song_pos integer,
  correct_count integer,
  total_songs   integer,
  total_ms      integer,      -- completed 時のみ
  score_id      uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt     public.attempts%rowtype;
  v_run         public.marathon_runs%rowtype;
  v_correct     boolean;
  v_next_pos    integer;
  v_song_ms     integer;
  v_new_total   integer;
  v_new_correct integer;
  v_30th        record;
  v_score_id    uuid;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_attempt'::text, false, null::text, null::integer,
                        null::integer, null::integer, null::integer, null::uuid;
    RETURN;
  END IF;

  -- 回答検証（空文字列 = タイムアウト = 不正解）
  SELECT (p_answer_norm <> '' AND p_answer_norm = ANY(s.answers_normalized))
  INTO v_correct
  FROM public.songs s WHERE s.id = v_attempt.song_id;

  DELETE FROM public.attempts WHERE id = p_attempt_id;

  -- タイムをクランプ（0〜10000ms）
  v_song_ms := greatest(0, least(coalesce(p_time_ms, 10000), 10000));

  SELECT * INTO v_run FROM public.marathon_runs WHERE id = v_attempt.run_id;

  v_new_correct := v_run.correct_count + (CASE WHEN v_correct THEN 1 ELSE 0 END);
  v_next_pos    := v_attempt.song_pos + 1;
  v_new_total   := v_run.total_ms_so_far + v_song_ms;

  IF v_next_pos > v_run.total_songs THEN
    -- 全曲完了
    UPDATE public.marathon_runs
    SET status          = 'completed',
        current_pos     = v_next_pos,
        total_ms_so_far = v_new_total,
        correct_count   = v_new_correct
    WHERE id = v_run.id;

    -- Top30 チェック（correct_count DESC, total_ms ASC）
    SELECT sc.correct_count AS cc, sc.time_ms AS tm
    INTO v_30th
    FROM public.scores sc
    WHERE sc.scope = 'flash'
      AND sc.mode  = v_run.mode
      AND sc.song_id IS NULL
      AND sc.confirmed = true
    ORDER BY sc.correct_count DESC, sc.time_ms ASC
    LIMIT 1 OFFSET 29;

    IF v_30th IS NULL
       OR v_new_correct > v_30th.cc
       OR (v_new_correct = v_30th.cc AND v_new_total < v_30th.tm)
    THEN
      INSERT INTO public.scores (scope, mode, song_id, time_ms, correct_count)
      VALUES ('flash', v_run.mode, NULL, v_new_total, v_new_correct)
      RETURNING id INTO v_score_id;
    END IF;

    RETURN QUERY SELECT
      'completed'::text, v_correct, null::text, null::integer,
      v_new_correct, v_run.total_songs, v_new_total, v_score_id;
    RETURN;
  END IF;

  -- 途中: 次の曲へ（正解・不正解どちらでも継続）
  UPDATE public.marathon_runs
  SET current_pos     = v_next_pos,
      total_ms_so_far = v_new_total,
      correct_count   = v_new_correct
  WHERE id = v_run.id;

  RETURN QUERY SELECT
    (CASE WHEN v_correct THEN 'correct' ELSE 'wrong' END)::text,
    v_correct,
    v_run.song_order[v_next_pos],
    v_next_pos,
    v_new_correct,
    v_run.total_songs,
    null::integer,
    null::uuid;
END;
$$;

-- ------------------------------------------------------------
-- 8. submit_score 更新: Flash の trim ロジックを追加
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_score(p_score_id uuid, p_display_name text)
RETURNS TABLE (status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_score public.scores%rowtype;
BEGIN
  SELECT * INTO v_score FROM public.scores WHERE id = p_score_id AND confirmed = false;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_score'::text;
    RETURN;
  END IF;

  UPDATE public.scores
  SET display_name = coalesce(nullif(trim(p_display_name), ''), 'Anonymous'),
      confirmed    = true
  WHERE id = p_score_id;

  -- Top30 超えスコアを削除
  -- Flash: correct_count DESC → time_ms ASC
  -- それ以外: time_ms ASC（従来通り）
  DELETE FROM public.scores
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
        row_number() OVER (
          PARTITION BY scope, mode, song_id
          ORDER BY
            CASE WHEN scope = 'flash' THEN correct_count END DESC NULLS LAST,
            time_ms ASC,
            created_at ASC
        ) AS rn
      FROM public.scores
      WHERE scope = v_score.scope AND mode = v_score.mode
        AND (song_id = v_score.song_id
             OR (song_id IS NULL AND v_score.song_id IS NULL))
        AND confirmed = true
    ) ranked
    WHERE rn > 30
  );

  RETURN QUERY SELECT 'ok'::text;
END;
$$;

-- ------------------------------------------------------------
-- 9. 権限付与
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.start_flash()                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_flash_song(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_attempt(text, text, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_score(uuid, text)              TO anon, authenticated;