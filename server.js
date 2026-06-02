require("dotenv").config();

const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const game = require("./game");
const { getAiAnswer, getRandomAiNickname } = require("./claude");
const { getRandomQuestions } = require("./questions");

const PORT = Number(process.env.PORT || 3000);
const AI_JOIN_HUMAN_THRESHOLD = 4;
const REVEAL_SECONDS = Number(process.env.REVEAL_SECONDS || 8);
const rooms = new Map();
const answerTimers = new Map();
const revealTimers = new Map();
const voteTimers = new Map();
const hostSockets = new Map();
const playerSockets = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("/network-info", (req, res) => {
  res.json({
    origin: publicOrigin(req),
    lanUrls: getLanUrls(req)
  });
});

app.get("/qr/:roomCode.svg", async (req, res) => {
  try {
    const roomCode = String(req.params.roomCode || "").trim().toUpperCase();
    const url = `${publicOrigin(req)}/?room=${encodeURIComponent(roomCode)}`;
    const svg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 240,
      color: {
        dark: "#07100c",
        light: "#f5fff9"
      }
    });
    res.type("image/svg+xml").send(svg);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

io.on("connection", (socket) => {
  socket.on("host:create", (_payload, callback) => {
    tryAck(callback, () => {
      const room = game.createRoom({ hostSocketId: socket.id });
      rooms.set(room.code, room);
      hostSockets.set(socket.id, room.code);
      socket.join(hostRoom(room.code));
      emitRoom(room);
      return { roomCode: room.code, state: game.getHostState(room) };
    });
  });

  socket.on("host:resume", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code } = payload;
      const room = getRoom(roomCode || code);
      room.hostSocketId = socket.id;
      hostSockets.set(socket.id, room.code);
      socket.join(hostRoom(room.code));
      emitRoom(room);
      return { roomCode: room.code, state: game.getHostState(room) };
    });
  });

  socket.on("player:join", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code, nickname, playerId } = payload;
      const room = getRoom(roomCode || code);
      const player = game.joinHuman(room, { socketId: socket.id, nickname, playerId });
      playerSockets.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(playerRoom(player.id));

      maybeAddAiPlayer(room);
      maybeAutoStart(room);

      emitRoom(room);
      return { playerId: player.id, state: game.getPlayerState(room, player.id) };
    });
  });

  socket.on("player:resume", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code, playerId } = payload;
      const room = getRoom(roomCode || code);
      const player = game.reconnectPlayer(room, { playerId, socketId: socket.id });
      playerSockets.set(socket.id, { roomCode: room.code, playerId: player.id });
      socket.join(playerRoom(player.id));
      emitRoom(room);
      return { roomCode: room.code, playerId: player.id, state: game.getPlayerState(room, player.id) };
    });
  });

  socket.on("host:start", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code } = payload;
      const room = getRoom(roomCode || code);
      startRoomGame(room);
      emitRoom(room);
      return { state: game.getHostState(room) };
    });
  });

  socket.on("host:continue", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code } = payload;
      const room = getRoom(roomCode || code);
      advanceAfterReveal(room);
      emitRoom(room);
      return { state: game.getHostState(room) };
    });
  });

  socket.on("player:submitAnswer", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code, playerId, answer, text } = payload;
      const room = getRoom(roomCode || code);
      game.submitAnswer(room, { playerId, text: answer ?? text });
      if (game.resolveRoundIfReady(room)) {
        clearAnswerTimeout(room.code);
        scheduleRevealAdvance(room);
      }
      emitRoom(room);
      return { state: game.getPlayerState(room, playerId) };
    });
  });

  socket.on("player:castVote", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code, playerId, candidateId } = payload;
      const room = getRoom(roomCode || code);
      game.castVote(room, { voterId: playerId, candidateId });
      if (game.resolveVoteIfReady(room)) clearVoteTimeout(room.code);
      emitRoom(room);
      return { state: game.getPlayerState(room, playerId) };
    });
  });

  socket.on("host:forceTimeout", (payload = {}, callback) => {
    tryAck(callback, () => {
      const { roomCode, code } = payload;
      const room = getRoom(roomCode || code);
      clearAnswerTimeout(room.code);
      if (game.resolveRoundIfReady(room, { force: true })) scheduleRevealAdvance(room);
      emitRoom(room);
      return { state: game.getHostState(room) };
    });
  });

  socket.on("disconnect", () => {
    const playerInfo = playerSockets.get(socket.id);
    if (playerInfo) {
      const room = rooms.get(playerInfo.roomCode);
      if (room) {
        game.markDisconnected(room, socket.id);
        emitRoom(room);
      }
      playerSockets.delete(socket.id);
    }
    hostSockets.delete(socket.id);
  });
});

function getRoom(code) {
  const roomCode = String(code || "").trim().toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) throw new Error("房间不存在");
  return room;
}

function emitRoom(room) {
  io.to(hostRoom(room.code)).emit("room:update", game.getHostState(room));
  for (const player of room.players.filter((item) => item.kind === "human")) {
    io.to(playerRoom(player.id)).emit("room:update", game.getPlayerState(room, player.id));
  }
}

function hostRoom(code) {
  return `host:${code}`;
}

function playerRoom(playerId) {
  return `player:${playerId}`;
}

