const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { io: createClient } = require("socket.io-client");
const game = require("../game");

const PORT = 3199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

test("pure game logic supports the three winner paths", () => {
  assert.equal(resolveWithTargetRole(game.constants.ROLES.REAL_AI), game.constants.WINNERS.HUMANS);
  assert.equal(resolveWithTargetRole(game.constants.ROLES.HUMAN_AI), game.constants.WINNERS.HUMAN_AI);
  assert.equal(resolveWithTargetRole(game.constants.ROLES.HUMAN), game.constants.WINNERS.REAL_AI);
});

test("socket flow creates a six-player AI-undercover game and reaches voting", async () => {
  const app = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: "", NEWAPI_API_KEY: "", AI_API_KEY: "", REVEAL_SECONDS: "0.05" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stderr = [];
  app.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const clients = [];
  try {
    await waitForHealth();

    const host = await connectClient();
    clients.push(host);
    const created = await emit(host, "host:create", {});
    assert.equal(created.ok, true);
    assert.match(created.roomCode, /^[A-Z2-9]{6}$/);
    const roomCode = created.roomCode;
    const resumedHost = await emit(host, "host:resume", { roomCode });
    assert.equal(resumedHost.ok, true);
    assert.equal(resumedHost.roomCode, roomCode);
    assert.equal(resumedHost.state.code, roomCode);

    const players = [];
    for (const nickname of ["A1", "B2", "C3"]) {
      const client = await connectClient();
      clients.push(client);
      const joined = await emit(client, "player:join", { roomCode, nickname });
      assert.equal(joined.ok, true);
      assert.ok(joined.playerId);
      players.push({ client, id: joined.playerId });
      assert.equal(joined.state.players.length, players.length);
    }

    const fourth = await connectClient();
    clients.push(fourth);
    const fourthJoined = await emit(fourth, "player:join", { roomCode, nickname: "D4" });
    assert.equal(fourthJoined.ok, true);
    assert.ok(fourthJoined.playerId);
    players.push({ client: fourth, id: fourthJoined.playerId });
    assert.equal(fourthJoined.state.humanCount, 4);
    assert.equal(fourthJoined.state.players.length, 5);
    assert.equal(fourthJoined.state.players.every((player) => player.kind === "player"), true);

    const resumedPlayer = await emit(players[0].client, "player:resume", { roomCode, playerId: players[0].id });
    assert.equal(resumedPlayer.ok, true);
    assert.equal(resumedPlayer.roomCode, roomCode);
    assert.equal(resumedPlayer.playerId, players[0].id);
    assert.equal(resumedPlayer.state.me.id, players[0].id);

    const startUpdate = waitForUpdate(host, (room) => room.phase === "answering" && room.players.length === 6);
    const fifth = await connectClient();
    clients.push(fifth);
    const fifthJoined = await emit(fifth, "player:join", { roomCode, nickname: "E5" });
    assert.equal(fifthJoined.ok, true);
    assert.ok(fifthJoined.playerId);
    players.push({ client: fifth, id: fifthJoined.playerId });
    let hostState = await startUpdate;
    assert.equal(hostState.round, 1);
    assert.equal(hostState.players.length, 6);
    assert.equal(hostState.players.every((player) => player.role === undefined), true);
    assert.equal(hostState.players.every((player) => player.kind === "player"), true);

    for (let round = 1; round <= 3; round += 1) {
      let revealUpdate = null;
      for (let index = 0; index < players.length; index += 1) {
        const player = players[index];
        if (index === players.length - 1) {
          revealUpdate = waitForUpdate(host, (room) => room.phase === "reveal" && room.round === round);
        }
        const ack = await emit(player.client, "player:submitAnswer", {
          roomCode,
          playerId: player.id,
          answer: `answer ${round} from ${player.id}`
        });
        assert.equal(ack.ok, true);
      }

      hostState = await revealUpdate;
      assert.equal(hostState.rounds.at(-1).revealAnswers.length, 6);
      assert.equal(hostState.rounds.at(-1).revealAnswers.every((answer) => answer.playerNickname && answer.label === answer.playerNickname), true);

      hostState = await waitForUpdate(host, (room) => {
        if (round < 3) return room.phase === "answering" && room.round === round + 1;
        return room.phase === "voting";
      });
    }

    assert.equal(hostState.phase, "voting");
    assert.equal(hostState.voteCandidates.length, 6);
    assert.equal(hostState.voteCandidates.every((candidate) => candidate.playerNickname && candidate.label === candidate.playerNickname), true);
    const playerVotingState = await emit(players[0].client, "player:resume", { roomCode, playerId: players[0].id });
    assert.equal(playerVotingState.ok, true);
    assert.equal(playerVotingState.state.voteCandidates.length, 6);
    assert.equal(playerVotingState.state.voteCandidates.filter((candidate) => candidate.isSelf).length, 1);
    assert.equal(playerVotingState.state.voteCandidates.every((candidate) => candidate.playerId === undefined), true);
    assert.equal(playerVotingState.state.players.filter((player) => player.isSelf && player.id === players[0].id).length, 1);
    assert.equal(playerVotingState.state.players.filter((player) => !player.isSelf).every((player) => player.id === undefined), true);
    assert.equal(playerVotingState.state.players.every((player) => player.role === undefined), true);

    for (let index = 0; index < players.length; index += 1) {
      const player = players[index];
      const target = hostState.voteCandidates.find((candidate) => candidate.playerId !== player.id);
      const endedUpdate = index === players.length - 1 ? waitForUpdate(host, (room) => room.phase === "ended") : null;
      const voted = await emit(player.client, "player:castVote", {
        roomCode,
        playerId: player.id,
        candidateId: target.candidateId
      });
      assert.equal(voted.ok, true);
      if (endedUpdate) {
        hostState = await endedUpdate;
      }
    }

    const ended = hostState;
    assert.ok(["humans", "human_ai", "real_ai"].includes(ended.result.winner));
    assert.equal(ended.identities.length, 6);
    assert.equal(ended.result.identities.length, 6);
    assert.equal(ended.result.voteCounts.length, 6);
    assert.equal(ended.identities.filter((item) => item.role === "real_ai").length, 1);
    assert.equal(ended.identities.filter((item) => item.role === "human_ai").length, 1);
  } finally {
    clients.forEach((client) => client.disconnect());
    app.kill();
    await delay(100);
    assert.equal(stderr.join(""), "");
  }
});

