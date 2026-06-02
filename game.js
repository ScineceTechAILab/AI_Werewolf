const crypto = require("crypto");

const TOTAL_HUMANS = 5;
const TOTAL_PLAYERS = 6;
const TOTAL_ROUNDS = 3;
const ANSWER_SECONDS = 60;
const VOTE_SECONDS = 45;

const PHASES = {
  LOBBY: "lobby",
  ANSWERING: "answering",
  REVEAL: "reveal",
  VOTING: "voting",
  ENDED: "ended"
};

const ROLES = {
  HUMAN: "human",
  HUMAN_AI: "human_ai",
  REAL_AI: "real_ai"
};

const WINNERS = {
  HUMANS: "humans",
  HUMAN_AI: "human_ai",
  REAL_AI: "real_ai"
};

function createRoom({ hostSocketId = null, now = Date.now(), code = createRoomCode() } = {}) {
  return {
    code,
    hostSocketId,
    phase: PHASES.LOBBY,
    players: [],
    round: 0,
    currentQuestion: null,
    phaseEndsAt: null,
    rounds: [],
    votes: [],
    voteCandidates: [],
    result: null,
    createdAt: now,
    updatedAt: now
  };
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function joinHuman(room, { socketId = null, nickname, playerId = null, now = Date.now() }) {
  assertPhase(room, PHASES.LOBBY);

  let player = playerId ? room.players.find((item) => item.id === playerId && item.kind === "human") : null;
  if (player) {
    player.socketId = socketId;
    player.nickname = sanitizeNickname(nickname);
    player.connected = true;
    touch(room, now);
    return player;
  }

  const humanCount = room.players.filter((item) => item.kind === "human").length;
  if (humanCount >= TOTAL_HUMANS) {
    throw new Error(`房间已满，最多 ${TOTAL_HUMANS} 名真人玩家`);
  }

  player = {
    id: makeId("p"),
    socketId,
    nickname: sanitizeNickname(nickname),
    kind: "human",
    role: null,
    connected: true,
    joinedAt: now
  };
  room.players.push(player);
  touch(room, now);
  return player;
}

function ensureAiPlayer(room, { nickname = "小林", now = Date.now() } = {}) {
  let ai = room.players.find((player) => player.kind === "ai");
  if (ai) return ai;

  ai = {
    id: makeId("ai"),
    socketId: null,
    nickname,
    kind: "ai",
    role: ROLES.REAL_AI,
    connected: true,
    joinedAt: now
  };
  room.players.push(ai);
  touch(room, now);
  return ai;
}

function startGame(room, { questions, aiNickname, now = Date.now() }) {
  assertPhase(room, PHASES.LOBBY);
  const humanPlayers = room.players.filter((player) => player.kind === "human");
  if (humanPlayers.length !== TOTAL_HUMANS) {
    throw new Error(`需要 ${TOTAL_HUMANS} 名真人玩家才能开始`);
  }
  if (!Array.isArray(questions) || questions.length < TOTAL_ROUNDS) {
    throw new Error("需要至少 3 道题目");
  }

  ensureAiPlayer(room, { nickname: aiNickname, now });
  assignRoles(room);
  startAnsweringRound(room, { question: questions[0], round: 1, now });
  return room;
}

function startNextRoundOrVoting(room, { question, now = Date.now() } = {}) {
  assertPhase(room, PHASES.REVEAL);
  if (room.round >= TOTAL_ROUNDS) {
    startVoting(room, { now });
    return room;
  }
  if (!question) throw new Error("下一轮题目不能为空");
  startAnsweringRound(room, { question, round: room.round + 1, now });
  return room;
}

function startAnsweringRound(room, { question, round, now = Date.now() }) {
  room.phase = PHASES.ANSWERING;
  room.round = round;
  room.currentQuestion = question;
  room.phaseEndsAt = now + ANSWER_SECONDS * 1000;
  room.rounds.push({
    round,
    question,
    answers: [],
    revealAnswers: [],
    startedAt: now,
    revealedAt: null
  });
  touch(room, now);
}

function submitAnswer(room, { playerId, text, now = Date.now(), auto = false }) {
  assertPhase(room, PHASES.ANSWERING);
  const player = findPlayer(room, playerId);
  const currentRound = getCurrentRound(room);
  if (currentRound.answers.some((answer) => answer.playerId === player.id)) {
    throw new Error("本轮已经提交过答案");
  }

  const answer = {
    answerId: makeId("ans"),
    playerId: player.id,
    round: room.round,
    text: sanitizeAnswer(text),
    auto,
    submittedAt: now
  };
  currentRound.answers.push(answer);
  touch(room, now);
  return answer;
}

function resolveRoundIfReady(room, { force = false, now = Date.now() } = {}) {
  if (room.phase !== PHASES.ANSWERING) return false;
  const currentRound = getCurrentRound(room);
  const answeredIds = new Set(currentRound.answers.map((answer) => answer.playerId));
  const missing = room.players.filter((player) => !answeredIds.has(player.id));

  if (!force && missing.length > 0) return false;

  for (const player of missing) {
    currentRound.answers.push({
      answerId: makeId("ans"),
      playerId: player.id,
      round: room.round,
      text: "",
      auto: true,
      submittedAt: now
    });
  }

  currentRound.revealAnswers = shuffleStable(currentRound.answers, `round:${room.code}:${room.round}`).map((answer) => {
    const player = findPlayer(room, answer.playerId);
    return {
      answerId: answer.answerId,
      playerId: player.id,
      playerNickname: player.nickname,
      label: player.nickname,
      round: answer.round,
      text: answer.text
    };
  });
  currentRound.revealedAt = now;
  room.phase = PHASES.REVEAL;
  room.phaseEndsAt = null;
  touch(room, now);
  return true;
}

function startVoting(room, { now = Date.now() } = {}) {
  if (room.round < TOTAL_ROUNDS) {
    throw new Error("三轮结束后才能投票");
  }
  room.phase = PHASES.VOTING;
  room.phaseEndsAt = now + VOTE_SECONDS * 1000;
  room.voteCandidates = buildVoteCandidates(room);
  room.votes = [];
  touch(room, now);
}

function castVote(room, { voterId, candidateId, now = Date.now() }) {
  assertPhase(room, PHASES.VOTING);
  const voter = findPlayer(room, voterId);
  if (voter.kind !== "human") throw new Error("AI 不参与投票");
  if (room.votes.some((vote) => vote.voterId === voter.id)) {
    throw new Error("每人只能投一票");
  }

  const candidate = room.voteCandidates.find((item) => item.candidateId === candidateId);
  if (!candidate) throw new Error("投票目标不存在");
  if (candidate.playerId === voter.id) throw new Error("不能投自己");

  const vote = {
    voterId: voter.id,
    candidateId,
    targetPlayerId: candidate.playerId,
    votedAt: now
  };
  room.votes.push(vote);
  touch(room, now);
  return vote;
}

function resolveVoteIfReady(room, { force = false, now = Date.now() } = {}) {
  if (room.phase !== PHASES.VOTING) return false;
  const humanIds = room.players.filter((player) => player.kind === "human").map((player) => player.id);
  if (!force && room.votes.length < humanIds.length) return false;

  const result = calculateResult(room);
  room.result = result;
  room.phase = PHASES.ENDED;
  room.phaseEndsAt = null;
  touch(room, now);
  return true;
}

function maybeAdvanceTimeouts(room, { now = Date.now() } = {}) {
  if (room.phase === PHASES.ANSWERING && room.phaseEndsAt && now >= room.phaseEndsAt) {
    return resolveRoundIfReady(room, { force: true, now });
  }
  if (room.phase === PHASES.VOTING && room.phaseEndsAt && now >= room.phaseEndsAt) {
    return resolveVoteIfReady(room, { force: true, now });
  }
  return false;
}

function markDisconnected(room, socketId, now = Date.now()) {
  const player = room.players.find((item) => item.socketId === socketId);
  if (!player) return null;
  player.connected = false;
  touch(room, now);
  return player;
}

function reconnectPlayer(room, { playerId, socketId, now = Date.now() }) {
  const player = findPlayer(room, playerId);
  player.socketId = socketId;
  player.connected = true;
  touch(room, now);
  return player;
}

function getHostState(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    currentQuestion: room.currentQuestion,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map(toPublicPlayer),
    humanCount: room.players.filter((player) => player.kind === "human").length,
    totalHumans: TOTAL_HUMANS,
    submittedCount: getSubmittedCount(room),
    requiredSubmitCount: room.phase === PHASES.ANSWERING ? TOTAL_PLAYERS : 0,
    rounds: getRoundPublicHistory(room),
    voteCandidates: room.phase === PHASES.VOTING || room.phase === PHASES.ENDED ? room.voteCandidates : [],
    votes: room.votes.map((vote) => ({ ...vote })),
    result: maskResult(room.result, { reveal: room.phase === PHASES.ENDED }),
    identities: room.phase === PHASES.ENDED ? getIdentities(room) : undefined
  };
}

