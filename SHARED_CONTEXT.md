# Shared Context for Claude and Codex

Project root: `E:\AIplay\ai-undercover`

## Current Goal

Build and deploy **谁是 AI 卧底** as a fully automatic multiplayer browser game.

Public demo URL after deployment: `http://103.85.227.137:8848`

## Current Gameplay

- Total visible players: 6.
- Real humans: 5.
- Real AI player: 1.
- One of the 5 humans secretly gets role `human_ai` and tries to look like AI.
- The real AI tries to look human.
- Normal humans try to vote for the real AI.

## Important UX Rule

There is no manual host. The desktop page is an **audience display** only.

- Opening the root page automatically creates/resumes a room.
- The display shows room code, QR code, player list, questions, answer reveal, voting progress, and final winner.
- The display must not reveal who is AI.
- Result screen reveals all identities after the game ends.

## Auto Flow

1. Display creates room.
2. Humans scan QR and join.
3. When more than 3 humans are ready, the AI player is automatically inserted into the visible roster so the audience cannot tell who is AI.
4. Game waits until 5 humans have joined.
5. At 5 humans, backend automatically starts round 1.
6. Each round:
   - Question shown.
   - Humans answer from phones.
   - AI answer generated automatically.
   - When all 6 answers are ready or timer expires, answers reveal.
   - After a short reveal pause, backend automatically moves to next round.
7. After 3 rounds, backend automatically enters voting.
8. Human players vote from phones.
9. When all humans vote or vote timer expires, backend automatically resolves the winner.

## AI Answer Style

Provider: NewAPI/OpenAI-compatible, model `DeepSeek-V4-Flash`.

Production `.env`:

```env
PORT=8848
NEWAPI_BASE_URL=https://ai.kuocai.net
NEWAPI_MODEL=DeepSeek-V4-Flash
NEWAPI_API_KEY=<provided by user>
ANTHROPIC_API_KEY=
```

AI prompt and normalizer enforce:

- Chinese group-chat style.
- Extremely short: max 10 Chinese chars.
- No final full stop.
- No explanation, no list, no AI wording.
- Fallback examples: `看心情吧`, `还行吧`, `有点难选`.

## Identity Visibility

- Public/display state must not expose player roles.
- Public/display state must not expose `kind: ai`; everyone appears as `kind: "player"`.
- During lobby/answering/reveal/voting, identities stay hidden.
- At `ended`, display and players should reveal all identities, vote counts, and winner side.

## Recent Fixes

- Mobile textarea is protected from re-render while focused.
- Chinese IME composition is tracked so pinyin input is not interrupted by socket updates.
- Countdown updates mutate text only, not the whole input view.

## Key Files

- `server.js`: automatic room flow and socket events.
- `game.js`: state machine, privacy masking, win logic.
- `claude.js`: AI provider and 10-char answer normalizer.
- `public/app.js`: audience display and mobile player UI.
- `public/styles.css`: responsive styling.
- `test/game-flow.test.js`: automatic socket flow tests.

## Collaboration Notes

- Do not revert another agent's edits.
- Read files before changing them.
- Keep demo reliable over adding features.
- If touching frontend, preserve the phone flow: join, see own role, answer, vote, result.
- If touching backend, keep `npm test` passing.
