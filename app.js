const socket = io();
const app = document.querySelector("#app");
const params = new URLSearchParams(location.search);

const storage = {
  get mode() {
    return localStorage.getItem("aiu:mode") || "";
  },
  set mode(value) {
    localStorage.setItem("aiu:mode", value);
  },
  get roomCode() {
    return localStorage.getItem("aiu:roomCode") || "";
  },
  set roomCode(value) {
    localStorage.setItem("aiu:roomCode", value);
  },
  get playerId() {
    return localStorage.getItem("aiu:playerId") || "";
  },
  set playerId(value) {
    localStorage.setItem("aiu:playerId", value);
  },
  get nickname() {
    return localStorage.getItem("aiu:nickname") || "";
  },
  set nickname(value) {
    localStorage.setItem("aiu:nickname", value);
  }
};

let state = {
  view: params.has("room") ? "join" : "display",
  room: null,
  roomCodeDraft: params.get("room") || storage.roomCode || "",
  nicknameDraft: storage.nickname || "",
  answerDraft: "",
  error: "",
  notice: "",
  remaining: 0,
  network: { lanUrls: [] }
};

let composingAnswer = false;

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

function request(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack) => resolve(ack || { ok: false, error: "请求无响应" }));
  });
}

socket.on("connect", boot);

socket.on("room:update", (room) => {
  if (shouldKeepAnswerInput(room)) {
    state = { ...state, room, error: "" };
    updateCountdownText();
    updateLiveMetrics();
    return;
  }
  setState({ room, error: "" });
});

setInterval(() => {
  const end = state.room?.phaseEndsAt;
  const remaining = end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : 0;
  if (remaining !== state.remaining) {
    state.remaining = remaining;
    updateCountdownText();
  }
}, 500);

async function boot() {
  await loadNetworkInfo();

  if (params.has("room")) {
    setState({ view: "join", roomCodeDraft: params.get("room") || "", error: "" });
    return;
  }

  if (storage.mode === "player" && storage.roomCode && storage.playerId) {
    const ack = await request("player:resume", { roomCode: storage.roomCode, playerId: storage.playerId });
    if (ack.ok) {
      setState({ view: "player", room: ack.state, error: "" });
      return;
    }
  }

  if ((storage.mode === "display" || storage.mode === "host") && storage.roomCode) {
    const ack = await request("host:resume", { roomCode: storage.roomCode });
    if (ack.ok) {
      storage.mode = "display";
      setState({ view: "display", room: ack.state, error: "" });
      return;
    }
  }

  await createDisplayRoom();
}

async function loadNetworkInfo() {
  try {
    const response = await fetch("/network-info");
    const network = await response.json();
    state = { ...state, network };
  } catch {
    state = { ...state, network: { lanUrls: [] } };
  }
}

async function createDisplayRoom() {
  const ack = await request("host:create");
  if (!ack.ok) return setState({ view: "display", error: ack.error });
  storage.mode = "display";
  storage.roomCode = ack.roomCode;
  setState({ view: "display", room: ack.state, error: "", notice: "新房间已创建" });
  history.replaceState(null, "", location.pathname);
}

async function joinRoom() {
  const roomCode = state.roomCodeDraft.trim().toUpperCase();
  const nickname = state.nicknameDraft.trim();
  if (!roomCode || !nickname) return setState({ error: "请输入房间码和昵称" });
  const ack = await request("player:join", { roomCode, nickname, playerId: storage.playerId });
  if (!ack.ok) return setState({ error: ack.error });
  storage.mode = "player";
  storage.roomCode = roomCode;
  storage.playerId = ack.playerId;
  storage.nickname = nickname;
  setState({ view: "player", room: ack.state, error: "", notice: "" });
}

async function submitAnswer() {
  const input = document.querySelector("#answerInput");
  const answer = (input?.value ?? state.answerDraft).trim();
  if (!answer) return setState({ error: "先写一句回答" });
  const ack = await request("player:submitAnswer", {
    roomCode: state.room.code,
    playerId: storage.playerId,
    answer
  });
  if (!ack.ok) return setState({ error: ack.error });
  composingAnswer = false;
  setState({ room: ack.state, answerDraft: "", error: "" });
}

async function castVote(candidateId) {
  const ack = await request("player:castVote", {
    roomCode: state.room.code,
    playerId: storage.playerId,
    candidateId
  });
  if (!ack.ok) return setState({ error: ack.error });
  setState({ room: ack.state, error: "" });
}