function getPlayerState(room, playerId) {
  const me = findPlayer(room, playerId);
  const state = getPublicState(room);
  state.me = {
    id: me.id,
    nickname: me.nickname,
    kind: me.kind,
    role: me.role,
    connected: me.connected,
    submittedThisRound: hasSubmittedCurrentRound(room, me.id),
    voted: room.votes.some((vote) => vote.voterId === me.id)
  };
  state.players = maskPlayersForPlayer(state.players, me.id);
  state.voteCandidates = maskOwnCandidate(room.voteCandidates, me.id);
  state.identities = room.phase === PHASES.ENDED ? getIdentities(room) : undefined;
  return state;
}

function getPublicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    currentQuestion: room.currentQuestion,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map(toPublicPlayer),
    humanCount: room.players.filter((player) => player.kind === "human").length,
    totalHumans: TOTAL_HUMANS,
    submittedCount: getSubmittedCount(room),
    requiredSubmitCount: room.phase === PHASES.ANSWERING ? TOTAL_PLAYERS : 0,
    rounds: getRoundPublicHistory(room),
    voteCandidates: room.phase === PHASES.VOTING || room.phase === PHASES.ENDED ? room.voteCandidates : [],
    votedCount: room.votes.length,
    requiredVoteCount: TOTAL_HUMANS,
    result: maskResult(room.result, { reveal: room.phase === PHASES.ENDED }),
    identities: room.phase === PHASES.ENDED ? getIdentities(room) : undefined
  };
}

