#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const shouldTruncate = args.includes("--truncate");
const inputPath = args.find((arg) => !arg.startsWith("--")) || "songs.json";

function normalizeAnswer(text) {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\p{P}\p{S}]/gu, "");
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function extractVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/youtu|youtube|http/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "").trim();
    }
    if (url.hostname.includes("youtube")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const match = url.pathname.match(/\/embed\/([^/]+)/);
      if (match) return match[1];
    }
  } catch (error) {
    return "";
  }

  return "";
}

function loadSongs(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const json = JSON.parse(raw);
  if (!json.songs || !Array.isArray(json.songs)) {
    throw new Error("songs.json must have a songs array");
  }
  return json.songs;
}

function buildRows(songs) {
  return songs.map((song, index) => {
    const id = song.id && String(song.id).trim();
    const titleJa = song.title_ja && String(song.title_ja).trim();
    const titleEn = song.title_en && String(song.title_en).trim();
    let videoId = song.video_id && String(song.video_id).trim();

    if (!id) throw new Error(`Song #${index + 1}: missing id`);
    if (!titleJa) throw new Error(`Song ${id}: missing title_ja`);
    if (!titleEn) throw new Error(`Song ${id}: missing title_en`);
    if (!videoId) throw new Error(`Song ${id}: missing video_id`);

    const extractedId = extractVideoId(videoId);
    if (!extractedId) {
      throw new Error(`Song ${id}: invalid video_id (use a YouTube video id)`);
    }
    videoId = extractedId;

    const answersSource = Array.isArray(song.answers) && song.answers.length > 0
      ? song.answers
      : [titleJa, titleEn];

    const normalized = Array.from(
      new Set(
        answersSource
          .map((value) => normalizeAnswer(value))
          .filter((value) => value)
      )
    );

    if (normalized.length === 0) {
      throw new Error(`Song ${id}: answers_normalized is empty`);
    }

    const answersSql = normalized.map((value) => `'${escapeSql(value)}'`).join(", ");

    return `  ('${escapeSql(id)}', '${escapeSql(titleJa)}', '${escapeSql(titleEn)}', '${escapeSql(videoId)}', array[${answersSql}]::text[])`;
  });
}

function buildSql(rows, truncate) {
  const header = "-- Generated from songs.json\n";
  const truncateSql = truncate ? "truncate table public.songs;\n\n" : "";

  return (
    header +
    truncateSql +
    "insert into public.songs (id, title_ja, title_en, video_id, answers_normalized) values\n" +
    rows.join(",\n") +
    "\n" +
    "on conflict (id) do update set\n" +
    "  title_ja = excluded.title_ja,\n" +
    "  title_en = excluded.title_en,\n" +
    "  video_id = excluded.video_id,\n" +
    "  answers_normalized = excluded.answers_normalized;\n"
  );
}

function main() {
  const songs = loadSongs(inputPath);
  const rows = buildRows(songs);
  const sql = buildSql(rows, shouldTruncate);
  process.stdout.write(sql);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
