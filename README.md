# YOASOBI Intro RTA (GitHub Pages)

Unofficial fan project. This site uses the official YouTube IFrame Player API and a Supabase backend for server-timed runs and leaderboards.

## Setup

1. Open `config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. Edit `songs.json` and replace every `VIDEO_ID_HERE` with the actual YouTube video id.
3. Run the SQL in `supabase.sql` inside the Supabase SQL editor.
4. Insert your songs into the `songs` table.

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

## GitHub Pages

Place the files at the repository root and enable GitHub Pages for the `main` branch. The site is static and does not require a build step.
