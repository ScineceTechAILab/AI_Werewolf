# Frontend API for AI Undercover

Current version: automatic game, no manual host.

## Summary

- Desktop root page is an audience display.
- The display creates/resumes a room through `host:create` / `host:resume`.
- 5 humans join from phones.
- Once the 4th human joins, backend inserts the AI player into the visible roster.
- Once the 5th human joins, backend automatically starts.
- Backend automatically advances from reveal to next round, and from round 3 reveal to voting.
- Backend automatically resolves voting when all humans vote or timer expires.
- Public state hides identities during the game, then reveals all identities at `ended`.

## Client Events

All client events use ack callbacks.

### `host:create`

Create an audience-display room.

```js
socket.emit("host:create", {}, ack => {})
```

### `host:resume`

Reconnect the display.

```js
socket.emit("host:resume", { roomCode }, ack => {})
```

### `player:join`

Join from phone during lobby.

```js
socket.emit("player:join", { roomCode, nickname, playerId }, ack => {})
```

### `player:resume`

Reconnect a phone player.

```js
socket.emit("player:resume", { roomCode, playerId }, ack => {})
```

### `player:submitAnswer`

Submit current round answer.

```js
socket.emit("player:submitAnswer", { roomCode, playerId, answer }, ack => {})
```

### `player:castVote`

Vote for a candidate during `voting`.

```js
socket.emit("player:castVote", { roomCode, playerId, candidateId }, ack => {})
```

`host:start`, `host:continue`, and `host:forceTimeout` still exist for compatibility/debugging, but the production UI should not show those controls.

## Phases

- `lobby`: waiting for humans.
- `answering`: current question is live.
- `reveal`: completed round answers are visible.
- `voting`: humans vote from phones.
- `ended`: final winner side is visible, identities stay private.

## Public Fields

Display and player states share:

```json
{
  "code": "ABC234",
  "phase": "answering",
  "round": 1,
  "totalRounds": 3,
  "currentQuestion": "你平时周末一般做什么？",
  "phaseEndsAt": 1780000000000,
  "players": [
    { "id": "p_xxx", "nickname": "小王", "kind": "player", "connected": true }
  ],
  "humanCount": 5,
  "totalHumans": 5,
  "submittedCount": 2,
  "requiredSubmitCount": 6,
  "votedCount": 0,
  "requiredVoteCount": 5,
  "rounds": [],
  "voteCandidates": [],
  "result": null
}
```

Important:

- Do not expect `kind: "ai"` in public state.
- Do not expect role fields in public player lists.
- Reveal identities only in result UI.

## Player-Only Fields

Players receive `me.role` for their own identity only:

```json
{
  "me": {
    "id": "p_xxx",
    "nickname": "小王",
    "kind": "human",
    "role": "human_ai",
    "submittedThisRound": false,
    "voted": false
  }
}
```

Roles:

- `human`: find the real AI.
- `human_ai`: make others think you are AI.

Human browsers never receive `real_ai` as their own role.

## Round Reveal

Read latest item from `rounds`.

```json
{
  "round": 1,
  "question": "你平时周末一般做什么？",
  "revealAnswers": [
    {
      "answerId": "ans_xxx",
      "label": "玩家昵称",
      "playerNickname": "玩家昵称",
      "round": 1,
      "text": "看心情吧"
    }
  ]
}
```

## Voting

Render `voteCandidates`.

```json
{
  "candidateId": "cand_xxx",
  "label": "玩家昵称",
  "playerNickname": "玩家昵称",
  "isSelf": false,
  "answers": [
    { "round": 1, "question": "题目", "answerId": "ans_xxx", "text": "看心情吧" }
  ]
}
```

Player state masks `playerId`; use `candidateId` for voting. Disable candidates with `isSelf`.

## Result

At `ended`, result reveals identities and vote counts.

```json
{
  "winner": "humans",
  "summary": "投票命中了真实 AI，普通人类阵营胜利。",
  "voteCounts": [
    { "candidateId": "cand_xxx", "label": "玩家昵称", "count": 2 }
  ],
  "identities": [
    { "playerId": "p_xxx", "nickname": "玩家昵称", "kind": "human", "role": "human_ai" },
    { "playerId": "ai_xxx", "nickname": "阿珍", "kind": "ai", "role": "real_ai" }
  ]
}
```

Winner values:

- `humans`
- `human_ai`
- `real_ai`
