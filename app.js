(() => {
  const config = window.APP_CONFIG || {};
  const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  const FLASH_CLIP_SECONDS = 1.0;
  const FLASH_CLIP_POLL_MS = 100;

  const STATUS_TEXT = {
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
    status_flash_correct: "✓ 正解!",
    status_flash_wrong: "✗ 不正解",
    status_flash_timeout: "⏰ 時間切れ"
  };

  const TEXT = {
    hidden: "非表示",
    ranking_empty: "まだ記録がありません",
    player: "プレイヤー",
    time: "タイム",
    flash_correct_col: "正解",
    flash_result_time: "合計タイム",
    result_rank_1: "🥇 1位獲得！",
    congrats_subtitle: "Top 30 ランクイン！",
    mode_intro: "Intro",
    mode_random: "Random",
    scope_flash: "Flash",
    scope_single: "Single",
    scope_marathon: "Marathon",
    you_label: "▶ あなた",
    anonymous: "匿名",
    marathon_label: "Marathon"
  };

  const ANONYMOUS_DB_NAME = "Anonymous";

  const state = {
    songs: [],
    mode: "intro",
    scope: "single",
    currentSong: null,
    attemptId: null,
    startSec: 0,        // 再生開始位置（秒）。Intro=0、Randomは任意
    runId: null,
    runPosition: 0,
    runTotal: 0,
    nextSongId: null,
    result: {
      pendingScoreId: null,
      timeMs: null,
      scope: null,
      mode: null,
      songId: null,
      rank: null
    },
    accumulatedMs: 0,     // PLAYING状態の累積時間（Date.now()ベース）
    lastPlayStart: null,  // 最後にPLAYINGになった時刻（Date.now()）
    songTimes: [],     // marathon: 曲ごとのタイム(ms)を蓄積
    selectedSong: null,   // インクリメンタルサーチで選択中の曲
    searchActiveIndex: -1, // キーボードで選択中のリスト位置
    playing: false,
    submitting: false, // 二重送信防止フラグ
    playerReady: false,
    statusKey: hasConfig ? "status_ready" : "status_config",
    view: "home",
    // Flash モード専用
    flashCorrect: 0,          // 現在の正解数
    flashAnswered: 0,          // 回答済み曲数
    flashSongStartTime: null, // 曲開始のwall-clock（カウントダウン基準）
    flashCountdown: 10,       // 残り秒数表示用
    flashCountdownTimer: null, // setInterval ハンドル
    flashWaitingForPlay: false, // Flash: 実際にPLAYING状態になるのを待っているフラグ
    flashClipStartSec: null,    // Flash: 1.5sクリップの開始時刻(動画内秒)
    flashClipTimer: null        // Flash: 1.5s再生の監視タイマー
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
    answerInput: document.getElementById("answer-input"),
    searchList: document.getElementById("search-list"),
    searchWrap: document.getElementById("search-wrap"),
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
    rankingThSong: document.getElementById("ranking-th-song"),
    timer: document.getElementById("timer"),
    status: document.getElementById("status"),
    nowPlaying: document.getElementById("now-playing"),
    progress: document.getElementById("progress"),
    progressWrap: document.getElementById("progress-wrap"),
    quizContent: document.getElementById("quiz-content"),
    resultContent: document.getElementById("result-content"),
    showBadgeBtn: document.getElementById("show-badge-btn"),
    badgePopupOverlay: document.getElementById("badge-popup-overlay"),
    badgePopupClose: document.getElementById("badge-popup-close"),
    overlay: document.getElementById("video-overlay"),
    videoWrapper: document.getElementById("video-wrapper"),
    nextArea: document.getElementById("quiz-next"),
    nextBtn: document.getElementById("next-btn"),
    cancelBtn: document.getElementById("cancel-btn"),
    songTimeDisplay: document.getElementById("song-time-display"),
    howToPlayBtn: document.getElementById("how-to-play-btn"),
    howToPlayOverlay: document.getElementById("how-to-play-overlay"),
    howToPlayClose: document.getElementById("how-to-play-close"),
    resultRank: document.getElementById("result-rank"),
    resultLeaderboard: document.getElementById("result-leaderboard"),
    leaderboardResult: document.getElementById("leaderboard-body-result"),
    badgeBlock: document.getElementById("badge-block"),
    badgeCanvas: document.getElementById("badge-canvas"),
    shareXBtn: document.getElementById("share-x-btn"),
    downloadBadgeBtn: document.getElementById("download-badge-btn"),
    congratsBlock: document.getElementById("congrats-block"),
    congratsRankDisplay: document.getElementById("congrats-rank-display"),
    congratsSummary: document.getElementById("congrats-summary"),
    congratsSubtitle: document.getElementById("congrats-subtitle"),
    flashCountdownWrap: document.getElementById("flash-countdown-wrap"),
    flashCountdownEl: document.getElementById("flash-countdown"),
    resultLeaderboardHead: document.getElementById("result-leaderboard-head")
  };

  const supabaseClient = hasConfig && window.supabase
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;

  let player = null;
  let youtubeReady = false;
  let songsLoaded = false;
  let cueResolver = null;
  let mediaSessionInterval = null;
  let adWatchdog = null;

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
    const message = STATUS_TEXT[key] || key;
    if (ui.status) ui.status.textContent = message;
  }

  function showView(name) {
    Object.keys(ui.views).forEach((key) => {
      ui.views[key].classList.toggle("active", key === name);
    });
    state.view = name || "play";

    // home以外ではbodyにnot-homeクラスを付与してheader/footerを非表示にする
    document.body.classList.toggle("not-home", name !== "home");
    document.body.classList.toggle("view-setup", name === "setup");
    document.body.classList.toggle("view-ranking", name === "ranking");

    // setup / home / ranking ではプレイヤーパネルを非表示にする
    const hidePlayer = name === "home" || name === "ranking" || name === "setup";
    ui.playerPanel.classList.toggle("hidden", hidePlayer);

    // クイズコンテンツ vs 結果コンテンツの切り替え
    if (!hidePlayer) {
      const isResult = name === "result";
      if (ui.quizContent)  ui.quizContent.classList.toggle("hidden", isResult);
      if (ui.resultContent) ui.resultContent.classList.toggle("hidden", !isResult);
    }

    if (name === "setup") {
      updateStartButton();
    }
  }

  function getSongTitle(song) {
    return song?.title_ja || song?.title_en || "";
  }

  function formatDisplayName(name) {
    if (!name || name === ANONYMOUS_DB_NAME) return TEXT.anonymous;
    return name;
  }

  function updateSongSelects() {
    const rankingSelected = ui.rankingSong.value;

    ui.rankingSong.innerHTML = "";

    state.songs.forEach((song) => {
      const label = getSongTitle(song);

      const optionRanking = document.createElement("option");
      optionRanking.value = song.id;
      optionRanking.textContent = label;
      ui.rankingSong.appendChild(optionRanking);
    });

    if (rankingSelected) ui.rankingSong.value = rankingSelected;
  }

  function updateNowPlaying(reveal) {
    if (!ui.nowPlaying) return;
    if (!state.currentSong || !reveal) {
      ui.nowPlaying.textContent = TEXT.hidden;
      return;
    }
    ui.nowPlaying.textContent = getSongTitle(state.currentSong);
  }

  function updateProgress() {
    if (state.scope === "marathon" && state.runTotal > 0) {
      if (ui.progress) ui.progress.textContent = `${state.runPosition} / ${state.runTotal}`;
      return;
    }
    if (state.scope === "flash" && state.runTotal > 0) {
      if (ui.progress) ui.progress.textContent = `✓ ${state.flashCorrect} / ${state.flashAnswered}`;
      return;
    }
    if (ui.progress) ui.progress.textContent = "-";
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
    // Flash はモード（開始位置）選択不要（常にランダム開始）
    const modeControl = ui.modeToggle.closest(".control");
    if (modeControl) modeControl.classList.toggle("hidden", scope === "flash");
    ui.setupRanking.classList.toggle("hidden", scope === "single");
    ui.playerPanel.classList.toggle("marathon-mode", scope === "marathon" || scope === "flash");
    updateProgress();
    updateStartButton();
    loadSetupLeaderboard();
  }

  function resetRun() {
    state.runId = null;
    state.runPosition = 0;
    state.runTotal = 0;
    state.nextSongId = null;
    state.songTimes = [];
    state.flashCorrect = 0;
    state.flashAnswered = 0;
    state.flashSongStartTime = null;
  }

  function stopPlay() {
    // PLAYING中だった場合、ここで累積を確定する
    if (state.lastPlayStart !== null) {
      state.accumulatedMs += Date.now() - state.lastPlayStart;
      state.lastPlayStart = null;
    }
    state.playing = false;
    state.submitting = false;
    state.flashWaitingForPlay = false;
    clearFlashClipMonitor();
    // MediaSession 上書きインターバルを停止
    if (mediaSessionInterval) {
      clearInterval(mediaSessionInterval);
      mediaSessionInterval = null;
    }
    ui.videoWrapper.classList.remove("is-obscured");
  }

  function resetAttempt() {
    state.attemptId = null;
    state.startSec = 0;
    state.accumulatedMs = 0;
    state.lastPlayStart = null;
    stopPlay();
  }

  // FIX #7: result サブオブジェクトをリセット
  function resetResult() {
    state.result = {
      pendingScoreId: null,
      timeMs: null,
      scope: null,
      mode: null,
      songId: null,
      rank: null
    };
    ui.resultTime.textContent = "0.000";
    ui.resultMessage.textContent = "";
    ui.resultName.value = "";
    ui.saveBlock.classList.add("hidden");
    ui.resultRank.classList.add("hidden");
    ui.resultRank.textContent = "";
    ui.badgeBlock.classList.add("hidden");
    ui.resultLeaderboard.classList.add("hidden");
    ui.leaderboardResult.innerHTML = "";
    // Congrats block reset
    ui.congratsBlock.classList.add("hidden");
    ui.congratsRankDisplay.textContent = "";
    ui.congratsSummary.textContent = "";
  }

  function updateStartButton() {
    ui.startBtn.disabled = state.playing || !hasConfig || !songsLoaded;
  }

  function setQuizActive(active) {
    ui.playerPanel.classList.toggle("play-active", active);
    ui.cancelBtn.classList.toggle("hidden", !active);
    if (active) {
      ui.quizAnswer.style.display = "";
    } else {
      closeSearch();
      ui.answerInput.value = "";
      ui.nextArea.classList.add("hidden");
      ui.songTimeDisplay.textContent = "";
      ui.quizAnswer.style.display = "";
      state.selectedSong = null;
      state.searchActiveIndex = -1;
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
    return normalizeAnswer(getSongTitle(song));
  }

  // ── インクリメンタルサーチ ──────────────────────────────────
  function escapeHtml(str) {
    return str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, idx)) +
      "<mark>" + escapeHtml(text.slice(idx, idx + query.length)) + "</mark>" +
      escapeHtml(text.slice(idx + query.length))
    );
  }

  function getFilteredSongs(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return state.songs;
    return state.songs.filter((song) => {
      const titleJa = (song.title_ja || "").toLowerCase();
      const titleEn = (song.title_en || "").toLowerCase();
      return (
        titleJa.includes(q) ||
        titleEn.includes(q) ||
        song.id.toLowerCase().includes(q)
      );
    });
  }

  function renderSearchList(songs, query) {
    ui.searchList.innerHTML = "";
    state.searchActiveIndex = -1;
    if (!songs.length) {
      ui.searchList.classList.add("hidden");
      return;
    }
    songs.forEach((song, i) => {
      const li = document.createElement("li");
      const title = getSongTitle(song);
      const label = highlightMatch(title, query);
      li.innerHTML = `<span class="song-ja">${label}</span>`;
      li.dataset.songId = song.id;
      li.addEventListener("mousedown", (e) => {
        // mousedown で選択 (blur より先に発火させる)
        e.preventDefault();
        selectAndSubmit(song);
      });
      ui.searchList.appendChild(li);
    });
    ui.searchList.classList.remove("hidden");
  }

  function openSearch() {
    const q = ui.answerInput.value;
    const songs = getFilteredSongs(q);
    renderSearchList(songs, q);
  }

  function closeSearch() {
    ui.searchList.classList.add("hidden");
    state.searchActiveIndex = -1;
  }

  function moveSearchActive(dir) {
    const items = ui.searchList.querySelectorAll("li");
    if (!items.length) return;
    items[state.searchActiveIndex]?.classList.remove("active");
    state.searchActiveIndex = Math.max(0,
      Math.min(items.length - 1, state.searchActiveIndex + dir));
    const active = items[state.searchActiveIndex];
    active.classList.add("active");
    active.scrollIntoView({ block: "nearest" });
  }

  function selectAndSubmit(song) {
    if (!state.playing) return;
    state.selectedSong = song;
    ui.answerInput.value = getSongTitle(song);
    closeSearch();
    // 即座に回答送信
    submitAnswer();
  }
  // ────────────────────────────────────────────────────────────

  // 経過時間をミリ秒で返す（wall-clock × PLAYING状態の累積）
  // 広告中・BUFFERING中・Reload中は lastPlayStart が null のため加算されない
  function getElapsedMs() {
    let ms = state.accumulatedMs;
    if (state.lastPlayStart !== null) {
      ms += Date.now() - state.lastPlayStart;
    }
    return Math.max(1, Math.round(ms));
  }



  function stopPlayer() {
    if (player && typeof player.stopVideo === "function") {
      player.stopVideo();
    }
  }

  async function cleanupAttempt() {
    if (!supabaseClient || !state.attemptId) return;
    try {
      await supabaseClient.rpc("finish_attempt", {
        p_attempt_id: state.attemptId,
        p_answer_norm: "",
        p_time_ms: getElapsedMs()
      });
    } catch (error) {
      console.warn(error);
    }
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

  async function reloadVideo() {
    if (!state.currentSong || !player) return;
    stopPlay();
    ui.videoWrapper.classList.add("is-obscured");
    await cueVideo(state.currentSong.video_id);
    if (state.scope === "flash") {
      beginFlashPlay(state.startSec);
    } else {
      beginPlay(state.startSec);
    }
  }

  function beginPlay(startSec) {
    state.playing = true;
    state.startSec = startSec || 0;
    // accumulatedMs はここでリセットしない（Reload時に累積を引き継ぐため）
    // リセットは新ゲーム開始時の resetAttempt() で行う
    state.lastPlayStart = null;
    state.selectedSong = null;
    ui.videoWrapper.classList.add("is-obscured");
    setStatus("status_playing");

    // [FIX] MediaSession のタイトル・サムネイルを非表示にする（Control Center対策）
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      if (mediaSessionInterval) clearInterval(mediaSessionInterval);
      mediaSessionInterval = setInterval(() => {
        if (navigator.mediaSession.metadata !== null) {
          navigator.mediaSession.metadata = null;
        }
      }, 500);
    }

    // クイズ開始時に入力欄をクリアしてフォーカス
    ui.answerInput.value = "";
    closeSearch();
    // 少し遅延させて確実にフォーカスが当たるようにする
    setTimeout(() => ui.answerInput.focus(), 100);

    if (player && state.currentSong?.video_id) {
      player.seekTo(startSec || 0, true);
      player.playVideo();
    }
  }

  async function startSingle() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (!await ensurePlayerReady()) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }
    if (!player) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const validSongs = state.songs.filter((s) => s.video_id);
    if (!validSongs.length) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }
    const song = validSongs[Math.floor(Math.random() * validSongs.length)];

    state.currentSong = song;
    updateNowPlaying(false);
    updateProgress();

    ui.videoWrapper.classList.add("is-obscured");
    await cueVideo(song.video_id);

    let maxStartSec = 0;
    if (state.mode === "random") {
      const duration = await getDurationSafe();
      maxStartSec = Math.max(0, Math.floor(duration) - 10);
    }

    const { data, error } = await supabaseClient.rpc("start_attempt", {
      p_song_id: song.id,
      p_mode: state.mode,
      p_run_id: null,
      p_max_start_sec: maxStartSec
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }

    state.attemptId = data[0].attempt_id;
    beginPlay(data[0].start_sec || 0);
  }

  async function startMarathon() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (!await ensurePlayerReady()) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }
    if (!player) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const { data, error } = await supabaseClient.rpc("start_marathon", {
      p_mode: state.mode
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      setQuizActive(false); showView("setup");
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
    // 曲ごとにリセット（Reload時は beginPlay() がリセットしないので曲内累積は維持される）
    state.accumulatedMs = 0;
    state.lastPlayStart = null;

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

    // サムネが一瞬見えないようにcueVideo前からオーバーレイを表示
    ui.videoWrapper.classList.add("is-obscured");
    // next-area を隠して answer-area を再表示
    ui.nextArea.classList.add("hidden");
    ui.songTimeDisplay.textContent = "";
    setQuizActive(true);
    await cueVideo(song.video_id);

    let maxStartSec = 0;
    if (state.mode === "random") {
      const duration = await getDurationSafe();
      maxStartSec = Math.max(0, Math.floor(duration) - 10);
    }

    const { data, error } = await supabaseClient.rpc("start_attempt", {
      p_song_id: state.nextSongId,
      p_mode: state.mode,
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
    beginPlay(data[0].start_sec || 0);
  }

  async function startAttempt() {
    resetAttempt();
    resetResult();
    setQuizActive(true);
    showView(null);

    if (state.scope === "single") {
      await startSingle();
    } else if (state.scope === "marathon") {
      await startMarathon();
    } else {
      await startFlash();
    }
  }

  async function finishSingle(normalized) {
    const clientTimeMs = getElapsedMs();
    const { data, error } = await supabaseClient.rpc("finish_attempt", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized,
      p_time_ms: clientTimeMs
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];
    if (result.status !== "ok") {
      setStatus("status_wrong");
      return;
    }

    stopPlay();
    updateNowPlaying(true);

    const timeMs = result.song_time_ms || clientTimeMs;
    state.result.pendingScoreId = result.score_id;
    state.result.timeMs = timeMs;
    state.result.scope = "single";
    state.result.mode = state.mode;
    state.result.songId = state.currentSong?.id || null;

    showResult(true, timeMs);
  }

  async function finishMarathon(normalized) {
    const clientTimeMs = getElapsedMs();
    const { data, error } = await supabaseClient.rpc("finish_attempt", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized,
      p_time_ms: clientTimeMs
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];

    if (result.status === "wrong") {
      stopPlay();
      setStatus("status_failed");
      updateNowPlaying(true);
      resetRun();
      updateProgress();
      showResult(false, null);
      return;
    }

    if (result.status === "next") {
      stopPlay();
      updateNowPlaying(true);

      // 曲ごとのタイムを表示（clientTimeMs はあくまで画面表示用）
      const pos = state.runPosition; // まだ更新前の現在曲番号
      ui.songTimeDisplay.textContent = `#${pos}  ${formatTime(clientTimeMs)}`;

      setStatus("status_next");

      state.runPosition = result.next_song_pos;
      state.nextSongId = result.next_song_id;
      updateProgress();

      closeSearch();
      ui.answerInput.value = "";
      ui.quizAnswer.style.display = "none";
      ui.nextArea.classList.remove("hidden");
      return;
    }

    if (result.status === "completed") {
      stopPlay();
      updateNowPlaying(true);

      // DBが返す合計タイムを権威ある値として使用する
      // （クライアント側で再計算すると v_clamped_ms との差異が生じるため）
      const totalMs = result.total_ms;

      state.result.pendingScoreId = result.score_id;
      state.result.timeMs = totalMs;
      state.result.scope = "marathon";
      state.result.mode = state.mode;
      state.result.songId = null;

      resetRun();
      updateProgress();
      showResult(true, totalMs);
    }
  }

  // ── Flash モード ──────────────────────────────────────────────

  function clearFlashCountdown() {
    if (state.flashCountdownTimer) {
      clearInterval(state.flashCountdownTimer);
      state.flashCountdownTimer = null;
    }
    if (ui.flashCountdownWrap) ui.flashCountdownWrap.classList.add("hidden");
  }

  function clearFlashClipMonitor() {
    if (state.flashClipTimer) {
      clearInterval(state.flashClipTimer);
      state.flashClipTimer = null;
    }
    state.flashClipStartSec = null;
  }

  function startFlashClipMonitor() {
    if (!player) return;
    clearFlashClipMonitor();

    state.flashClipTimer = setInterval(() => {
      if (!state.playing || state.scope !== "flash") {
        clearFlashClipMonitor();
        return;
      }
      if (!player) return;
      if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;

      const currentSec = player.getCurrentTime();
      if (!Number.isFinite(currentSec)) return;

      if (state.flashClipStartSec === null) {
        state.flashClipStartSec = currentSec;
        if (!state.flashSongStartTime) {
          state.flashSongStartTime = Date.now();
        }
        return;
      }

      if (currentSec - state.flashClipStartSec >= FLASH_CLIP_SECONDS) {
        clearFlashClipMonitor();
        if (!state.playing) return;
        player.pauseVideo();
        startFlashCountdown();
        setTimeout(() => ui.answerInput.focus(), 50);
      }
    }, FLASH_CLIP_POLL_MS);
  }

  function startFlashCountdown() {
    state.flashCountdown = 10;
    if (ui.flashCountdownWrap) ui.flashCountdownWrap.classList.remove("hidden");
    if (ui.flashCountdownEl) {
      ui.flashCountdownEl.textContent = state.flashCountdown;
      ui.flashCountdownEl.classList.remove("urgent");
    }

    state.flashCountdownTimer = setInterval(() => {
      state.flashCountdown -= 1;
      if (ui.flashCountdownEl) {
        ui.flashCountdownEl.textContent = state.flashCountdown;
        ui.flashCountdownEl.classList.toggle("urgent", state.flashCountdown <= 3);
      }
      if (state.flashCountdown <= 0) {
        clearFlashCountdown();
        handleFlashTimeout();
      }
    }, 1000);
  }

  async function handleFlashTimeout() {
    if (!state.playing || !state.attemptId) return;
    if (state.submitting) return;
    state.submitting = true;
    stopPlay();
    await finishFlashSong(""); // 空文字 = タイムアウト = 不正解
    state.submitting = false;
  }

  // Flash: 1.5秒だけ再生してポーズ → カウントダウン開始
  function beginFlashPlay(startSec) {
    state.playing = true;
    state.startSec = startSec;
    state.lastPlayStart = null;
    state.selectedSong = null;
    state.flashSongStartTime = null;
    clearFlashCountdown();
    clearFlashClipMonitor();

    ui.videoWrapper.classList.add("is-obscured");
    setStatus("status_playing");

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      if (mediaSessionInterval) clearInterval(mediaSessionInterval);
      mediaSessionInterval = setInterval(() => {
        if (navigator.mediaSession.metadata !== null) navigator.mediaSession.metadata = null;
      }, 500);
    }

    ui.answerInput.value = "";
    closeSearch();

    if (player && state.currentSong?.video_id) {
      player.seekTo(startSec, true);
      player.playVideo();

      // onStateChange で実際に PLAYING になった後、
      // CurrentTime の進行が 1.5s 分確認できたら pause する
      state.flashWaitingForPlay = true;
    }
  }

  async function finishFlashSong(normalized) {
    // wall-clock タイム（曲開始 → 回答送信、max 10s）
    const clientTimeMs = state.flashSongStartTime
      ? Math.min(10000, Math.max(1, Date.now() - state.flashSongStartTime))
      : 10000;
    clearFlashCountdown();

    const { data, error } = await supabaseClient.rpc("finish_flash_song", {
      p_attempt_id: state.attemptId,
      p_answer_norm: normalized,
      p_time_ms: clientTimeMs
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      return;
    }

    const result = data[0];
    const wasCorrect = result.is_correct;

    // 正解数・回答数を更新
    state.flashCorrect = result.correct_count ?? state.flashCorrect;
    state.flashAnswered += 1;
    updateProgress();
    updateNowPlaying(true); // 曲名を表示

    if (result.status === "completed") {
      stopPlay();
      setStatus(wasCorrect ? "status_flash_correct" : "status_flash_wrong");

      state.result.pendingScoreId = result.score_id;
      state.result.timeMs = result.total_ms;
      state.result.scope = "flash";
      state.result.mode = "random";
      state.result.songId = null;
      state.result.correctCount = result.correct_count;
      state.result.totalSongs = result.total_songs;

      resetRun();
      updateProgress();
      showResult(true, result.total_ms);
      return;
    }

    // correct / wrong: 次の曲ボタンを表示
    stopPlay();
    setStatus(wasCorrect ? "status_flash_correct" : "status_flash_wrong");

    const pos = state.flashAnswered;
    ui.songTimeDisplay.textContent = wasCorrect ? `#${pos} ✓` : `#${pos} ✗`;

    state.runPosition = result.next_song_pos;
    state.nextSongId = result.next_song_id;

    closeSearch();
    ui.answerInput.value = "";
    ui.quizAnswer.style.display = "none";
    ui.nextArea.classList.remove("hidden");
  }

  async function startFlash() {
    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }
    if (!await ensurePlayerReady()) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }
    if (!player) {
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }

    setStatus("status_loading");
    ui.startBtn.disabled = true;

    const { data, error } = await supabaseClient.rpc("start_flash");

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error");
      setQuizActive(false); showView("setup");
      updateStartButton();
      return;
    }

    state.runId = data[0].run_id;
    state.runTotal = data[0].total_songs;
    state.runPosition = data[0].current_position;
    state.nextSongId = data[0].song_id;
    state.flashCorrect = 0;
    state.flashAnswered = 0;

    await startFlashSong();
  }

  async function startFlashSong() {
    // 曲ごとにリセット
    state.accumulatedMs = 0;
    state.lastPlayStart = null;
    state.flashSongStartTime = null;

    if (!state.runId || !state.nextSongId) {
      setStatus("status_error"); resetRun(); updateStartButton(); return;
    }

    const song = state.songs.find((s) => s.id === state.nextSongId);
    if (!song || !song.video_id) {
      setStatus("status_error"); resetRun(); updateStartButton(); return;
    }

    state.currentSong = song;
    updateNowPlaying(false);
    updateProgress();

    ui.videoWrapper.classList.add("is-obscured");
    ui.nextArea.classList.add("hidden");
    ui.songTimeDisplay.textContent = "";
    clearFlashCountdown();
    setQuizActive(true);
    await cueVideo(song.video_id);

    const duration = await getDurationSafe();
    const maxStartSec = Math.max(0, Math.floor(duration) - 10);

    const { data, error } = await supabaseClient.rpc("start_attempt", {
      p_song_id: state.nextSongId,
      p_mode: "random",
      p_run_id: state.runId,
      p_max_start_sec: maxStartSec
    });

    if (error || !data || !data[0]) {
      console.error(error);
      setStatus("status_error"); resetRun(); updateStartButton(); return;
    }

    state.attemptId = data[0].attempt_id;
    beginFlashPlay(data[0].start_sec || 0);
  }

  // ─────────────────────────────────────────────────────────────

  async function submitAnswer() {
    if (!state.playing) return;
    if (!state.attemptId) {
      console.warn("submitAnswer: attemptId is null, skipping");
      return;
    }
    if (state.submitting) {
      console.warn("submitAnswer: already submitting, skipping double submission");
      return;
    }
    const song = state.selectedSong;
    if (!song) return;

    if (!supabaseClient) {
      setStatus("status_config");
      return;
    }

    state.submitting = true;
    const normalized = getAnswerNormForSong(song);

    if (state.scope === "flash") {
      clearFlashCountdown();
      await finishFlashSong(normalized);
      state.submitting = false;
      return;
    }

    if (state.scope === "marathon") {
      await finishMarathon(normalized);
      state.submitting = false;
      return;
    }

    await finishSingle(normalized);
    state.submitting = false;
  }

  function renderLeaderboardRows(rows, container, scope) {
    container.innerHTML = "";
    const isMarathon = scope === "marathon";
    const isFlash = scope === "flash";
    const colCount = (isMarathon || isFlash) ? 3 : 4;

    if (!rows || rows.length === 0) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = colCount;
      cell.className = "empty";
      cell.textContent = TEXT.ranking_empty;
      emptyRow.appendChild(cell);
      container.appendChild(emptyRow);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");

      let html;
      if (isFlash) {
        // Flash: # | Player | 正解 | タイム
        html = `
          <td>${row.rank}</td>
          <td>${formatDisplayName(row.display_name)}</td>
          <td>${row.correct_count ?? "-"}</td>
          <td>${formatTime(row.time_ms)}</td>
        `;
      } else {
        html = `
          <td>${row.rank}</td>
          <td>${formatDisplayName(row.display_name)}</td>
          <td>${formatTime(row.time_ms)}</td>
        `;
        if (!isMarathon) {
          const song = state.songs.find((s) => s.id === row.song_id);
          const songLabel = row.song_id ? getSongTitle(song) : "-";
          html += `<td>${songLabel || "-"}</td>`;
        }
      }

      tr.innerHTML = html;
      container.appendChild(tr);
    });
  }

  async function loadLeaderboardData(scope, mode, songId) {
    if (!supabaseClient) return [];
    let query = supabaseClient
      .from("leaderboard")
      .select("rank, display_name, time_ms, song_id, scope, correct_count")
      .eq("scope", scope)
      .eq("mode", mode)
      .order("rank", { ascending: true });
    if (scope === "single") query = query.eq("song_id", songId);
    else query = query.is("song_id", null);
    const { data, error } = await query;
    if (error) return [];
    return data || [];
  }

  // skipInsert=true: rows に既にプレイヤーのスコアが含まれているので挿入しない
  function showResultLeaderboard(rows, playerData, savedName, skipInsert) {
    const isFlash = state.result.scope === "flash";
    ui.resultLeaderboard.classList.remove("hidden");
    ui.leaderboardResult.innerHTML = "";

    // Flash の場合ヘッダーを変更
    if (ui.resultLeaderboardHead) {
      ui.resultLeaderboardHead.innerHTML = isFlash
        ? `<tr><th>#</th><th>${TEXT.player}</th><th>${TEXT.flash_correct_col}</th><th>${TEXT.time}</th></tr>`
        : `<tr><th>#</th><th>${TEXT.player}</th><th>${TEXT.time}</th></tr>`;
    }

    // playerData: flash = { correctCount, timeMs }、それ以外 = timeMs (number)
    const playerTimeMs = isFlash ? playerData?.timeMs : playerData;
    const playerCorrect = isFlash ? playerData?.correctCount : null;

    const youLabel = savedName || TEXT.you_label;

    let merged;
    let pIdx;

    if (skipInsert) {
      merged = rows.map((r) => {
        let isPlayer = false;
        if (isFlash) {
          isPlayer = r.correct_count === playerCorrect && r.time_ms === playerTimeMs &&
            (r.display_name === savedName || (!savedName && r.display_name === ANONYMOUS_DB_NAME));
        } else {
          isPlayer = r.time_ms === playerTimeMs &&
            (r.display_name === savedName || (!savedName && r.display_name === ANONYMOUS_DB_NAME));
        }
        return { ...r, isPlayer };
      });
      pIdx = merged.findIndex((r) => r.isPlayer);
      if (pIdx === -1) {
        pIdx = isFlash
          ? merged.findIndex((r) => r.correct_count === playerCorrect && r.time_ms === playerTimeMs)
          : merged.findIndex((r) => r.time_ms === playerTimeMs);
        if (pIdx !== -1) merged[pIdx] = { ...merged[pIdx], isPlayer: true };
      }
    } else {
      const playerEntry = isFlash
        ? { display_name: youLabel, time_ms: playerTimeMs, correct_count: playerCorrect, isPlayer: true }
        : { display_name: youLabel, time_ms: playerTimeMs, isPlayer: true };
      merged = [...rows];
      // Flash は correct_count DESC → time_ms ASC で挿入位置を探す
      const insertIdx = isFlash
        ? merged.findIndex((r) =>
            r.correct_count < playerCorrect ||
            (r.correct_count === playerCorrect && r.time_ms > playerTimeMs))
        : merged.findIndex((r) => r.time_ms > playerTimeMs);
      if (insertIdx === -1) merged.push(playerEntry);
      else merged.splice(insertIdx, 0, playerEntry);
      pIdx = merged.findIndex((r) => r.isPlayer);
    }

    const MAX = 10;
    const centerIdx = pIdx === -1 ? 0 : pIdx;
    let start = Math.max(0, centerIdx - Math.floor(MAX / 2));
    let end = Math.min(merged.length, start + MAX);
    if (end - start < MAX) start = Math.max(0, end - MAX);

    merged.slice(start, end).forEach((row, i) => {
      const tr = document.createElement("tr");
      if (row.isPlayer) tr.classList.add("result-my-row");
      const displayRank = start + i + 1;
      const name = row.isPlayer && !skipInsert ? youLabel : formatDisplayName(row.display_name);
      if (isFlash) {
        tr.innerHTML = `
          <td>${displayRank}</td>
          <td>${name}</td>
          <td>${row.correct_count ?? "-"}</td>
          <td>${formatTime(row.time_ms)}</td>
        `;
      } else {
        tr.innerHTML = `
          <td>${displayRank}</td>
          <td>${name}</td>
          <td>${formatTime(row.time_ms)}</td>
        `;
      }
      ui.leaderboardResult.appendChild(tr);
    });

    if (!merged.length) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = isFlash ? 4 : 3;
      cell.className = "empty";
      cell.textContent = TEXT.ranking_empty;
      emptyRow.appendChild(cell);
      ui.leaderboardResult.appendChild(emptyRow);
    }
  }

  async function loadLeaderboard(scope, mode, songId, container) {
    if (!supabaseClient) return;
    let query = supabaseClient
      .from("leaderboard")
      .select("rank, display_name, time_ms, song_id, scope, correct_count")
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

    renderLeaderboardRows(data, container, scope);
    return data;
  }

  async function loadSetupLeaderboard() {
    if (!supabaseClient || !songsLoaded) return;
    if (state.scope === "single") return;
    if (state.scope === "marathon") {
      await loadLeaderboard("marathon", state.mode, null, ui.leaderboardSetup);
    } else if (state.scope === "flash") {
      await loadLeaderboard("flash", "random", null, ui.leaderboardSetup);
    }
  }

  async function loadRankingLeaderboard() {
    if (!supabaseClient || !songsLoaded) return;
    const mode = ui.rankingMode.value;
    const scope = ui.rankingScope.value;
    const songId = ui.rankingSong.value || state.songs[0]?.id;
    ui.rankingSongWrap.classList.toggle("hidden", scope !== "single");

    if (ui.rankingThSong) {
      ui.rankingThSong.classList.toggle("hidden", scope !== "single");
    }

    if (scope === "single") {
      await loadLeaderboard(scope, mode, songId, ui.leaderboardRanking);
    } else {
      // Flash は mode が常に "random"
      const effectiveMode = scope === "flash" ? "random" : mode;
      await loadLeaderboard(scope, effectiveMode, null, ui.leaderboardRanking);
    }
  }

  async function showResult(success, timeMs) {
    resetAttempt();
    stopPlayer();
    setQuizActive(false);
    showView("result");

    if (!success || timeMs == null) {
      ui.resultTime.textContent = "-";
      ui.resultMessage.textContent = STATUS_TEXT.status_failed;
      ui.saveBlock.classList.add("hidden");
      ui.congratsBlock.classList.add("hidden");
      ui.resultLeaderboard.classList.add("hidden");
      return;
    }

    const isFlash = state.result.scope === "flash";
    const correctCount = state.result.correctCount ?? 0;
    const totalSongs = state.result.totalSongs ?? state.runTotal;

    // Flash: 正解数を大きく表示、タイムを副表示
    if (isFlash) {
      ui.resultTime.textContent = `${correctCount} / ${totalSongs}`;
      ui.resultMessage.textContent = `${TEXT.flash_result_time}: ${formatTime(timeMs)}s`;
    } else {
      ui.resultTime.textContent = formatTime(timeMs);
    }

    // ランキングデータを取得して予測順位を計算
    let rows = [];
    let projectedRank = null;
    if (supabaseClient && state.result.scope) {
      rows = await loadLeaderboardData(
        state.result.scope,
        state.result.mode,
        state.result.scope === "single" ? state.result.songId : null
      );
      if (isFlash) {
        // Flash: correct_count DESC → time_ms ASC
        const betterCount = rows.filter((r) =>
          r.correct_count > correctCount ||
          (r.correct_count === correctCount && r.time_ms < timeMs)
        ).length;
        projectedRank = betterCount + 1;
      } else {
        const betterCount = rows.filter((r) => r.time_ms < timeMs).length;
        projectedRank = betterCount + 1;
      }
      state.result.rank = projectedRank;
    }

    if (state.result.pendingScoreId) {
      // ── Top 30 ランクイン！おめでとう画面を表示 ──
      ui.resultMessage.textContent = isFlash
        ? `${TEXT.flash_result_time}: ${formatTime(timeMs)}s`
        : "";
      ui.congratsBlock.classList.remove("hidden");

      // 順位表示
      const rankLabel = projectedRank === 1
        ? TEXT.result_rank_1
        : `#${projectedRank}`;
      ui.congratsRankDisplay.textContent = rankLabel;
      if (ui.congratsSubtitle) {
        ui.congratsSubtitle.textContent = TEXT.congrats_subtitle;
      }

      // サマリー
      const songTitle = state.result.songId
        ? getSongTitle(state.songs.find((s) => s.id === state.result.songId))
        : null;
      const modeLabel = state.result.mode === "intro"
        ? TEXT.mode_intro
        : TEXT.mode_random;
      const scopeLabel = isFlash
        ? TEXT.scope_flash
        : state.result.scope === "single"
          ? TEXT.scope_single
          : TEXT.scope_marathon;
      ui.congratsSummary.textContent = [modeLabel, scopeLabel, songTitle].filter(Boolean).join(" · ");

      // バッジを予測順位で先描画
      drawBadge(projectedRank, isFlash ? correctCount : timeMs, songTitle, state.result.mode, state.result.scope);

      // 保存ブロックを表示
      ui.saveBlock.classList.remove("hidden");

      // 予測順位込みのランキングテーブルを表示
      const playerData = isFlash ? { correctCount, timeMs } : timeMs;
      showResultLeaderboard(rows, playerData, null, false);
    } else {
      // Top30外
      ui.resultMessage.textContent = isFlash
        ? `${TEXT.flash_result_time}: ${formatTime(timeMs)}s  ${STATUS_TEXT.status_not_qualified}`
        : STATUS_TEXT.status_not_qualified;
      ui.congratsBlock.classList.add("hidden");
      ui.saveBlock.classList.add("hidden");
      if (rows.length > 0) {
        showResultLeaderboard(rows, null, null, true);
      }
    }
  }

  async function fetchMyRank(scope, mode, songId, timeMs) {
    if (!supabaseClient) return null;
    let query = supabaseClient
      .from("leaderboard")
      .select("rank, time_ms")
      .eq("scope", scope)
      .eq("mode", mode)
      .order("rank", { ascending: true });
    if (songId) {
      query = query.eq("song_id", songId);
    } else {
      query = query.is("song_id", null);
    }
    const { data, error } = await query;
    if (error || !data) return null;
    // 同タイムのうち最小ランクを返す
    const match = data.find((row) => row.time_ms === timeMs);
    return match ? match.rank : null;
  }

  function drawBadge(rank, timeMs, songTitle, mode, scope) {
    const canvas = ui.badgeCanvas;
    const ctx = canvas.getContext("2d");
    const W = 600, H = 300;
    canvas.width = W;
    canvas.height = H;

    // 背景グラデーション
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0d0d1a");
    bg.addColorStop(1, "#1a0828");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 金色のトップライン
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0, "#b8860b");
    lineGrad.addColorStop(0.5, "#ffd700");
    lineGrad.addColorStop(1, "#b8860b");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, 0, W, 4);

    // ランク
    const rankLabel = rank === 1 ? "🥇 #1" : `#${rank}`;
    ctx.save();
    ctx.font = "bold 72px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 金色グロー
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ffd700";
    ctx.fillText(rankLabel, W / 2, 95);
    ctx.restore();

    // 曲名 or スコープ表示
    const label = songTitle || (scope === "marathon" ? TEXT.marathon_label : "");
    if (label) {
      ctx.font = "400 22px 'Noto Sans JP', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ccbbff";
      // 長すぎる場合は省略
      const maxWidth = W - 80;
      ctx.fillText(label, W / 2, 160, maxWidth);
    }

    // タイム
    ctx.font = "bold 44px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(formatTime(timeMs) + "s", W / 2, 210);

    // モードバッジ
    const badgeScope = scope === "single"
      ? TEXT.scope_single
      : scope === "flash"
        ? TEXT.scope_flash
        : TEXT.scope_marathon;
    const modeLabel = (mode === "intro" ? TEXT.mode_intro : TEXT.mode_random) + " · " + badgeScope;
    ctx.font = "500 16px 'DM Mono', monospace";
    ctx.fillStyle = "#888899";
    ctx.fillText(modeLabel, W / 2, 255);

    // ブランディング
    ctx.font = "300 13px sans-serif";
    ctx.fillStyle = "#444455";
    ctx.fillText("YOASOBI Intro Quiz  —  ni-devx.github.io/yoasobi-intro", W / 2, 284);
  }

  // X シェア専用（バッジの強制ダウンロードなし）
  async function shareOnX() {
    const rank = state.result.rank;
    const timeMs = state.result.timeMs;
    const songTitle = state.result.songId
      ? getSongTitle(state.songs.find((s) => s.id === state.result.songId))
      : null;

    const rankStr = rank === 1
      ? "🥇 1位"
      : `#${rank}位`;
    const tweetText = `YOASOBI Intro Quiz で${rankStr}を獲得！\nタイム: ${formatTime(timeMs)}s${songTitle ? `\n🎵 ${songTitle}` : ""}\nhttps://ni-devx.github.io/yoasobi-intro #YOASOBIIntroQuiz`;

    // デスクトップ: X を直接開く（ダウンロード不要）
    const xUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweetText);
    window.open(xUrl, "_blank", "noopener");
  }

  // バッジ画像ダウンロード専用
  function downloadBadge() {
    const a = document.createElement("a");
    a.href = ui.badgeCanvas.toDataURL("image/png");
    a.download = "yoasobi-quiz-badge.png";
    a.click();
  }

  async function submitScore() {
    if (!state.result.pendingScoreId) return;
    const saveBtn = ui.saveScore;
    saveBtn.disabled = true;

    const name = ui.resultName.value.trim();
    const { data, error } = await supabaseClient.rpc("submit_score", {
      p_score_id: state.result.pendingScoreId,
      p_display_name: name
    });

    if (error || !data || !data[0] || data[0].status !== "ok") {
      console.error(error);
      ui.resultMessage.textContent = STATUS_TEXT.status_error;
      saveBtn.disabled = false;
      return;
    }

    ui.saveBlock.classList.add("hidden");
    state.result.pendingScoreId = null;

    // 実際の順位を取得
    const rank = await fetchMyRank(
      state.result.scope,
      state.result.mode,
      state.result.songId,
      state.result.timeMs
    );
    state.result.rank = rank;

    // 順位表示を確定値に更新
    if (rank) {
      const rankLabel = rank === 1
        ? TEXT.result_rank_1
        : `#${rank}`;
      ui.congratsRankDisplay.textContent = rankLabel;
    }

    // バッジを確定順位で再描画
    const songTitle = state.result.songId
      ? getSongTitle(state.songs.find((s) => s.id === state.result.songId))
      : null;
    const isFlash = state.result.scope === "flash";
    drawBadge(rank, isFlash ? (state.result.correctCount ?? 0) : state.result.timeMs, songTitle, state.result.mode, state.result.scope);

    // 保存後の名前でランキングテーブルを更新
    const savedName = name || ANONYMOUS_DB_NAME;
    const rows = await loadLeaderboardData(
      state.result.scope,
      state.result.mode,
      state.result.scope === "single" ? state.result.songId : null
    );
    const playerData = isFlash
      ? { correctCount: state.result.correctCount ?? 0, timeMs: state.result.timeMs }
      : state.result.timeMs;
    showResultLeaderboard(rows, playerData, savedName, true);

    ui.resultMessage.textContent = STATUS_TEXT.status_saved;

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

    ui.shareXBtn.addEventListener("click", shareOnX);
    ui.downloadBadgeBtn.addEventListener("click", downloadBadge);

    // バッジポップアップ
    if (ui.showBadgeBtn) {
      ui.showBadgeBtn.addEventListener("click", () => {
        ui.badgePopupOverlay.classList.add("is-open");
      });
    }
    if (ui.badgePopupClose) {
      ui.badgePopupClose.addEventListener("click", () => {
        ui.badgePopupOverlay.classList.remove("is-open");
      });
    }
    if (ui.badgePopupOverlay) {
      ui.badgePopupOverlay.addEventListener("click", (e) => {
        if (e.target === ui.badgePopupOverlay) ui.badgePopupOverlay.classList.remove("is-open");
      });
    }

    ui.startBtn.addEventListener("click", startAttempt);

    // インクリメンタルサーチのイベント
    let isComposing = false;  // IME変換中フラグ

    ui.answerInput.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    ui.answerInput.addEventListener("compositionend", () => {
      isComposing = false;
      openSearch();
    });
    ui.answerInput.addEventListener("input", () => {
      if (isComposing) return;
      state.selectedSong = null;
      openSearch();
    });
    ui.answerInput.addEventListener("focus", () => {
      openSearch();
    });
    ui.answerInput.addEventListener("blur", () => {
      // mousedown で選択した場合は blur より先に処理されるので 150ms 遅延
      setTimeout(() => closeSearch(), 150);
    });
    ui.answerInput.addEventListener("keydown", (e) => {
      const listVisible = !ui.searchList.classList.contains("hidden");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!listVisible) openSearch();
        moveSearchActive(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSearchActive(-1);
      } else if (e.key === "Enter") {
        if (isComposing) return;
        e.preventDefault();
        const active = ui.searchList.querySelector("li.active");
        if (active) {
          const song = state.songs.find((s) => s.id === active.dataset.songId);
          if (song) selectAndSubmit(song);
        } else if (state.selectedSong && state.playing && !state.submitting) {
          // 候補をクリック選択済みで再度 Enter を押した場合
          submitAnswer();
        } else {
          // アクティブ項目なし・未選択の場合は先頭の候補を送信
          const firstItem = ui.searchList.querySelector("li");
          if (firstItem) {
            const song = state.songs.find((s) => s.id === firstItem.dataset.songId);
            if (song) selectAndSubmit(song);
          }
        }
      } else if (e.key === "Escape") {
        closeSearch();
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

    ui.rankingMode.addEventListener("change", loadRankingLeaderboard);
    ui.rankingScope.addEventListener("change", loadRankingLeaderboard);
    ui.rankingSong.addEventListener("change", loadRankingLeaderboard);

    ui.saveScore.addEventListener("click", submitScore);

    ui.nextBtn.addEventListener("click", () => {
      ui.nextArea.classList.add("hidden");
      ui.quizAnswer.style.display = "";
      if (state.scope === "flash") {
        startFlashSong();
      } else {
        startMarathonSong();
      }
    });

    ui.cancelBtn.addEventListener("click", async () => {
      await cleanupAttempt();
      stopPlay();
      resetAttempt();
      resetRun();
      stopPlayer();
      setQuizActive(false);
      showView("home");
    });

    // 遊び方ポップアップ
    ui.howToPlayBtn.addEventListener("click", () => {
      ui.howToPlayOverlay.classList.add("is-open");
    });
    ui.howToPlayClose.addEventListener("click", () => {
      ui.howToPlayOverlay.classList.remove("is-open");
    });
    ui.howToPlayOverlay.addEventListener("click", (e) => {
      if (e.target === ui.howToPlayOverlay) {
        ui.howToPlayOverlay.classList.remove("is-open");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ui.howToPlayOverlay.classList.remove("is-open");
      }
      // マラソン/Flash: 右矢印キーで次の曲へ
      if (e.key === "ArrowRight" && !ui.nextArea.classList.contains("hidden")) {
        e.preventDefault();
        ui.nextBtn.click();
      }
    });

    // 結果画面: Enter キーで保存
    ui.resultName.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (!ui.saveScore.disabled) ui.saveScore.click();
      }
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
          setStatus(hasConfig ? "status_ready" : "status_config");
        },
        onStateChange: (event) => {
          if (cueResolver && event.data === YT.PlayerState.CUED) {
            cueResolver();
            cueResolver = null;
          }

          // 1. タイマーのクリア処理 (ここが重要)
          if (event.data === YT.PlayerState.PLAYING) {
            if (adWatchdog) {
              clearTimeout(adWatchdog);
              adWatchdog = null;
            }
          }

          // 2. 監視タイマーのセット (UNSTARTED 時)
          if (event.data === YT.PlayerState.UNSTARTED && state.playing) {
            if (adWatchdog) clearTimeout(adWatchdog);
            adWatchdog = setTimeout(() => {
              // 念のためステータスを再確認
              if (state.playing && player && player.getPlayerState() === -1) {
                console.log("広告を検知、自動リロードします");
                reloadVideo();
              }
            }, 2500); 
          }

          // 3. 計測ロジック
          if (event.data === YT.PlayerState.PLAYING) {
            // PLAYING になった瞬間にwall-clock計測を開始
            if (state.lastPlayStart === null) {
              state.lastPlayStart = Date.now();
            }

            // Flash: 動画が実際に PLAYING になったら 1.5s 分の再生進行を監視
            if (state.scope === "flash" && state.flashWaitingForPlay) {
              state.flashWaitingForPlay = false;
              startFlashClipMonitor();
            }

            // Flash: カウントダウン中に動画が再開されてしまった場合は強制 pause
            if (state.scope === "flash" && !state.flashWaitingForPlay &&
                state.flashCountdownTimer && state.playing) {
              player.pauseVideo();
            }
          } else {
            // PLAYING以外になった瞬間に累積確定
            if (state.lastPlayStart !== null) {
              state.accumulatedMs += Date.now() - state.lastPlayStart;
              state.lastPlayStart = null;
            }
          }
        }
      }
    });
    window.__ytPlayer = player;
  }

  window.onYouTubeIframeAPIReady = () => {
    youtubeReady = true;
    createPlayerIfReady();
  };

  async function init() {
    bindEvents();
    setMode(state.mode);
    setScope(state.scope);
    setStatus(state.statusKey || (hasConfig ? "status_ready" : "status_config"));

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