function toPublicPlayer(player) {
  return {
    id: player.id,
    nickname: player.nickname,
    kind: "player",
    connected: player.connected
  };
}

function buildVoteCandidates(room) {
  const candidates = room.players.map((player) => {
    const answers = room.rounds.map((round) => {
      const answer = round.answers.find((item) => item.playerId === player.id);
      return {
        round: round.round,
        question: round.question,
        answerId: answer?.answerId,
        text: answer?.text || ""
      };
    });
    return {
      candidateId: makeId("cand"),
      label: player.nickname,
      playerId: player.id,
      playerNickname: player.nickname,
      answers
    };
  });

  return shuffleStable(candidates, `vote:${room.code}`);
}

function calculateResult(room) {
  const counts = new Map();
  for (const vote of room.votes) {
    counts.set(vote.candidateId, (counts.get(vote.candidateId) || 0) + 1);
  }

  const ranked = [...room.voteCandidates].sort((a, b) => {
    const voteDiff = (counts.get(b.candidateId) || 0) - (counts.get(a.candidateId) || 0);
    if (voteDiff !== 0) return voteDiff;
    const roleDiff = tiePriority(getPlayerRole(room, b.playerId)) - tiePriority(getPlayerRole(room, a.playerId));
    if (roleDiff !== 0) return roleDiff;
    return a.candidateId.localeCompare(b.candidateId);
  });

  if (ranked.length === 0) {
    const fallback = room.players.find((player) => player.kind === "ai") || room.players[0];
    const selectedRole = fallback?.role || ROLES.REAL_AI;
    return {
      winner: WINNERS.REAL_AI,
      selectedCandidateId: null,
      selectedPlayerId: fallback?.id || null,
      selectedRole,
      voteCounts: [],
      identities: getIdentities(room),
      summary: buildResultSummary(WINNERS.REAL_AI, selectedRole)
    };
  }

  const selected = ranked[0];
  const selectedRole = getPlayerRole(room, selected.playerId);
  let winner = WINNERS.REAL_AI;
  if (selectedRole === ROLES.REAL_AI) winner = WINNERS.HUMANS;
  if (selectedRole === ROLES.HUMAN_AI) winner = WINNERS.HUMAN_AI;

  return {
    winner,
    selectedCandidateId: selected.candidateId,
    selectedPlayerId: selected.playerId,
    selectedRole,
    voteCounts: room.voteCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      count: counts.get(candidate.candidateId) || 0
    })),
    identities: getIdentities(room),
    summary: buildResultSummary(winner, selectedRole)
  };
}

function assignRoles(room) {
  const humans = shuffleStable(room.players.filter((player) => player.kind === "human"), `roles:${room.code}`);
  const humanAi = humans[0];
  for (const player of room.players) {
    if (player.kind === "ai") {
      player.role = ROLES.REAL_AI;
    } else if (player.id === humanAi.id) {
      player.role = ROLES.HUMAN_AI;
    } else {
      player.role = ROLES.HUMAN;
    }
  }
}

