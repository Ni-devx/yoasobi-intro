(() => {
  const config = window.APP_CONFIG || {};
  const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);

  const i18n = {
    ja: {
      tagline: "非公式ファンプロジェクト",
      subtitle: "音声で当てるイントロRTA。公式YouTube MVのみ使用。",
      mode: "開始位置",
      mode_intro: "Intro",
      mode_random: "ランダム開始",
      scope: "対象",
      scope_single: "1曲",
      scope_marathon: "全曲",
      song: "楽曲",
      player_name: "名前",
      start: "スタート",
      now_playing: "再生中",
      progress: "進行",
      ready: "準備完了",
      answer_placeholder: "曲名を入力",
      submit: "送信",
      ranking: "ランキング",
      ranking_empty: "まだ記録がありません",
      player: "プレイヤー",
      time: "タイム",
      status_ready: "準備完了",
      status_loading: "接続中...",
      status_playing: "計測中",
      status_wrong: "不正解。もう一度!",
      status_correct: "正解!",
      status_next: "次の曲へ...",
      status_completed: "全曲クリア!",
      status_failed: "失敗。記録なし",
      status_timeout: "10秒経過。記録なし",
      status_error: "エラーが発生しました",
      status_config: "Supabase設定を入力してください",
      hidden: "非表示"
    },
    en: {
      tagline: "Unofficial Fan Project",
      subtitle: "Guess by audio. Official YouTube MV only.",
      mode: "Start",
      mode_intro: "Intro",
      mode_random: "Random Start",
      scope: "Scope",
      scope_single: "Single",
      scope_marathon: "Marathon",
      song: "Song",
      player_name: "Name",
      start: "Start",
      now_playing: "Now Playing",
      progress: "Progress",
      ready: "Ready",
      answer_placeholder: "Type the song title",
      submit: "Submit",
      ranking: "Ranking",
      ranking_empty: "No records yet.",
      player: "Player",
      time: "Time",
      status_ready: "Ready",
      status_loading: "Connecting...",
      status_playing: "Running",
      status_wrong: "Wrong. Try again!",
      status_correct: "Correct!",
      status_next: "Next song...",
      status_completed: "Marathon complete!",
      status_failed: "Failed. No record.",
      status_timeout: "10s elapsed. No record.",
      status_error: "Something went wrong",
      status_config: "Add Supabase settings",
      hidden: "Hidden"
    }
  };

  const state = {
    songs: [],
    mode: "intro",
    scope: "single",
    language: navigator.language && navigator.language.startsWith("ja") ? "ja" : "en",
    currentSong: null,
    attemptId: null,
    serverStartMs: null,
    runId: null,
    runPosition: 0,
    runTotal: 0,
    pendingSongId: null,
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
    rankSongSelect: document.getElementById("rank-song"),
    rankModeSelect: document.getElementById("rank-mode"),
    rankScopeSelect: document.getElementById("rank-scope"),
    timer: document.getElementById("timer"),
    status: document.getElementById("status"),
    nowPlaying: document.getElementById("now-playing"),
    progress: document.getElementById("progress"),
    modeToggle: document.getElementById("mode-toggle"),
    scopeToggle: document.getElementById("scope-toggle"),
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
  let cueResolver = null;

  function normalizeAnswer(text) {
    return (text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[\p{P}\p{S}]/gu, "");
  }

  function formatTime(ms, capMs) {
    const value = typeof capMs === "number" ? Math.min(ms, capMs) : ms;
    return (Math.max(0, value) / 1000).toFixed(3);
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
    updateRankSongSelects();
    updateNowPlaying(false);
    updateProgress();
    setStatus(state.statusKey || (hasConfig ? "status_ready" : "status_config"));
  }

  function updateRankSongSelects() {
    const rankSelectedId = ui.rankSongSelect.value;

    ui.rankSongSelect.innerHTML = "";

    state.songs.forEach((song) => {
      const label = state.language === "ja" ? song.title_ja : song.title_en;
      const rankOption = document.createElement("option");
      rankOption.value = song.id;
      rankOption.textContent = label;
      ui.rankSongSelect.appendChild(rankOption);
    });

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

  function updateProgress() {
    if (state.scope === "marathon" && state.runTotal > 0) {
      ui.progress.textContent = `${state.runPosition} / ${state.runTotal}`;
      return;
    }
    if (state.scope === "single" && state.currentSong) {
      ui.progress.textContent = "1 / 1";
      return;
    }
    ui.progress.textContent = "-";
  }

  function setMode(mode) {
    state.mode = mode;
    ui.modeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }

  function setScope(scope) {
    state.scope = scope;
    ui.scopeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scope === scope);
    });
    resetAttempt();
    resetRun();
    updateProgress();
    updateStartButton();
  }

  function resetRun() {
    state.runId = null;
    state.runPosition = 0;
    state.runTotal = 0;
    state.pendingSongId = null;
  }

  function resetAttempt() {
    state.attemptId = null;
    state.serverStartMs = null;
    state.playing = false;
    stopTimer();
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    ui.submitBtn.disabled = true;
    ui.videoWrapper.classList.remove("is-obscured");
  }

  function updateStartButton() {
    const marathonActive = state.scope === "marathon" && state.runId;
    ui.startBtn.disabled = !state.playerReady || marathonActive || state.playing || !hasConfig;
  }

  function startTimer() {
    const tick = () => {
      if (!state.playing || !state.serverStartMs) return;
      const elapsed = Date.now() - state.serverStartMs;
      ui.timer.textContent = formatTime(elapsed, 10000);
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

  async function timeoutCleanup() {
    if (!supabaseClient || !state.attemptId) return;
    try {
      if (state.scope === "single") {
        await supabaseClient.rpc("finish_single", {
          p_attempt_id: state.attemptId,
          p_answer_norm: "",
          p_display_name: ""
        });
      } else {
        await supabaseClient.rpc("finish_marathon_song", {
          p_attempt_id: state.attemptId,
          p_answer_norm: ""
        });
      }
    } catch (error) {
      console.warn(error);
    }
  }

  async function handleTimeout() {
    if (!state.playing) return;
    state.playing = false;
    ui.timer.textContent = formatTime(10000, 10000);
    ui.videoWrapper.classList.remove("is-obscured");
    ui.submitBtn.disabled = true;
    stopTimer();
    setStatus("status_timeout");
    updateNowPlaying(true);
    await timeoutCleanup();

    if (state.scope === "marathon") {
      resetRun();
    }
    updateProgress();
    updateStartButton();
  }

  async function cueVideo(videoId) {
    if (!player) return;
    await new Promise((resolve) => {
      cueResolver = resolve;
      player.cueVideoById({ videoId });
      setTimeout(() => {
        if (cueResolver) {
          cueResolver();
          cueResolver = null;
        }
      }, 2000);
    });
  }

  async function getDurationSafe() {
    if (!player) return 0;
    for (let i = 0; i < 20; i += 1) {
      const duration = player.getDuration();
      if (duration && duration > 0) return duration;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return 0;
  }

  function beginPlay(startSec) {
    state.playing = true;
    ui.videoWrapper.classList.add("is-obscured");
    ui.submitBtn.disabled = false;
    ui.answerInput.value = "";
    setStatus("status_playing");

    if (player && state.currentSong?.video_id) {
      player.seekTo(startSec || 0, true);
      player.playVideo();
    }

    ui.timer.textContent = "0.000";
    startTimer();

    clearTimeout(state.timeoutId);
    state.timeoutId = setTimeout(() => {
      handleTimeout();
    }, 10000);
  }

  function isCorrectAnswer(normalizedAnswer) {
    if (!state.currentSong) return false;
    const answers = state.currentSong.answers_normalized || [];
    return answers.includes(normalizedAnswer);
  }

  async function drawSingleSong() {
    const { data, error } = await supabaseClient.rpc("draw_single_song");
    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return null;
    }
    return data[0].song_id;
  }

  async function startSingle() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (state.playing || !state.playerReady) return;

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const songId = await drawSingleSong();
    const song = state.songs.find((s) => s.id === songId);
    if (!song || !song.video_id || song.video_id === "VIDEO_ID_HERE") {
      setStatus("status_error");
      updateStartButton();
      return;
    }

    state.currentSong = song;
    updateNowPlaying(false);
    updateProgress();

    await cueVideo(song.video_id);

    let maxStartSec = 0;
    if (state.mode === "random") {
      const duration = await getDurationSafe();
      maxStartSec = Math.max(0, Math.floor(duration) - 10);
    }

    const { data, error } = await supabaseClient.rpc("start_single", {
      p_song_id: song.id,
      p_mode: state.mode,
      p_max_start_sec: maxStartSec
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      updateStartButton();
      return;
    }

    state.attemptId = data[0].attempt_id;
    state.serverStartMs = Date.parse(data[0].started_at);

    beginPlay(data[0].start_sec || 0);
  }

  async function startMarathon() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (state.playing || !state.playerReady) return;

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const displayName = ui.displayName.value.trim();
    const { data, error } = await supabaseClient.rpc("start_marathon", {
      p_mode: state.mode,
      p_display_name: displayName
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      updateStartButton();
      return;
    }

    state.runId = data[0].run_id;
    state.runTotal = data[0].total_songs;
    state.runPosition = data[0].current_position;
    state.pendingSongId = data[0].song_id;

    await startMarathonSong();
  }

  async function startMarathonSong() {
    if (!state.runId || !state.pendingSongId) {
      setStatus("status_error");
      resetRun();
      updateStartButton();
      return;
    }

    const song = state.songs.find((s) => s.id === state.pendingSongId);
    if (!song || !song.video_id || song.video_id === "VIDEO_ID_HERE") {
      setStatus("status_error");
      resetRun();
      updateStartButton();
      return;
    }

    state.currentSong = song;
    updateNowPlaying(false);
    updateProgress();

    await cueVideo(song.video_id);

    let maxStartSec = 0;
    if (state.mode === "random") {
      const duration = await getDurationSafe();
      maxStartSec = Math.max(0, Math.floor(duration) - 10);
    }

    const { data, error } = await supabaseClient.rpc("start_marathon_song", {
      p_run_id: state.runId,
      p_max_start_sec: maxStartSec
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      resetRun();
      updateStartButton();
      return;
    }

    state.attemptId = data[0].attempt_id;
    state.serverStartMs = Date.parse(data[0].started_at);
    state.runPosition = data[0].song_pos;
    state.runTotal = data[0].total_songs;

    beginPlay(data[0].start_sec || 0);
  }

  async function startAttempt() {
    if (state.scope === "single") {
      await startSingle();
    } else {
      await startMarathon();
    }
  }

  async function finishSingle(normalized) {
    const displayName = ui.displayName.value.trim();
    const { data, error } = await supabaseClient.rpc("finish_single", {
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
    updateStartButton();
    updateNowPlaying(true);

    const timeMs = result.time_ms || 0;
    ui.timer.textContent = formatTime(timeMs);
    ui.timer.classList.remove("flash");
    void ui.timer.offsetWidth;
    ui.timer.classList.add("flash");
    setStatus("status_correct");
    await loadLeaderboard();
  }

  async function finishMarathon(normalized) {
    const { data, error } = await supabaseClient.rpc("finish_marathon_song", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];

    if (result.status === "wrong") {
      setStatus("status_wrong");
      return;
    }

    if (result.status === "timeout" || result.status === "run_not_active") {
      state.playing = false;
      stopTimer();
      clearTimeout(state.timeoutId);
      ui.videoWrapper.classList.remove("is-obscured");
      ui.submitBtn.disabled = true;
      setStatus("status_failed");
      updateNowPlaying(true);
      resetRun();
      updateProgress();
      updateStartButton();
      return;
    }

    if (result.status === "next") {
      state.playing = false;
      stopTimer();
      clearTimeout(state.timeoutId);
      ui.videoWrapper.classList.remove("is-obscured");
      ui.submitBtn.disabled = true;
      updateNowPlaying(true);

      const timeMs = result.time_ms || 0;
      ui.timer.textContent = formatTime(timeMs);
      ui.timer.classList.remove("flash");
      void ui.timer.offsetWidth;
      ui.timer.classList.add("flash");
      setStatus("status_next");

      state.runPosition = result.next_song_pos;
      state.pendingSongId = result.next_song_id;
      updateProgress();

      setTimeout(() => {
        startMarathonSong();
      }, 500);
      return;
    }

    if (result.status === "completed") {
      state.playing = false;
      stopTimer();
      clearTimeout(state.timeoutId);
      ui.videoWrapper.classList.remove("is-obscured");
      ui.submitBtn.disabled = true;
      updateNowPlaying(true);

      const totalMs = result.total_ms || 0;
      ui.timer.textContent = formatTime(totalMs);
      ui.timer.classList.remove("flash");
      void ui.timer.offsetWidth;
      ui.timer.classList.add("flash");
      setStatus("status_completed");

      resetRun();
      updateProgress();
      updateStartButton();
      await loadLeaderboard();
    }
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

    if (state.scope === "single") {
      await finishSingle(normalized);
    } else {
      await finishMarathon(normalized);
    }
  }

  async function loadLeaderboard() {
    if (!supabaseClient) return;
    const mode = ui.rankModeSelect.value;
    const scope = ui.rankScopeSelect.value;
    const songId = ui.rankSongSelect.value;

    let query = supabaseClient
      .from("leaderboard")
      .select("rank, display_name, time_ms, song_id, scope")
      .eq("mode", mode)
      .eq("scope", scope)
      .order("rank", { ascending: true });

    if (scope === "single") {
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
    ui.scopeToggle.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      setScope(button.dataset.scope);
    });
    ui.rankModeSelect.addEventListener("change", loadLeaderboard);
    ui.rankScopeSelect.addEventListener("change", () => {
      ui.rankSongSelect.disabled = ui.rankScopeSelect.value !== "single";
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
    updateRankSongSelects();
    if (state.songs[0]) {
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
          updateStartButton();
          ui.submitBtn.disabled = true;
          setStatus(hasConfig ? "status_ready" : "status_config");
        },
        onStateChange: (event) => {
          if (cueResolver && event.data === YT.PlayerState.CUED) {
            cueResolver();
            cueResolver = null;
          }
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
    setScope(state.scope);
    ui.rankSongSelect.disabled = ui.rankScopeSelect.value !== "single";

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
