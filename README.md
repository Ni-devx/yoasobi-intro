# YOASOBI Intro RTA (GitHub Pages)

Unofficial fan project. This site uses the official YouTube IFrame Player API and a Supabase backend for server-timed runs and leaderboards.

## Setup

1. Open `config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. Edit `songs.json` and replace every `VIDEO_ID_HERE` with the actual YouTube video id.
3. Run the SQL in `supabase.sql` inside the Supabase SQL editor.
4. Insert your songs into the `songs` table.

## Generate SQL from songs.json

Generate SQL for the `songs` table directly from `songs.json`:

```bash
node scripts/generate-songs-sql.js > songs.sql
```

If you want to reset the table first:

```bash
node scripts/generate-songs-sql.js --truncate > songs.sql
```

Then paste `songs.sql` into the Supabase SQL editor.

## Songs JSON + Server Verification

The UI uses `songs.json` as the source of truth for display.  
For **server-side verification**, the same songs (with `answers_normalized`) must also exist in Supabase `public.songs`.  
Single mode uses server-side random song draw, and Marathon uses server-side shuffled order, so the songs table is required.

You can copy values from `songs.json` and insert once into Supabase.

## Songs Table

The database needs `answers_normalized` for server-side verification. Normalize with the same rule used by the client:

- NFKC normalization
- lowercase
- remove whitespace
- remove punctuation/symbols

Example normalization in the browser console:

```js
const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[\p{P}\p{S}]/gu, "");
```

Example insert:

```sql
insert into public.songs (id, title_ja, title_en, video_id, answers_normalized)
values (
  'idol',
  'アイドル',
  'Idol',
  'YOUR_VIDEO_ID',
  array['アイドル', 'idol']::text[]
);
```

## Supabase RPC (概要)

- `draw_single_song()`  
  ランダムで1曲を抽選
- `start_single(p_song_id, p_mode, p_max_start_sec)`  
  1曲プレイの計測開始（サーバー開始時刻を返す）
- `finish_single(p_attempt_id, p_answer_norm, p_display_name)`  
  1曲プレイの正解判定（Top30時のみ後で保存）
- `start_marathon(p_mode, p_display_name)`  
  全曲マラソンの開始（シャッフル順を確定）
- `start_marathon_song(p_run_id, p_song_id, p_max_start_sec)`  
  マラソン中の1曲開始（サーバー開始時刻を返す）
- `finish_marathon_song(p_attempt_id, p_answer_norm)`  
  マラソン中の正解判定（完走時のみ後で保存）
- `submit_score(p_pending_id, p_display_name)`  
  Top30対象の記録を保存

## GitHub Pages

Place the files at the repository root and enable GitHub Pages for the `main` branch. The site is static and does not require a build step.