function getRoundPublicHistory(room) {
  return room.rounds.map((round) => ({
    round: round.round,
    question: round.question,
    revealAnswers: round.revealAnswers
  }));
}

function getSubmittedCount(room) {
  if (room.phase !== PHASES.ANSWERING) return 0;
  return getCurrentRound(room).answers.length;
}

function hasSubmittedCurrentRound(room, playerId) {
  if (room.phase !== PHASES.ANSWERING) return false;
  return getCurrentRound(room).answers.some((answer) => answer.playerId === playerId);
}

function getCurrentRound(room) {
  const round = room.rounds.find((item) => item.round === room.round);
  if (!round) throw new Error("当前轮次不存在");
  return round;
}

function getIdentities(room) {
  return room.players.map((player) => ({
    playerId: player.id,
    nickname: player.nickname,
    kind: player.kind,
    role: player.role
  }));
}

function maskIdentitiesForPlayer(room, playerId) {
  return room.players.map((player) => ({
    playerId: player.id === playerId ? player.id : undefined,
    nickname: player.nickname,
    kind: player.kind,
    role: player.id === playerId ? player.role : undefined,
    isSelf: player.id === playerId
  }));
}

function maskResult(result, { reveal = false } = {}) {
  if (!result) return null;
  const publicResult = {
    winner: result.winner,
    summary: result.summary || publicWinnerName(result.winner)
  };
  if (reveal) {
    publicResult.selectedCandidateId = result.selectedCandidateId;
    publicResult.selectedPlayerId = result.selectedPlayerId;
    publicResult.selectedRole = result.selectedRole;
    publicResult.voteCounts = result.voteCounts;
    publicResult.identities = result.identities;
  }
  return publicResult;
}

function publicWinnerName(winner) {
  if (winner === WINNERS.HUMANS) return "普通人类阵营胜利";
  if (winner === WINNERS.HUMAN_AI) return "扮 AI 玩家胜利";
  if (winner === WINNERS.REAL_AI) return "真实 AI 胜利";
  return "游戏结束";
}

function maskOwnCandidate(candidates, playerId) {
  return candidates.map((candidate) => ({
    ...candidate,
    isSelf: candidate.playerId === playerId,
    playerId: undefined
  }));
}

function maskPlayersForPlayer(players, playerId) {
  return players.map((player) => ({
    ...player,
    isSelf: player.id === playerId,
    id: player.id === playerId ? player.id : undefined
  }));
}

function getPlayerRole(room, playerId) {
  return findPlayer(room, playerId).role;
}

function findPlayer(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new Error("玩家不存在");
  return player;
}

function assertPhase(room, phase) {
  if (room.phase !== phase) {
    throw new Error(`当前阶段不是 ${phase}`);
  }
}

function tiePriority(role) {
  if (role === ROLES.REAL_AI) return 3;
  if (role === ROLES.HUMAN_AI) return 2;
  return 1;
}

function buildResultSummary(winner, selectedRole) {
  if (winner === WINNERS.HUMANS) return "投票命中了真实 AI，普通人类阵营胜利。";
  if (winner === WINNERS.HUMAN_AI) return "投票命中了扮 AI 的人类，扮 AI 玩家胜利。";
  return `大家投中的是${selectedRole === ROLES.HUMAN ? "普通人类" : "错误目标"}，真实 AI 胜利。`;
}

function sanitizeNickname(nickname) {
  const value = String(nickname || "").trim().slice(0, 12);
  return value || `玩家${Math.floor(Math.random() * 90) + 10}`;
}

function sanitizeAnswer(text) {
  return String(text || "").trim().slice(0, 240);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function touch(room, now) {
  room.updatedAt = now;
}

function shuffleStable(items, seed) {
  return [...items]
    .map((item, index) => ({
      item,
      key: crypto.createHash("sha256").update(`${seed}:${index}:${item.id || item.playerId || item.answerId || item.candidateId}`).digest("hex")
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ item }) => item);
}

module.exports = {
  constants: {
    TOTAL_HUMANS,
    TOTAL_PLAYERS,
    TOTAL_ROUNDS,
    ANSWER_SECONDS,
    VOTE_SECONDS,
    PHASES,
    ROLES,
    WINNERS
  },
  createRoom,
  joinHuman,
  ensureAiPlayer,
  startGame,
  startNextRoundOrVoting,
  submitAnswer,
  resolveRoundIfReady,
  startVoting,
  castVote,
  resolveVoteIfReady,
  maybeAdvanceTimeouts,
  markDisconnected,
  reconnectPlayer,
  getHostState,
  getPlayerState,
  getPublicState
};
