(() => {
  const config = window.APP_CONFIG || {};
  const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);

  const i18n = {
    ja: {
      tagline: "非公式ファンプロジェクト",
      subtitle: "音声で当てるイントロRTA。公式YouTube MVのみ使用。",
      mode: "モード",
      mode_intro: "Intro",
      mode_random: "Random",
      song: "楽曲",
      player_name: "名前",
      start: "スタート",
      now_playing: "再生中",
      ready: "準備完了",
      answer_placeholder: "曲名を入力",
      submit: "送信",
      ranking: "ランキング",
      scope_song: "曲別",
      scope_all: "全曲",
      ranking_empty: "まだ記録がありません",
      player: "プレイヤー",
      time: "タイム",
      status_ready: "準備完了",
      status_loading: "接続中...",
      status_playing: "計測中",
      status_wrong: "不正解。もう一度!",
      status_correct: "正解!",
      status_timeout: "10秒経過。記録なし",
      status_error: "エラーが発生しました",
      status_config: "Supabase設定を入力してください",
      hidden: "非表示"
    },
    en: {
      tagline: "Unofficial Fan Project",
      subtitle: "Guess by audio. Official YouTube MV only.",
      mode: "Mode",
      mode_intro: "Intro",
      mode_random: "Random",
      song: "Song",
      player_name: "Name",
      start: "Start",
      now_playing: "Now Playing",
      ready: "Ready",
      answer_placeholder: "Type the song title",
      submit: "Submit",
      ranking: "Ranking",
      scope_song: "Per Song",
      scope_all: "All Songs",
      ranking_empty: "No records yet.",
      player: "Player",
      time: "Time",
      status_ready: "Ready",
      status_loading: "Connecting...",
      status_playing: "Running",
      status_wrong: "Wrong. Try again!",
      status_correct: "Correct!",
      status_timeout: "10s elapsed. No record.",
      status_error: "Something went wrong",
      status_config: "Add Supabase settings",
      hidden: "Hidden"
    }
  };

  const state = {
    songs: [],
    mode: "intro",
    language: navigator.language && navigator.language.startsWith("ja") ? "ja" : "en",
    currentSong: null,
    attemptId: null,
    serverStartMs: null,
    rafId: null,
    timeoutId: null,
    playing: false,
    playerReady: false,
    statusKey: hasConfig ? "status_ready" : "status_config"
  };

  const ui = {
    startBtn: document.getElementById("start-btn"),
    submitBtn: document.getElementById("submit-btn"),
    answerInput: document.getElementById("answer-input"),
    displayName: document.getElementById("display-name"),
    songSelect: document.getElementById("song-select"),
    rankSongSelect: document.getElementById("rank-song"),
    rankModeSelect: document.getElementById("rank-mode"),
    rankScopeSelect: document.getElementById("rank-scope"),
    timer: document.getElementById("timer"),
    status: document.getElementById("status"),
    nowPlaying: document.getElementById("now-playing"),
    modeToggle: document.getElementById("mode-toggle"),
    overlay: document.getElementById("video-overlay"),
    videoWrapper: document.getElementById("video-wrapper"),
    leaderboardBody: document.getElementById("leaderboard-body"),
    langToggle: document.getElementById("lang-toggle")
  };

  const supabaseClient = hasConfig && window.supabase
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;

  let player = null;
  let youtubeReady = false;
  let songsLoaded = false;

  function normalizeAnswer(text) {
    return (text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[\p{P}\p{S}]/gu, "");
  }

  function formatTime(ms) {
    const clamped = Math.max(0, Math.min(ms, 10000));
    return (clamped / 1000).toFixed(3);
  }

  function setStatus(key) {
    state.statusKey = key;
    const message = i18n[state.language][key] || key;
    ui.status.textContent = message;
  }

  function applyTranslations() {
    document.documentElement.lang = state.language;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      el.textContent = i18n[state.language][key] || key;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      el.placeholder = i18n[state.language][key] || key;
    });
    updateSongSelects();
    updateNowPlaying(false);
    setStatus(state.statusKey || (hasConfig ? "status_ready" : "status_config"));
  }

  function updateSongSelects() {
    const selectedId = ui.songSelect.value;
    const rankSelectedId = ui.rankSongSelect.value;

    ui.songSelect.innerHTML = "";
    ui.rankSongSelect.innerHTML = "";

    state.songs.forEach((song) => {
      const label = state.language === "ja" ? song.title_ja : song.title_en;

      const option = document.createElement("option");
      option.value = song.id;
      option.textContent = label;
      ui.songSelect.appendChild(option);

      const rankOption = document.createElement("option");
      rankOption.value = song.id;
      rankOption.textContent = label;
      ui.rankSongSelect.appendChild(rankOption);
    });

    if (selectedId) {
      ui.songSelect.value = selectedId;
    }
    if (rankSelectedId) {
      ui.rankSongSelect.value = rankSelectedId;
    }
  }

  function updateNowPlaying(reveal) {
    if (!state.currentSong || !reveal) {
      ui.nowPlaying.textContent = i18n[state.language].hidden;
      return;
    }
    const title = state.language === "ja" ? state.currentSong.title_ja : state.currentSong.title_en;
    ui.nowPlaying.textContent = title;
  }

  function setMode(mode) {
    state.mode = mode;
    ui.modeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    ui.songSelect.disabled = mode === "random";
  }

  function resetAttempt() {
    state.attemptId = null;
    state.serverStartMs = null;
    state.playing = false;
    stopTimer();
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    ui.submitBtn.disabled = true;
    ui.startBtn.disabled = !state.playerReady;
    ui.videoWrapper.classList.remove("is-obscured");
  }

  function startTimer() {
    const tick = () => {
      if (!state.playing || !state.serverStartMs) return;
      const elapsed = Date.now() - state.serverStartMs;
      ui.timer.textContent = formatTime(elapsed);
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function handleTimeout() {
    if (!state.playing) return;
    state.playing = false;
    ui.timer.textContent = formatTime(10000);
    ui.videoWrapper.classList.remove("is-obscured");
    ui.submitBtn.disabled = true;
    ui.startBtn.disabled = !state.playerReady;
    stopTimer();
    setStatus("status_timeout");
    updateNowPlaying(true);
  }

  async function startAttempt() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (state.playing || !state.playerReady) return;

    const selectedId = ui.songSelect.value;
    let song = state.songs.find((s) => s.id === selectedId) || state.songs[0];
    if (state.mode === "random") {
      song = state.songs[Math.floor(Math.random() * state.songs.length)];
    }

    if (!song || !song.video_id || song.video_id === "VIDEO_ID_HERE") {
      setStatus("status_error");
      return;
    }

    state.currentSong = song;
    updateNowPlaying(false);
    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const { data, error } = await supabaseClient.rpc("start_attempt", {
      p_song_id: song.id,
      p_mode: state.mode
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      ui.startBtn.disabled = !state.playerReady;
      return;
    }

    state.attemptId = data[0].attempt_id;
    state.serverStartMs = Date.parse(data[0].started_at);
    state.playing = true;

    ui.videoWrapper.classList.add("is-obscured");
    ui.submitBtn.disabled = false;
    ui.answerInput.value = "";

    setStatus("status_playing");

    if (player && song.video_id) {
      player.loadVideoById({
        videoId: song.video_id,
        startSeconds: 0
      });
      player.playVideo();
    }

    ui.timer.textContent = "0.000";
    startTimer();

    clearTimeout(state.timeoutId);
    state.timeoutId = setTimeout(handleTimeout, 10000);
  }

  function isCorrectAnswer(normalizedAnswer) {
    if (!state.currentSong) return false;
    const answers = state.currentSong.answers_normalized || [];
    return answers.includes(normalizedAnswer);
  }

  async function submitAnswer() {
    if (!state.playing) return;
    const raw = ui.answerInput.value.trim();
    if (!raw) return;
    const normalized = normalizeAnswer(raw);

    if (!isCorrectAnswer(normalized)) {
      setStatus("status_wrong");
      return;
    }

    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }

    const displayName = ui.displayName.value.trim();

    const { data, error } = await supabaseClient.rpc("finish_attempt", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized,
      p_display_name: displayName
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];
    if (result.status !== "ok") {
      if (result.status === "timeout") {
        handleTimeout();
        return;
      }
      setStatus("status_wrong");
      return;
    }

    state.playing = false;
    stopTimer();
    clearTimeout(state.timeoutId);
    ui.videoWrapper.classList.remove("is-obscured");
    ui.submitBtn.disabled = true;
    ui.startBtn.disabled = !state.playerReady;
    updateNowPlaying(true);

    const timeMs = result.time_ms || 0;
    ui.timer.textContent = formatTime(timeMs);
    ui.timer.classList.remove("flash");
    void ui.timer.offsetWidth;
    ui.timer.classList.add("flash");
    setStatus("status_correct");
    await loadLeaderboard();
  }

  async function loadLeaderboard() {
    if (!supabaseClient) return;
    const mode = ui.rankModeSelect.value;
    const scope = ui.rankScopeSelect.value;
    const songId = ui.rankSongSelect.value;

    let query = supabaseClient
      .from("leaderboard")
      .select("rank, display_name, time_ms, song_id")
      .eq("mode", mode)
      .order("rank", { ascending: true });

    if (scope === "song") {
      query = query.eq("song_id", songId);
    } else {
      query = query.is("song_id", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return;
    }

    ui.leaderboardBody.innerHTML = "";
    if (!data || data.length === 0) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty";
      cell.textContent = i18n[state.language].ranking_empty;
      emptyRow.appendChild(cell);
      ui.leaderboardBody.appendChild(emptyRow);
      return;
    }

    data.forEach((row) => {
      const tr = document.createElement("tr");
      const song = state.songs.find((s) => s.id === row.song_id);
      const songLabel = row.song_id
        ? (state.language === "ja" ? song?.title_ja : song?.title_en)
        : "-";

      tr.innerHTML = `
        <td>${row.rank}</td>
        <td>${row.display_name || "Anonymous"}</td>
        <td>${formatTime(row.time_ms)}</td>
        <td>${songLabel || "-"}</td>
      `;
      ui.leaderboardBody.appendChild(tr);
    });
  }

  function bindEvents() {
    ui.startBtn.addEventListener("click", startAttempt);
    ui.submitBtn.addEventListener("click", submitAnswer);
    ui.answerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submitAnswer();
      }
    });
    ui.modeToggle.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      setMode(button.dataset.mode);
    });
    ui.rankModeSelect.addEventListener("change", loadLeaderboard);
    ui.rankScopeSelect.addEventListener("change", () => {
      ui.rankSongSelect.disabled = ui.rankScopeSelect.value !== "song";
      loadLeaderboard();
    });
    ui.rankSongSelect.addEventListener("change", loadLeaderboard);
    ui.langToggle.addEventListener("click", () => {
      state.language = state.language === "ja" ? "en" : "ja";
      applyTranslations();
      loadLeaderboard();
    });
  }

  async function loadSongs() {
    const response = await fetch(config.SONGS_JSON_PATH || "songs.json");
    const payload = await response.json();
    const songs = payload.songs || [];
    state.songs = songs.map((song) => {
      const answers = (song.answers || []).map((value) => value.trim()).filter(Boolean);
      const answersNormalized = (song.answers_normalized || answers)
        .map((value) => normalizeAnswer(value))
        .filter(Boolean);
      return {
        ...song,
        answers,
        answers_normalized: Array.from(new Set(answersNormalized))
      };
    });

    songsLoaded = true;
    updateSongSelects();
    if (state.songs[0]) {
      ui.songSelect.value = state.songs[0].id;
      ui.rankSongSelect.value = state.songs[0].id;
    }
  }

  function createPlayerIfReady() {
    if (!youtubeReady || !songsLoaded || player) return;
    const firstSong = state.songs.find((song) => song.video_id && song.video_id !== "VIDEO_ID_HERE");
    if (!firstSong) {
      setStatus("status_error");
      return;
    }

    player = new YT.Player("player", {
      videoId: firstSong.video_id,
      playerVars: {
        controls: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: () => {
          state.playerReady = true;
          ui.startBtn.disabled = !hasConfig;
          ui.submitBtn.disabled = true;
          setStatus(hasConfig ? "status_ready" : "status_config");
        }
      }
    });
  }

  window.onYouTubeIframeAPIReady = () => {
    youtubeReady = true;
    createPlayerIfReady();
  };

  async function init() {
    applyTranslations();
    bindEvents();
    setMode(state.mode);

    try {
      await loadSongs();
    } catch (error) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    if (!hasConfig) {
      setStatus("status_config");
    }

    createPlayerIfReady();
    loadLeaderboard();
  }

  init();
})();
