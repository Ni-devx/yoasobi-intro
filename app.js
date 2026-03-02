(() => {
  const config = window.APP_CONFIG || {};
  const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);

  const i18n = {
    ja: {
      tagline: "非公式ファンプロジェクト",
      subtitle: "音声で当てるイントロRTA。公式YouTube MVのみ使用。",
      home_title: "イントロRTA",
      home_desc: "開始位置と対象を選んで挑戦。ランキングはサーバー計測です。",
      home_start: "開始",
      home_ranking: "ランキング",
      setup_title: "ゲーム設定",
      play_title: "クイズ",
      result_title: "結果",
      ranking: "ランキング",
      mode: "開始位置",
      mode_intro: "Intro",
      mode_random: "ランダム開始",
      scope: "対象",
      scope_single: "1曲",
      scope_marathon: "全曲",
      rank_song: "ランキング曲",
      song: "楽曲",
      player_name: "名前",
      start: "スタート",
      start_quiz: "スタート",
      now_playing: "再生中",
      progress: "進行",
      ready: "準備完了",
      answer_placeholder: "曲名を入力",
      answer_select_placeholder: "選択してください",
      submit: "送信",
      ranking_empty: "まだ記録がありません",
      player: "プレイヤー",
      time: "タイム",
      back: "戻る",
      back_home: "ホーム",
      play_again: "もう一度",
      save_score: "保存",
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
      status_saved: "記録を保存しました",
      status_not_qualified: "Top30外でした",
      hidden: "非表示"
    },
    en: {
      tagline: "Unofficial Fan Project",
      subtitle: "Guess by audio. Official YouTube MV only.",
      home_title: "Intro RTA",
      home_desc: "Choose start position and scope. Rankings are server-timed.",
      home_start: "Start",
      home_ranking: "Rankings",
      setup_title: "Game Setup",
      play_title: "Quiz",
      result_title: "Result",
      ranking: "Ranking",
      mode: "Start",
      mode_intro: "Intro",
      mode_random: "Random Start",
      scope: "Scope",
      scope_single: "Single",
      scope_marathon: "Marathon",
      rank_song: "Ranking Song",
      song: "Song",
      player_name: "Name",
      start: "Start",
      start_quiz: "Start",
      now_playing: "Now Playing",
      progress: "Progress",
      ready: "Ready",
      answer_placeholder: "Type the song title",
      answer_select_placeholder: "Select a song",
      submit: "Submit",
      ranking_empty: "No records yet.",
      player: "Player",
      time: "Time",
      back: "Back",
      back_home: "Home",
      play_again: "Play Again",
      save_score: "Save",
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
      status_saved: "Score saved",
      status_not_qualified: "Not in Top 30",
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
    // FIX #2: clientStartMs はサーバーからレスポンスを受け取った瞬間のクライアント時刻を保持する
    // serverStartMs は廃止し、clientStartMs に一本化することでサーバー/クライアントの時計ズレを回避
    clientStartMs: null,
    runId: null,
    runPosition: 0,
    runTotal: 0,
    nextSongId: null,
    // FIX #7: result 系フィールドをサブオブジェクトに集約
    result: {
      pendingScoreId: null,
      timeMs: null,
      scope: null,
      mode: null,
      songId: null
    },
    rafId: null,
    timeoutId: null,
    playing: false,
    playerReady: false,
    statusKey: hasConfig ? "status_ready" : "status_config",
    view: "home"
  };

  const ui = {
    views: {
      home: document.getElementById("view-home"),
      setup: document.getElementById("view-setup"),
      result: document.getElementById("view-result"),
      ranking: document.getElementById("view-ranking")
    },
    playerPanel: document.getElementById("player-panel"),
    quizTimer: document.getElementById("quiz-timer"),
    quizAnswer: document.getElementById("quiz-answer"),
    setupRanking: document.getElementById("setup-ranking"),
    rankingSongWrap: document.getElementById("ranking-song-wrap"),
    goSetup: document.getElementById("go-setup"),
    goRanking: document.getElementById("go-ranking"),
    backHome: document.getElementById("back-home"),
    resultHome: document.getElementById("result-home"),
    rankingHome: document.getElementById("ranking-home"),
    playAgain: document.getElementById("play-again"),
    goRankingFromResult: document.getElementById("go-ranking-from-result"),
    startBtn: document.getElementById("start-btn"),
    submitBtn: document.getElementById("submit-btn"),
    answerSelect: document.getElementById("answer-select"),
    resultTime: document.getElementById("result-time"),
    resultMessage: document.getElementById("result-message"),
    saveBlock: document.getElementById("save-block"),
    resultName: document.getElementById("result-name"),
    saveScore: document.getElementById("save-score"),
    modeToggle: document.getElementById("mode-toggle"),
    scopeToggle: document.getElementById("scope-toggle"),
    rankingMode: document.getElementById("ranking-mode"),
    rankingScope: document.getElementById("ranking-scope"),
    rankingSong: document.getElementById("ranking-song"),
    leaderboardSetup: document.getElementById("leaderboard-body-setup"),
    leaderboardRanking: document.getElementById("leaderboard-body-ranking"),
    timer: document.getElementById("timer"),
    status: document.getElementById("status"),
    nowPlaying: document.getElementById("now-playing"),
    progress: document.getElementById("progress"),
    overlay: document.getElementById("video-overlay"),
    videoWrapper: document.getElementById("video-wrapper"),
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
    updateSongSelects();
    updateNowPlaying(false);
    updateProgress();
    if (state.playing) {
      populateAnswerSelect();
    }
    setStatus(state.statusKey || (hasConfig ? "status_ready" : "status_config"));
  }

  function showView(name) {
    Object.keys(ui.views).forEach((key) => {
      ui.views[key].classList.toggle("active", key === name);
    });
    state.view = name || "play";

    // #1: ホームとランキング画面ではプレイヤーパネルを非表示にする
    const hidePlayer = name === "home" || name === "ranking";
    ui.playerPanel.classList.toggle("hidden", hidePlayer);

    if (name === "setup") {
      updateStartButton();
    }
  }

  function updateSongSelects() {
    const rankingSelected = ui.rankingSong.value;

    ui.rankingSong.innerHTML = "";

    state.songs.forEach((song) => {
      const label = state.language === "ja" ? song.title_ja : song.title_en;

      const optionRanking = document.createElement("option");
      optionRanking.value = song.id;
      optionRanking.textContent = label;
      ui.rankingSong.appendChild(optionRanking);
    });

    if (rankingSelected) ui.rankingSong.value = rankingSelected;
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
    loadSetupLeaderboard();
  }

  function setScope(scope) {
    state.scope = scope;
    ui.scopeToggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scope === scope);
    });
    ui.setupRanking.classList.toggle("hidden", scope === "single");
    updateProgress();
    updateStartButton();
    loadSetupLeaderboard();
  }

  function resetRun() {
    state.runId = null;
    state.runPosition = 0;
    state.runTotal = 0;
    state.nextSongId = null;
  }

  // FIX #6: stopPlay() 共通関数に切り出し（finishSingle / finishMarathon / handleTimeout の重複を解消）
  function stopPlay() {
    state.playing = false;
    stopTimer();
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    ui.videoWrapper.classList.remove("is-obscured");
    ui.submitBtn.disabled = true;
  }

  function resetAttempt() {
    state.attemptId = null;
    state.clientStartMs = null; // FIX #2
    stopPlay();
  }

  // FIX #7: result サブオブジェクトをリセット
  function resetResult() {
    state.result = {
      pendingScoreId: null,
      timeMs: null,
      scope: null,
      mode: null,
      songId: null
    };
    ui.resultTime.textContent = "0.000";
    ui.resultMessage.textContent = "";
    ui.resultName.value = "";
    ui.saveBlock.classList.add("hidden");
  }

  function updateStartButton() {
    ui.startBtn.disabled = state.playing || !hasConfig || !songsLoaded;
  }

  function setQuizActive(active) {
    ui.playerPanel.classList.toggle("play-active", active);
    if (!active) {
      ui.answerSelect.innerHTML = "";
      ui.submitBtn.disabled = true;
    }
  }

  async function ensurePlayerReady() {
    if (state.playerReady) return true;
    createPlayerIfReady();
    setStatus("status_loading");
    const start = Date.now();
    while (!state.playerReady && Date.now() - start < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return state.playerReady;
  }

  function getAnswerNormForSong(song) {
    if (song?.answers_normalized && song.answers_normalized.length > 0) {
      return song.answers_normalized[0];
    }
    return normalizeAnswer(state.language === "ja" ? song?.title_ja : song?.title_en);
  }

  function populateAnswerSelect() {
    if (!ui.answerSelect) return;
    const currentSelection = ui.answerSelect.value;
    const options = state.songs.map((song) => ({
      id: song.id,
      label: state.language === "ja" ? song.title_ja : song.title_en,
      answer: getAnswerNormForSong(song)
    }));

    for (let i = options.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    ui.answerSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = i18n[state.language].answer_select_placeholder;
    ui.answerSelect.appendChild(placeholder);

    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.id;
      option.textContent = opt.label;
      option.dataset.answer = opt.answer;
      ui.answerSelect.appendChild(option);
    });

    if (currentSelection) {
      ui.answerSelect.value = currentSelection;
    }
    ui.submitBtn.disabled = true;
  }

  function startTimer() {
    const tick = () => {
      if (!state.playing || !state.clientStartMs) return;
      // FIX #2: サーバー時刻との比較をやめ、clientStartMs（レスポンス受信時のクライアント時刻）を基準に計測
      const elapsed = Date.now() - state.clientStartMs;
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

  function stopPlayer() {
    if (player && typeof player.stopVideo === "function") {
      player.stopVideo();
    }
  }

  async function cleanupTimeout() {
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
    ui.timer.textContent = formatTime(10000, 10000);
    stopPlay(); // FIX #6: 共通関数を使用
    setStatus("status_timeout");
    updateNowPlaying(true);
    await cleanupTimeout();
    resetAttempt();
    resetRun();
    updateProgress();
    showResult(false, null);
  }

  async function cueVideo(videoId) {
    if (!player) return;
    await new Promise((resolve) => {
      cueResolver = resolve;
      player.cueVideoById({ videoId });
      // FIX #5: フォールバックを 2000ms → 5000ms に延長して低速回線でも動画準備を待つ
      setTimeout(() => {
        if (cueResolver) {
          cueResolver();
          cueResolver = null;
        }
      }, 5000);
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
    // FIX #2: サーバー時刻との比較をやめ、ここでクライアント時刻を記録してタイマー基準とする
    state.clientStartMs = Date.now();
    ui.videoWrapper.classList.add("is-obscured");
    ui.submitBtn.disabled = false;
    populateAnswerSelect();
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
    if (!await ensurePlayerReady()) {
      setStatus("status_error");
      updateStartButton();
      return;
    }
    if (!player) {
      setStatus("status_error");
      updateStartButton();
      return;
    }

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const songId = await drawSingleSong();
    const song = state.songs.find((s) => s.id === songId);
    if (!song || !song.video_id) {
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
    // FIX #2: serverStartMs は使わない。beginPlay() 内で clientStartMs を記録する
    beginPlay(data[0].start_sec || 0);
  }

  async function startMarathon() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (!await ensurePlayerReady()) {
      setStatus("status_error");
      updateStartButton();
      return;
    }
    if (!player) {
      setStatus("status_error");
      updateStartButton();
      return;
    }

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const { data, error } = await supabaseClient.rpc("start_marathon", {
      p_mode: state.mode,
      p_display_name: ""
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
    state.nextSongId = data[0].song_id;

    await startMarathonSong();
  }

  async function startMarathonSong() {
    if (!state.runId || !state.nextSongId) {
      setStatus("status_error");
      resetRun();
      updateStartButton();
      return;
    }

    const song = state.songs.find((s) => s.id === state.nextSongId);
    if (!song || !song.video_id) {
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
      p_song_id: state.nextSongId,
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
    // FIX #2: serverStartMs は使わない。beginPlay() 内で clientStartMs を記録する
    state.runPosition = data[0].song_pos;
    state.runTotal = data[0].total_songs;

    beginPlay(data[0].start_sec || 0);
  }

  async function startAttempt() {
    resetAttempt();
    resetResult();
    setQuizActive(true);
    showView(null);

    if (state.scope === "single") {
      await startSingle();
    } else {
      await startMarathon();
    }
  }

  async function finishSingle(normalized) {
    const { data, error } = await supabaseClient.rpc("finish_single", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized,
      p_display_name: ""
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];
    if (result.status !== "ok") {
      if (result.status === "timeout") {
        await handleTimeout();
        return;
      }
      setStatus("status_wrong");
      return;
    }

    stopPlay(); // FIX #6: 共通関数を使用
    updateNowPlaying(true);

    const timeMs = result.time_ms || 0;
    // FIX #7: result サブオブジェクトに集約
    state.result.pendingScoreId = result.pending_id;
    state.result.timeMs = timeMs;
    state.result.scope = "single";
    state.result.mode = state.mode;
    state.result.songId = state.currentSong?.id || null;

    showResult(true, timeMs);
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
      stopPlay(); // FIX #6
      setStatus("status_failed");
      updateNowPlaying(true);
      resetRun();
      updateProgress();
      showResult(false, null);
      return;
    }

    if (result.status === "timeout" || result.status === "run_not_active") {
      stopPlay(); // FIX #6
      setStatus("status_failed");
      updateNowPlaying(true);
      resetRun();
      updateProgress();
      showResult(false, null);
      return;
    }

    if (result.status === "next") {
      stopPlay(); // FIX #6
      updateNowPlaying(true);

      const timeMs = result.time_ms || 0;
      ui.timer.textContent = formatTime(timeMs);
      ui.timer.classList.remove("flash");
      void ui.timer.offsetWidth;
      ui.timer.classList.add("flash");
      setStatus("status_next");

      state.runPosition = result.next_song_pos;
      state.nextSongId = result.next_song_id;
      updateProgress();

      setTimeout(() => {
        startMarathonSong();
      }, 500);
      return;
    }

    if (result.status === "completed") {
      stopPlay(); // FIX #6
      updateNowPlaying(true);

      const totalMs = result.total_ms || 0;
      // FIX #7: result サブオブジェクトに集約
      state.result.pendingScoreId = result.pending_id;
      state.result.timeMs = totalMs;
      state.result.scope = "marathon";
      state.result.mode = state.mode;
      state.result.songId = null;

      resetRun();
      updateProgress();
      showResult(true, totalMs);
    }
  }

  async function submitAnswer() {
    if (!state.playing) return;
    const selectedId = ui.answerSelect.value;
    if (!selectedId) return;

    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }

    // FIX #1: クライアント側での答え合わせを廃止。
    // サーバー（finish_single / finish_marathon_song）が answers_normalized で正誤を判定するので
    // ここでは選択された曲の正規化済み答えをそのまま送るだけでよい。
    const selectedOption = ui.answerSelect.selectedOptions[0];
    const selectedSong = state.songs.find((song) => song.id === selectedId);
    const normalized = selectedOption?.dataset?.answer || getAnswerNormForSong(selectedSong);

    if (state.scope === "marathon") {
      await finishMarathon(normalized);
      return;
    }

    await finishSingle(normalized);
  }

  function renderLeaderboardRows(rows, container) {
    container.innerHTML = "";
    if (!rows || rows.length === 0) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty";
      cell.textContent = i18n[state.language].ranking_empty;
      emptyRow.appendChild(cell);
      container.appendChild(emptyRow);
      return;
    }

    rows.forEach((row) => {
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
      container.appendChild(tr);
    });
  }

  async function loadLeaderboard(scope, mode, songId, container) {
    if (!supabaseClient) return;
    let query = supabaseClient
      .from("leaderboard")
      .select("rank, display_name, time_ms, song_id, scope")
      .eq("scope", scope)
      .eq("mode", mode)
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

    renderLeaderboardRows(data, container);
    return data;
  }

  async function loadSetupLeaderboard() {
    if (!supabaseClient || !songsLoaded) return;
    if (state.scope !== "marathon") return;
    const mode = state.mode;
    await loadLeaderboard("marathon", mode, null, ui.leaderboardSetup);
  }

  async function loadRankingLeaderboard() {
    if (!supabaseClient || !songsLoaded) return;
    const mode = ui.rankingMode.value;
    const scope = ui.rankingScope.value;
    const songId = ui.rankingSong.value || state.songs[0]?.id;
    ui.rankingSongWrap.classList.toggle("hidden", scope !== "single");

    if (scope === "single") {
      await loadLeaderboard(scope, mode, songId, ui.leaderboardRanking);
    } else {
      await loadLeaderboard(scope, mode, null, ui.leaderboardRanking);
    }
  }

  async function showResult(success, timeMs) {
    resetAttempt();
    stopPlayer();
    setQuizActive(false);
    showView("result");

    if (!success || !timeMs) {
      ui.resultTime.textContent = "-";
      ui.resultMessage.textContent = i18n[state.language].status_failed;
      ui.saveBlock.classList.add("hidden");
      return;
    }

    ui.resultTime.textContent = formatTime(timeMs);
    ui.resultMessage.textContent = i18n[state.language].status_correct;

    // FIX #7: state.result サブオブジェクトを参照
    if (state.result.pendingScoreId) {
      ui.saveBlock.classList.remove("hidden");
    } else {
      ui.saveBlock.classList.add("hidden");
      ui.resultMessage.textContent = i18n[state.language].status_not_qualified;
    }
  }

  async function submitScore() {
    // FIX #7: state.result サブオブジェクトを参照
    if (!state.result.pendingScoreId) return;
    const name = ui.resultName.value.trim();
    const { data, error } = await supabaseClient.rpc("submit_score", {
      p_pending_id: state.result.pendingScoreId,
      p_display_name: name
    });

    if (error || !data || !data[0] || data[0].status !== "ok") {
      console.error(error);
      ui.resultMessage.textContent = i18n[state.language].status_error;
      return;
    }

    ui.resultMessage.textContent = i18n[state.language].status_saved;
    ui.saveBlock.classList.add("hidden");
    state.result.pendingScoreId = null;
    await loadSetupLeaderboard();
    await loadRankingLeaderboard();
  }

  function bindEvents() {
    ui.goSetup.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      showView("setup");
      loadSetupLeaderboard();
    });
    ui.goRanking.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      stopPlayer();
      showView("ranking");
      loadRankingLeaderboard();
    });
    ui.backHome.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      stopPlayer();
      showView("home");
    });
    ui.resultHome.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      stopPlayer();
      showView("home");
    });
    ui.rankingHome.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      stopPlayer();
      showView("home");
    });
    ui.playAgain.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      showView("setup");
      loadSetupLeaderboard();
    });
    ui.goRankingFromResult.addEventListener("click", () => {
      setQuizActive(false);
      resetAttempt();
      stopPlayer();
      showView("ranking");
      loadRankingLeaderboard();
    });

    ui.startBtn.addEventListener("click", startAttempt);
    ui.submitBtn.addEventListener("click", submitAnswer);
    ui.answerSelect.addEventListener("change", () => {
      ui.submitBtn.disabled = !ui.answerSelect.value;
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

    ui.rankingMode.addEventListener("change", loadRankingLeaderboard);
    ui.rankingScope.addEventListener("change", loadRankingLeaderboard);
    ui.rankingSong.addEventListener("change", loadRankingLeaderboard);

    ui.saveScore.addEventListener("click", submitScore);

    ui.langToggle.addEventListener("click", () => {
      state.language = state.language === "ja" ? "en" : "ja";
      applyTranslations();
      loadSetupLeaderboard();
      loadRankingLeaderboard();
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
    updateStartButton();
  }

  function createPlayerIfReady() {
    if (!youtubeReady || !songsLoaded || player) return;
    const firstSong = state.songs.find((song) => song.video_id);
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
        ...(window.location.origin && window.location.origin !== "null"
          ? { origin: window.location.origin }
          : {})
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
    showView("home");   // ← showView内でplayer-panelも非表示になる
    setQuizActive(false);
  }

  init();
})();