async function resetLocal() {
  localStorage.removeItem("aiu:mode");
  localStorage.removeItem("aiu:roomCode");
  localStorage.removeItem("aiu:playerId");
  localStorage.removeItem("aiu:nickname");
  composingAnswer = false;
  if (state.view === "display") {
    setState({ room: null, error: "", notice: "" });
    await createDisplayRoom();
  } else {
    setState({ view: "join", room: null, error: "", notice: "" });
  }
}

function copyJoinLink() {
  const base = state.network?.lanUrls?.[0] || location.origin;
  const url = `${base}${location.pathname}?room=${encodeURIComponent(state.room.code)}`;
  navigator.clipboard?.writeText(url);
  setState({ notice: "入场链接已复制" });
}

function shouldKeepAnswerInput(nextRoom) {
  const input = document.querySelector("#answerInput");
  return Boolean(
    state.view === "player" &&
    nextRoom?.phase === "answering" &&
    input &&
    document.activeElement === input &&
    !nextRoom.me?.submittedThisRound
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function labelPhase(phase) {
  return {
    lobby: "候场",
    answering: "答题",
    reveal: "揭晓",
    voting: "投票",
    ended: "结算"
  }[phase] || "准备中";
}

function roleName(role) {
  return {
    human: "普通人类",
    human_ai: "扮 AI 的人类",
    real_ai: "真实 AI"
  }[role] || "待分配";
}

function roleGoal(role) {
  return {
    human: "你的目标：找出真正的 AI。",
    human_ai: "你的目标：让大家以为你是 AI，并投给你。",
    real_ai: "后台 AI 槽位"
  }[role] || "等待系统分配身份。";
}

function render() {
  if (state.view === "display") renderDisplay();
  else if (state.view === "player" && state.room) renderPlayer();
  else renderJoin();
  bindEvents();
  updateCountdownText();
  updateLiveMetrics();
}

function renderJoin() {
  app.className = "app-shell home-shell";
  app.innerHTML = `
    <section class="landing-grid">
      <div class="title-block">
        <p class="kicker">HUMAN OR MACHINE</p>
        <h1>谁是 AI 卧底</h1>
        <p class="lede">5 名真人加入后自动开局。第 4 名真人准备后，AI 玩家会混进名单，所有人只看回答判断谁最像 AI。</p>
      </div>
      <div class="join-panel is-open">
        <div class="panel-head">
          <span>PLAYER ENTRY</span>
          <strong>加入游戏</strong>
        </div>
        <label>房间码<input id="roomCodeInput" maxlength="6" autocomplete="off" value="${escapeHtml(state.roomCodeDraft)}" placeholder="ABC234" /></label>
        <label>昵称<input id="nicknameInput" maxlength="12" autocomplete="nickname" value="${escapeHtml(state.nicknameDraft)}" placeholder="比如：不想上班" /></label>
        <button class="primary wide" data-action="join">进入房间</button>
        ${renderMessage()}
      </div>
    </section>
  `;
}

function renderDisplay() {
  const room = state.room;
  app.className = "app-shell host-shell display-shell";
  if (!room) {
    app.innerHTML = `<section class="stage"><div class="big-number">...</div><p>正在创建观众大屏</p>${renderMessage()}</section>`;
    return;
  }
  const joinUrl = `${state.network?.lanUrls?.[0] || location.origin}${location.pathname}?room=${room.code}`;
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="kicker">AUDIENCE SCREEN</p>
        <h1>谁是 AI 卧底</h1>
      </div>
      <div class="phase-card">
        <span>${labelPhase(room.phase)}</span>
        <strong data-countdown>${displayCountdownLabel(room)}</strong>
      </div>
    </header>
    <section class="host-layout">
      <aside class="side-panel">
        <div class="room-code">${escapeHtml(room.code)}</div>
        <div class="qr"><img src="/qr/${encodeURIComponent(room.code)}.svg" alt="加入二维码" /></div>
        <p class="small">扫码加入。第 4 名真人准备后，AI 玩家会混入名单；满 5 名真人后自动开局。</p>
        <p class="url">${escapeHtml(joinUrl)}</p>
        <button class="ghost wide" data-action="copy">复制链接</button>
        <button class="danger wide" data-action="reset-local">新房间</button>
      </aside>
      <main class="stage">
        ${renderDisplayStage(room)}
      </main>
      <aside class="side-panel">
        ${renderDisplayStatus(room)}
        ${renderMessage()}
      </aside>
    </section>
  `;
}

function renderDisplayStage(room) {
  return `
    <div class="question-board">
      <span>${room.phase === "lobby" ? "等待玩家" : `第 ${room.round || 0} / ${room.totalRounds} 轮`}</span>
      <h2>${escapeHtml(room.currentQuestion || "扫码加入，系统会自动开局")}</h2>
    </div>
    ${room.phase === "lobby" ? renderRoster(room) : ""}
    ${room.phase === "answering" ? renderAnsweringProgress(room) : ""}
    ${room.phase === "reveal" ? renderReveal(room) : ""}
    ${room.phase === "voting" ? renderVoteCandidates(room, true) : ""}
    ${room.phase === "ended" ? renderResult(room) : ""}
  `;
}

function renderDisplayStatus(room) {
  return `
    <div class="control-stack">
      <div class="metric"><span>入场席位</span><strong data-player-count>${room.players.length}/6</strong></div>
      <div class="metric"><span>真人准备</span><strong>${room.humanCount}/${room.totalHumans}</strong></div>
      <div class="metric"><span>提交</span><strong data-submit-count>${room.submittedCount || 0}/${room.requiredSubmitCount || 0}</strong></div>
      <div class="metric"><span>投票</span><strong>${room.votedCount || room.votes?.length || 0}/${room.requiredVoteCount || 5}</strong></div>
      <p class="small">游戏中隐藏身份，结算时统一公开。</p>
    </div>
  `;
}

function renderPlayer() {
  const room = state.room;
  const me = room.me;
  app.className = "app-shell player-shell";
  app.innerHTML = `
    <section class="phone">
      <header class="player-top">
        <div>
          <p class="kicker">ROOM ${escapeHtml(room.code)}</p>
          <h1>${escapeHtml(me.nickname)}</h1>
        </div>
        <button class="ghost mini" data-action="reset-local">退出</button>
      </header>
      ${renderIdentity(me, room.phase)}
      <section class="player-main">
        ${room.phase === "lobby" ? renderLobbyPlayer(room) : ""}
        ${room.phase === "answering" ? renderAnswerInput(room, me) : ""}
        ${room.phase === "reveal" ? renderReveal(room) : ""}
        ${room.phase === "voting" ? renderVoteCandidates(room, false) : ""}
        ${room.phase === "ended" ? renderResult(room) : ""}
        ${renderMessage()}
      </section>
      ${renderMiniRoster(room)}
    </section>
  `;
}

function renderIdentity(me, phase) {
  const locked = !me.role;
  return `
    <section class="identity ${me.role === "human_ai" ? "special" : ""}">
      <span>${locked ? "身份未分配" : "你的身份"}</span>
      <strong>${escapeHtml(roleName(me.role))}</strong>
      <p>${escapeHtml(phase === "ended" ? "身份已公开。" : roleGoal(me.role))}</p>
    </section>
  `;
}

function renderLobbyPlayer(room) {
  return `
    <div class="wait-card">
      <h2>等待自动开局</h2>
      <p>当前 ${room.humanCount}/${room.totalHumans} 名真人玩家。满员后系统会自动开始。</p>
    </div>
  `;
}

function renderAnswerInput(room, me) {
  if (me.submittedThisRound) {
    return `
      <div class="wait-card">
        <h2>已提交</h2>
        <p>等待其他玩家和 AI 完成本轮回答。</p>
      </div>
    `;
  }
  return `
    <div class="question-board compact">
      <span>第 ${room.round}/${room.totalRounds} 轮 · <b data-countdown>${state.remaining}s</b></span>
      <h2>${escapeHtml(room.currentQuestion)}</h2>
    </div>
    <label class="answer-box">
      <span>写一句自然回答</span>
      <textarea id="answerInput" maxlength="120" rows="4" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" placeholder="短一点，像随手打的">${escapeHtml(state.answerDraft)}</textarea>
    </label>
    <button class="primary wide" data-action="submit-answer">提交回答</button>
  `;
}

function renderAnsweringProgress(room) {
  return `
    <div class="progress-board">
      <div class="big-number" data-submit-count>${room.submittedCount || 0}/${room.requiredSubmitCount || 6}</div>
      <p>正在等待所有玩家提交，本轮完成后自动揭晓。</p>
      ${renderRoster(room)}
    </div>
  `;
}

function renderReveal(room) {
  const latest = room.rounds?.[room.rounds.length - 1];
  if (!latest) return "";
  return `
    <section class="answers">
      <div class="section-head">
        <span>ROUND ${latest.round}</span>
        <h2>答案揭晓</h2>
      </div>
      <div class="answer-grid">
        ${latest.revealAnswers.map((answer) => `
          <article class="answer-card">
            <span>${escapeHtml(answer.playerNickname || answer.label)}</span>
            <p>${escapeHtml(answer.text || "（超时未作答）")}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderVoteCandidates(room, displayView) {
  return `
    <section class="answers">
      <div class="section-head">
        <span>FINAL VOTE</span>
        <h2>谁最像 AI？</h2>
      </div>
      <p class="vote-hint">${displayView ? "玩家正在投票，系统会自动结算，结算时公开身份。" : "点击一个玩家卡片投票，不能投自己。"}</p>
      <div class="candidate-grid">
        ${room.voteCandidates.map((candidate) => `
          <article class="candidate-card ${candidate.isSelf ? "self" : ""}">
            <div class="candidate-title">
              <strong>${escapeHtml(candidate.playerNickname || candidate.label)}</strong>
              ${candidate.isSelf ? "<span>这是你</span>" : ""}
            </div>
            ${candidate.answers.map((answer) => `
              <div class="candidate-answer">
                <span>R${answer.round}</span>
                <p>${escapeHtml(answer.text || "（空白）")}</p>
              </div>
            `).join("")}
            ${!displayView ? `<button class="primary wide" data-vote="${candidate.candidateId}" ${candidate.isSelf ? "disabled" : ""}>投给 ${escapeHtml(candidate.playerNickname || candidate.label)}</button>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderResult(room) {
  const result = room.result;
  const identities = room.identities || result?.identities || [];
  return `
    <section class="result">
      <p class="kicker">RESULT</p>
      <h2>${escapeHtml(winnerTitle(result?.winner))}</h2>
      <p>${escapeHtml(result?.summary || "身份公开，游戏结束")}</p>
      <div class="vote-counts">
        ${(result?.voteCounts || []).map((item) => `
          <div><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>
        `).join("")}
      </div>
      <div class="identity-grid">
        ${identities.map((item) => `
          <article class="${item.role === "real_ai" ? "real-ai" : item.role === "human_ai" ? "fake-ai" : ""}">
            <span>${escapeHtml(item.nickname)}</span>
            <strong>${escapeHtml(roleName(item.role))}</strong>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function winnerTitle(winner) {
  return {
    humans: "普通人类胜利",
    human_ai: "扮 AI 玩家胜利",
    real_ai: "真实 AI 胜利"
  }[winner] || "游戏结束";
}

function renderRoster(room) {
  return `
    <div class="roster">
      ${room.players.map((player) => `
        <div class="roster-item">
          <span>${escapeHtml(player.nickname)}</span>
          <small>${player.connected ? "在线" : "断线"}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMiniRoster(room) {
  return `
    <section class="mini-roster">
      ${room.players.map((player) => `<span>${escapeHtml(player.nickname)}</span>`).join("")}
    </section>
  `;
}

function renderMessage() {
  return `
    ${state.error ? `<p class="message error">${escapeHtml(state.error)}</p>` : ""}
    ${state.notice ? `<p class="message notice">${escapeHtml(state.notice)}</p>` : ""}
  `;
}

function displayCountdownLabel(room) {
  if (room.phase === "lobby") return `${room.players.length}/6`;
  if (room.phaseEndsAt) return `${state.remaining}s`;
  return "--";
}

function updateCountdownText() {
  document.querySelectorAll("[data-countdown]").forEach((element) => {
    if (!state.room) return;
    element.textContent = displayCountdownLabel(state.room);
  });
}

function updateLiveMetrics() {
  document.querySelectorAll("[data-submit-count]").forEach((element) => {
    if (!state.room) return;
    element.textContent = `${state.room.submittedCount || 0}/${state.room.requiredSubmitCount || 0}`;
  });
  document.querySelectorAll("[data-player-count]").forEach((element) => {
    if (!state.room) return;
    element.textContent = `${state.room.players.length}/6`;
  });
}

function bindEvents() {
  document.querySelector("[data-action='join']")?.addEventListener("click", joinRoom);
  document.querySelector("[data-action='submit-answer']")?.addEventListener("click", submitAnswer);
  document.querySelector("[data-action='reset-local']")?.addEventListener("click", resetLocal);
  document.querySelector("[data-action='copy']")?.addEventListener("click", copyJoinLink);
  document.querySelector("#roomCodeInput")?.addEventListener("input", (event) => {
    state.roomCodeDraft = event.target.value.toUpperCase();
  });
  document.querySelector("#nicknameInput")?.addEventListener("input", (event) => {
    state.nicknameDraft = event.target.value;
  });

  const answerInput = document.querySelector("#answerInput");
  answerInput?.addEventListener("compositionstart", () => {
    composingAnswer = true;
  });
  answerInput?.addEventListener("compositionend", (event) => {
    composingAnswer = false;
    state.answerDraft = event.target.value;
  });
  answerInput?.addEventListener("input", (event) => {
    if (!composingAnswer) state.answerDraft = event.target.value;
  });
  answerInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitAnswer();
  });

  document.querySelectorAll("[data-vote]").forEach((button) => {
    button.addEventListener("click", () => castVote(button.dataset.vote));
  });
}

render();