function scheduleAnswerTimeout(room) {
  clearAnswerTimeout(room.code);
  const delay = Math.max(0, room.phaseEndsAt - Date.now());
  answerTimers.set(room.code, setTimeout(() => {
    answerTimers.delete(room.code);
    if (game.maybeAdvanceTimeouts(room)) {
      scheduleRevealAdvance(room);
      emitRoom(room);
    }
  }, delay));
}

function clearAnswerTimeout(roomCode) {
  const timer = answerTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  answerTimers.delete(roomCode);
}

function scheduleRevealAdvance(room) {
  clearRevealTimer(room.code);
  if (room.phase !== game.constants.PHASES.REVEAL) return;
  revealTimers.set(room.code, setTimeout(() => {
    revealTimers.delete(room.code);
    advanceAfterReveal(room);
    emitRoom(room);
  }, REVEAL_SECONDS * 1000));
}

function clearRevealTimer(roomCode) {
  const timer = revealTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  revealTimers.delete(roomCode);
}

function scheduleVoteTimeout(room) {
  clearVoteTimeout(room.code);
  if (room.phase !== game.constants.PHASES.VOTING || !room.phaseEndsAt) return;
  const delay = Math.max(0, room.phaseEndsAt - Date.now());
  voteTimers.set(room.code, setTimeout(() => {
    voteTimers.delete(room.code);
    if (game.maybeAdvanceTimeouts(room)) emitRoom(room);
  }, delay));
}

function clearVoteTimeout(roomCode) {
  const timer = voteTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  voteTimers.delete(roomCode);
}

function maybeAddAiPlayer(room) {
  if (room.phase !== game.constants.PHASES.LOBBY) return false;
  const humanCount = room.players.filter((player) => player.kind === "human").length;
  if (humanCount < AI_JOIN_HUMAN_THRESHOLD) return false;
  const before = room.players.length;
  game.ensureAiPlayer(room, { nickname: getRandomAiNickname(room.players.map((item) => item.nickname)) });
  return room.players.length > before;
}

function maybeAutoStart(room) {
  if (room.phase !== game.constants.PHASES.LOBBY) return false;
  const humanCount = room.players.filter((player) => player.kind === "human").length;
  if (humanCount !== game.constants.TOTAL_HUMANS) return false;
  startRoomGame(room);
  return true;
}

function startRoomGame(room) {
  if (room.phase !== game.constants.PHASES.LOBBY) return;
  maybeAddAiPlayer(room);
  const questions = getRandomQuestions(game.constants.TOTAL_ROUNDS);
  game.startGame(room, {
    questions,
    aiNickname: getRandomAiNickname(room.players.map((item) => item.nickname))
  });
  scheduleAnswerTimeout(room);
  queueAiAnswer(room);
}

function advanceAfterReveal(room) {
  if (room.phase !== game.constants.PHASES.REVEAL) return;
  clearRevealTimer(room.code);
  const nextQuestion = getRandomQuestions(1)[0];
  game.startNextRoundOrVoting(room, { question: nextQuestion });
  if (room.phase === game.constants.PHASES.ANSWERING) {
    scheduleAnswerTimeout(room);
    queueAiAnswer(room);
  }
  if (room.phase === game.constants.PHASES.VOTING) {
    scheduleVoteTimeout(room);
  }
}

async function queueAiAnswer(room) {
  const round = room.round;
  const ai = room.players.find((player) => player.kind === "ai");
  if (!ai) return;

  try {
    const previousAnswers = room.rounds
      .flatMap((item) => item.answers)
      .filter((answer) => answer.playerId === ai.id)
      .map((answer) => answer.text);
    const answer = await getAiAnswer(room.currentQuestion, previousAnswers);
    if (room.phase !== game.constants.PHASES.ANSWERING || room.round !== round) return;
    game.submitAnswer(room, { playerId: ai.id, text: answer, auto: true });
    if (game.resolveRoundIfReady(room)) {
      clearAnswerTimeout(room.code);
      scheduleRevealAdvance(room);
    }
    emitRoom(room);
  } catch (error) {
    console.error("AI answer failed:", error.message);
    if (room.phase !== game.constants.PHASES.ANSWERING || room.round !== round) return;
    game.submitAnswer(room, { playerId: ai.id, text: "看情况吧", auto: true });
    if (game.resolveRoundIfReady(room)) {
      clearAnswerTimeout(room.code);
      scheduleRevealAdvance(room);
    }
    emitRoom(room);
  }
}

function tryAck(callback, fn) {
  try {
    const data = fn();
    callback?.({ ok: true, ...data });
  } catch (error) {
    callback?.({ ok: false, error: error.message });
  }
}

function publicOrigin(req) {
  const host = req.get("host") || `localhost:${PORT}`;
  if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return `${req.protocol}://${host}`;
  }
  return getLanUrls(req)[0] || `${req.protocol}://${host}`;
}

function getLanUrls(req) {
  const host = req.get("host") || `localhost:${PORT}`;
  const port = host.includes(":") ? host.split(":").pop() : PORT;
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`${req.protocol}://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

server.listen(PORT, () => {
  console.log(`AI Undercover backend listening on http://localhost:${PORT}`);
});