function resolveWithTargetRole(role) {
  const room = buildResolvedRoom();
  const target = room.players.find((player) => player.role === role);
  for (const voter of room.players.filter((player) => player.kind === "human")) {
    const candidate = room.voteCandidates.find((item) => item.playerId !== voter.id && item.playerId === target.id)
      || room.voteCandidates.find((item) => item.playerId !== voter.id);
    game.castVote(room, { voterId: voter.id, candidateId: candidate.candidateId });
  }
  game.resolveVoteIfReady(room, { force: true });
  return room.result.winner;
}

function buildResolvedRoom() {
  const room = game.createRoom({ code: "ABC234" });
  for (const nickname of ["A1", "B2", "C3", "D4", "E5"]) {
    game.joinHuman(room, { nickname });
  }
  game.startGame(room, { questions: ["q1", "q2", "q3"], aiNickname: "AI6" });
  for (let round = 1; round <= 3; round += 1) {
    for (const player of room.players) {
      game.submitAnswer(room, { playerId: player.id, text: `r${round}-${player.nickname}` });
    }
    game.resolveRoundIfReady(room);
    if (round < 3) game.startNextRoundOrVoting(room, { question: `q${round + 1}` });
  }
  game.startNextRoundOrVoting(room);
  return room;
}

async function connectClient() {
  const client = createClient(BASE_URL, { transports: ["websocket"] });
  await once(client, "connect");
  return client;
}

function emit(client, event, payload) {
  return new Promise((resolve) => {
    client.emit(event, payload, (response) => resolve(response));
  });
}

function waitForUpdate(client, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("room:update", onUpdate);
      reject(new Error("timed out waiting for room update"));
    }, 5000);

    function onUpdate(room) {
      if (!predicate(room)) return;
      clearTimeout(timeout);
      client.off("room:update", onUpdate);
      resolve(room);
    }

    client.on("room:update", onUpdate);
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("server did not start");
}
