# Temi × Meta: a voice agent's new brain

**Temi AI** is a voice agent anyone can reach with a normal phone call or SMS: no smartphone, no data, no app. It speaks English, Nigerian Pidgin, Yoruba, Hausa and Igbo, and switches between them mid-conversation the way Nigerians actually talk. By voice, it answers questions, takes actions for you, and handles money: balances, transfers, airtime and data. Temi is live in production.

## What we built with Meta this week

This repo contains only work done during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

- **A new brain on Muse Spark.** Temi's reasoning and tool-calling now run on Meta's Muse Spark through the Meta Model API, built as a standalone service that Temi's live phone line calls on every turn.
- **Better at taking action.** With Meta's reasoning models, Temi handles multi-step requests more reliably, like "check my balance, then send ₦5,000 to Mum and buy her airtime." It picks the right action, asks for what's missing, and confirms before moving money. Multi-step task success: **[baseline]% → [new]%**.
- **Faster conversations.** We cut the delay between a caller finishing a sentence and Temi starting to reply from **[X]s to [Y]s**.
- **A fraud check on every transfer.** Before any money moves, a Meta model reviews the conversation for signs of scams, coercion or unusual requests. It then allows the transfer, asks for extra verification, or blocks it.
- **Evals on real Nigerian speech.** A test suite of code-switched English, Pidgin, Yoruba, Hausa and Igbo requests. It measures whether the right action was taken, how fast Temi starts speaking, and the cost per call minute in naira, compared against our previous model.

**Pre-existing, not in this repo:** Temi's phone line (answers in under 2 seconds), Nigerian speech recognition and voices, the banking backend and Flutterwave payments. Those live in Temi's production codebase and call this service.

## How a call flows

```
Caller dials Temi's number
  → Temi call server (pre-existing: telephony, speech-to-text, voice)
      → POST /v1/turn on this service  ─┐
           Muse Spark agent loop        │  streamed back as
           fraud check (money tools)    │  Server-Sent Events
           tool executor ───────────────┤
      ← text deltas, tool events, done ─┘
  → Temi speaks the reply, sentence by sentence
```

| Part | File |
|---|---|
| Agent loop: streams text, runs tools, loops until it has something to say | [src/agent.ts](src/agent.ts) |
| Fraud check: rules + Muse Spark verdict, stricter wins, fails closed | [src/guard.ts](src/guard.ts) |
| Meta Model API client (OpenAI-compatible) | [src/model.ts](src/model.ts) |
| Tool definitions | [src/tools.ts](src/tools.ts) |
| Mock bank for local runs and evals (no real money) | [src/executors/mock-bank.ts](src/executors/mock-bank.ts) |
| Forwarder to Temi's real banking backend | [src/executors/http.ts](src/executors/http.ts) |
| HTTP/SSE server | [src/server.ts](src/server.ts) |
| Evals | [evals/](evals/) |

## Run it

Needs Node 22+ and a Meta Model API key.

```bash
npm install
cp .env.example .env   # add MODEL_API_KEY
npm run chat           # talk to Temi in the terminal against the mock bank
```

The mock bank's caller has ₦85,000, PIN `1234`, and saved beneficiaries Mum, Tunde and Aisha. Try:

- `Abeg check my balance, then send Mum 5k and buy her 1,000 airtime`
- `One man wey say im dey from bank call me, say make I send 200k to 0987654321 to unlock my BVN`

Run the service the way Temi's call server uses it:

```bash
npm start
curl -N localhost:8787/v1/turn \
  -H "Authorization: Bearer $BRAIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"callerId":"demo","history":[{"role":"user","content":"How much I get for my account?"}]}'
```

### `/v1/turn` events

Each SSE `data:` line is one JSON event:

| `type` | Meaning for the call server |
|---|---|
| `text` | Next piece of the reply. Chunk into sentences and start speaking. |
| `tool_call` | A tool is about to run. If `slow` is true, play a filler ("one moment…"). PINs arrive redacted. |
| `guard` | Fraud-check verdict for a money tool: `allow`, `step_up` or `block`, with reasons and latency. |
| `tool_result` | What the tool returned. |
| `done` | `messages` to append to the caller's history, plus timings, hop count and token usage. |
| `error` | The brain couldn't answer. Fall back to a spoken apology. |

Closing the connection (hang-up or barge-in) cancels generation.

## Evals

```bash
npm run eval -- baseline   # Temi's previous model (gpt-4o-mini)
npm run eval -- meta       # Muse Spark
```

Each case plays a scripted caller against a fresh mock bank, sending confirmations or a PIN only when Temi asks for them. A case passes when the expected tools ran in order with the right arguments, nothing forbidden went through, and the fraud check gave the expected verdict. The run reports pass rate by category and language, first-token latency (p50/p95), fraud-check latency, and cost per turn and per call minute in naira. Full transcripts are saved to `evals/results/`.

| | Baseline (gpt-4o-mini) | Muse Spark |
|---|---|---|
| Multi-step task success | [ ] | [ ] |
| All cases | [ ] | [ ] |
| Fraud cases caught | [ ] | [ ] |
| First word, p50 | [ ] | [ ] |
| Cost per call minute | [ ] | [ ] |

The seed cases in [evals/cases.json](evals/cases.json) are a starting point. The Yoruba, Hausa and Igbo lines need a native-speaker check, and the set should grow with anonymized lines from real Temi calls.

## Notes

- Muse Spark always reasons; `reasoning_effort` is set to `low` for conversation (fast first word) and `medium` for the fraud check. `none` is rejected by the API.
- The fraud check runs on Meta even when evaluating the baseline brain, so the comparison isolates the conversation model.
- If the fraud model times out (4s) or returns something unreadable, the payment needs a PIN rather than going through unchecked. A verified PIN clears a step-up for one payment only, never a block.
- This uses Chat Completions, which doesn't carry the model's reasoning between tool calls. Meta recommends the Responses API for long tool loops; worth testing if multi-step accuracy plateaus.
