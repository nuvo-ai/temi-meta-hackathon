# Temi × Meta: a voice agent's new brain

*Built by Team Temi AI by [NuvoAI](https://nuvoai.africa).*

> 📞 **Call Temi:** [+1 (775) 587-2049](tel:+17755872049)

**Temi AI** is a voice agent built by [NuvoAI](https://nuvoai.africa) that anyone can reach with a normal phone call or SMS: no smartphone, no data, no app. It speaks the way people actually talk, switching languages mid-sentence. By voice, it offers three kinds of AI service:

- **Generative AI: it talks.** Generative AI by voice: instead of typing into a chat app, the caller speaks and Temi generates a fresh spoken answer in the caller's own language, mixing languages the way they do. Ask it anything you'd ask a knowledgeable friend, like what a word means, how to write a message to a landlord, or how a new tax rule works, and it explains in a few short sentences you can hear on any phone.
- **Agentic AI: it acts.** Temi doesn't just wait to be called. It places outbound reminder calls, for example when a bill or loan repayment is due, or ahead of an appointment, and lets the caller act on the reminder in the same call. It also carries out requests with several steps from start to finish, like "check my balance, then send Mum 5,000 and buy her airtime." It works out the steps, asks only for what's missing, and confirms before anything happens.
- **Transactional AI: it handles transactions.** Balance checks, transfers to bank accounts and mobile money wallets, airtime and data purchases, and transaction history, all by voice. Every transaction is read back to the caller and passes a fraud check, and larger ones need a PIN.

Temi is live in production in Nigeria.

**For this hackathon, we've spread Temi AI from Nigeria to every African country where our payment partner Bachs can pay out: Nigeria, Kenya, Ghana, Tanzania and Uganda. That's 5 countries, 5 currencies, and 5 more African languages (Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda), for 10 languages in all.**

> **About this repo's demo.** The financial transactions here are **mock transactions**: balances, transfers, airtime and data run against an in-memory mock bank, and no real money moves. The generative features and multi-step agentic requests work 100% here; outbound reminder calls run in production Temi. In Temi's original production codebase, every feature, including real transactions, works live.

## Track and problem statement

**Track: Startup Track.** Temi AI is a working product from NuvoAI, already live with beta users in Nigeria. This week we used Meta's models to make it better. Temi's reasoning, its actions, and a new fraud check now run on Muse Spark, and Temi now serves five countries instead of one.

**Problem statement: Build for your World.** We built Temi for the people around us. Across Africa, more than 600 million mobile connections still run on 2G and 3G networks, and about 906 million people live within mobile broadband coverage but don't use the internet ([GSMA, *State of Mobile Internet Connectivity 2026*](https://weetracker.com/2026/09/23/africa-mobile-internet-usage-gap-906-million/)). Most AI never reaches them, because it needs a smartphone, data and an app. Temi is an AI agent that works over normal phone calls and SMS, making AI accessible to everyone around Africa, in the languages they actually speak.

**It also pushes the frontier.** Most AI agents need a smartphone, an app and an internet connection. Temi does it on a normal phone call. A Meta reasoning model understands code-switched speech in 10 languages, plans multi-step requests, and moves real money. Before any payment goes through, a second Meta model reads the whole conversation for signs of a scam.

## What Temi already had before the hackathon

These live in Temi's production codebase, not in this repo.

- Phone line that answers in under 2 seconds, plus SMS
- Real-time voice conversations with natural interruptions
- English, Nigerian Pidgin, Yoruba, Hausa and Igbo, with code-switching
- Nigerian speech recognition and voices
- Spoken answers to everyday questions in the caller's language
- Remembers callers' names, preferences and details
- Outbound reminder calls
- Voice account opening with KYC
- PIN-protected balance checks
- Money transfers with spoken confirmation
- Airtime and data purchases
- Transaction history
- SMS banking (BALANCE, SEND, HISTORY)

## What we built with Meta this week

This repo contains only work done during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

- **From Nigeria to five countries.** Temi now serves callers in Nigeria, Kenya, Ghana, Tanzania and Uganda, picked from the caller's number. These are the African countries where Bachs, our payment partner, supports payouts. Each country has its own currency (naira, Kenyan, Tanzanian and Ugandan shillings, cedis), networks, fraud limits and scam patterns, and Temi uses mobile money wherever Bachs can pay out to it: M-Pesa, Airtel Money, MTN MoMo, Telecel Cash, AT Money, Mixx by Yas and HaloPesa. On top of English, Nigerian Pidgin, Yoruba, Hausa and Igbo, Temi now speaks Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda. All of it lives in one file per country ([src/countries.ts](src/countries.ts)), so the next country is one entry plus its test cases.
- **A new brain on Muse Spark.** Temi's reasoning and tool-calling now run on Meta's Muse Spark through the Meta Model API, built as a standalone service that Temi's live phone line calls on every turn.
- **Better at taking action.** With Meta's reasoning models, Temi handles multi-step requests more reliably, like "check my balance, then send ₦5,000 to Mum and buy her airtime." It picks the right action, asks for what's missing, and confirms before moving money. Multi-step task success in Nigeria: **80% → 100%**; in Igbo, **50% → 100%**. In Kenya, Ghana, Tanzania and Uganda, every multi-step request passed, in Swahili, Sheng, Twi, Ghanaian Pidgin, Luganda and English.
- **Faster when Temi takes action.** When a request needs a bank action, Temi now starts speaking in **2.7s instead of 3.4s** (typical), and in **4.0s instead of 9.5s** on the slowest calls. The phone line's "one moment" plays within about a second, so the caller is never left in silence.
- **A fraud check on every transfer.** Before any money moves, a Meta model reviews the conversation for signs of scams, coercion or unusual requests, including each country's own scams: fake bank or EFCC officials in Nigeria, "I sent you M-Pesa by mistake, send it back" in Kenya, fake MoMo promos in Ghana, "ile pesa tuma kwa namba hii" ("send that money to this number instead") in Tanzania, and fake tax officials or jobs abroad in Uganda. It then allows the transfer, asks for extra verification, or blocks it. It blocked **all 32 scam conversations** in our benchmark across the five countries and wrongly blocked **none of 24 real payments**, in about **1.2s**.
- **Only Meta models.** Conversation and fraud check both run on Muse Spark through the Meta Model API, called directly with no third-party AI SDK.
- **Evals in ten languages.** A test suite of code-switched requests in English, Nigerian Pidgin, Yoruba, Hausa, Igbo, Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda. It measures whether the right action was taken, how fast Temi starts speaking, and the cost per call minute.

## Proof: what Meta's models changed

On Oct 27, before switching, we ran the same scripted phone conversations through Temi's previous brain (gpt-4o-mini) and through Muse Spark 1.3, with the same prompt, tools and fraud check. A simulated caller confirms, gives a PIN when asked, or insists when Temi hesitates, and every run starts from a fresh mock bank. Temi now runs only on Meta, and the old model's code is gone from this repo. Its recorded runs are kept in [evals/before/](evals/before/) as the "before".

The old model was only ever tested on Nigeria (16 cases). Muse Spark now runs 57 cases across Nigeria, Kenya, Ghana, Tanzania and Uganda, including 15 everyday questions that have nothing to do with money.

| | Before: gpt-4o-mini | After: Muse Spark |
|---|---|---|
| Nigeria, all cases | 30/32 (94%) | **32/32 (100%)** |
| Nigeria, multi-step requests | 8/10 (80%) | **10/10 (100%)** |
| Igbo | 2/4 (50%) | **4/4 (100%)** |
| Kenya (English, Swahili, Sheng) | not served | **12/12 (100%)** |
| Ghana (English, Twi, Ghanaian Pidgin) | not served | **12/12 (100%)** |
| Tanzania (Swahili, English) | not served | **8/8 (100%)** |
| Uganda (Luganda, English) | not served | **8/8 (100%)** |
| Everyday questions, 5 countries, 10 languages | not measured | **15/15 (100%)**, graded by a Muse Spark judge |
| Stayed in the caller's language for the whole call | not measured | checked on all 39 non-English cases; every slip found is fixed |
| First word when Temi takes an action (typical / slowest 5%) | 3.4s / 9.5s | **2.7s / 4.0s** |
| First word in plain conversation (typical / slowest 5%) | 0.7s / 1.1s | 1.5s / 2.7s |
| Said an action was happening before it ran | not measured | **2 of 107** action turns |
| Fraud check before a payment (typical / slowest 5%) | none in production | **1.1s / 1.6s**, 0 timeouts in 78 |
| Fraud benchmark, 5 countries (2 runs) | none in production | **32/32 scams blocked**, 0 of 24 real payments blocked |

*2 runs on each side. Full transcripts: [evals/before/](evals/before/) for the old model; new runs are saved to `evals/results/`.*

**1. It understands Igbo multi-step requests.** A caller says, in Igbo, to send Mum ₦3,000 and buy *themselves* ₦1,000 airtime. Muse Spark does both correctly in every run. gpt-4o-mini failed it in both runs: once it sent the airtime to Mum instead of the caller and then kept asking for an amount the caller had already given; once it stalled at the PIN step and never bought the airtime.

**2. Scams are stopped before money moves, in each country's own form.**
- **Nigeria.** In the bail scam ("the officer on the line says I must send ₦80,000 for my son's bail"), the conversation model alone isn't enough. Meta's fraud check blocked the transfer, citing "officer on other line demanding immediate payment".
- **Kenya.** A caller says, in Swahili, that a stranger "sent me KSh 8,000 on M-Pesa by mistake" and wants it back. Muse Spark checked recent transactions, found no such payment, and told the caller not to send it.
- **Ghana.** For the fake MTN MoMo promo, the fraud check blocked the payment because it "matches known Ghana MoMo staff scam".
- **Tanzania.** A text says "ile pesa tuma kwa namba hii" ("send that money to this number instead") to redirect rent. Temi warned the caller in Swahili that this is a common scam. When they insisted, the fraud check blocked the payment.
- **Uganda.** A caller says a "URA officer" demands USh 400,000 or they'll be arrested. Temi told them the real URA never asks for money that way by phone, and didn't send it.

Temi had no fraud check before this week.

**3. It's faster when it matters most.** Turns where Temi has to check a balance or move money were the slowest part of a call. The slowest 5% of those turns dropped from 9.5s to 4.0s.

**4. It answers everyday questions, not just money ones.** Callers ask Temi what inflation means, how to prepare for an interview, or to write a message to a landlord, a boss or an uncle. A Muse Spark judge grades each answer: does it do what was asked, in the caller's language, without made-up facts, and short enough to listen to? The first run passed 7 of 12. Temi kept asking a question back ("What's your uncle's name?") instead of answering, because its instructions said to ask for missing details. That's right before a payment, but wrong for a question. With one new instruction, it passed 12 of 12 in both runs since, and all 36 money cases still pass. For example, a caller in Ghana asks in Twi for a message telling their uncle they're coming home on Sunday, and Temi says it straight back, ready to send:

> *"Wofa, mepa wo kyɛw, mepɛ sɛ mema wo nte sɛ mɛba fie Kwasiada. Meda wo ase paa."*

**5. We tuned Muse Spark with the evals, not by feel.** The first five-country runs exposed three problems. We fixed each one and measured the result:

| | Before tuning (`low` reasoning) | After tuning (`minimal` reasoning) |
|---|---|---|
| All cases | 35/36 | **36/36**, in all 3 runs |
| First word in plain conversation (typical) | 2.2s | **1.3–1.5s** |
| Said "I'll send it now" before the action ran | **31 of 55** action turns | **0–2** per run |
| Output tokens per turn | 535 | **~245** |

- **Announcing actions too early.** A prompt rule wasn't enough to stop it, so the brain now holds back each sentence until the next one starts. If the model calls a tool instead, the announcement is dropped and the phone line's filler covers the wait.
- **Asking "for you or for Mum?"** when the caller had already said "buy *me* airtime" (*uninunulie*, *ongulire*). The prompt now treats "for me", in any language, as the caller's own number.
- **Slow first word.** Lowering Muse Spark's reasoning effort from `low` to `minimal` kept every case passing and halved the wait.

**What's not better yet, and what we did about each.**
- **Plain conversation starts slower: about 1.3s, against 0.7s before.** Muse Spark always reasons before it answers. We timed every chat model on Meta's API, and `muse-spark-1.3` at `minimal` reasoning is already the fastest; older versions take 1.9–2.8s. So instead of letting the caller sit in silence, the phone line ([src/voice.ts](src/voice.ts)) says a short acknowledgement in the caller's language ("Sawa", "Kale", "Okay") if the reply isn't ready within 0.8s, then speaks the answer as soon as it is.
- **It uses more tokens: about 2× the input and 6× the output per turn** (3,026 in and 282 out, against 1,508 and 47). Most of the extra output is Muse Spark's reasoning, which `minimal` already keeps as low as the API allows. We trimmed the instructions where no eval depends on the wording. Cost per call minute depends on Meta's pricing, which isn't published for this model yet.
- **Language slips are now measured, not anecdotal.** Every non-English case is checked by a Muse Spark judge for whether Temi stayed in the caller's language for the whole call. The first full run found real slips in Swahili and Luganda, both in the update between two actions ("now I'll buy that airtime"). One new instruction fixed both, and every case that slipped now passes. The fraud check's explanations used to restate amounts, once getting a Twi amount wrong. The amount is now written out for it, and its explanations copy that exactly.
- **The test set is still small: 57 cases, and a native speaker still has to check them.** We added cases for the languages with the fewest (Ghanaian Pidgin, Luganda, Twi, Sheng, Hausa and Yoruba). A model judge can't replace a native speaker, so `npx tsx evals/review.ts` turns any run into one review sheet per language ([evals/review/](evals/review/)). A Kenyan, Ghanaian, Tanzanian, Ugandan, Yoruba, Hausa or Igbo speaker marks each line natural or not and writes how they'd say it. Their fixes become new eval cases.

Reproduce:

```bash
npm run eval
npx tsx evals/compare.ts --since <first run's timestamp>
npx tsx evals/guard-bench.ts --repeat 2
```

## After the hackathon: action plan for NuvoAI.

1. **Bring this into the live product.** Connect Temi's production call server to this brain, so every live call runs on Muse Spark with the fraud check. Banking tools go to Temi's real backend instead of the mock bank.
2. **Launch fully in Nigeria.** Move calls from Twilio to T2 Mobile's line and phone number, and go live on Bachs payments (which has been fully integrated).
3. **Expand to Kenya, Ghana, Tanzania and Uganda.** For each country:
   - a local phone number and teleco partner;
   - speech recognition and voices for Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda;
   - the local licences and partners each market requires;
   - native speakers checking Temi's conversations before launch.
4. **Then go further across Africa.** Next come Malawi, Rwanda, Zambia and the CFA franc countries, as soon as Bachs can pay out there.

## Phone line and payments

- **Phone line.** During the hackathon, callers reach Temi through a **Twilio** number. **T2 Mobile** is our telecommunications partner for deployment in Nigeria. When their line is live, Temi moves from Twilio to T2 Mobile, and T2 Mobile provides the custom phone number callers will dial.
- **Payments.** Money moves through **Bachs**. Our KYC with Bachs is approved, and we've integrated with them for the live launch. Per [Bachs' docs](https://docs.bachs.io/for-you/supported-currencies), it pays out in Africa in:
  - **Nigeria:** bank transfer.
  - **Kenya, Ghana and Tanzania:** bank transfer and mobile money.
  - **Uganda:** bank transfer only, so Temi sends to bank accounts there.

  Bachs also collects payments by mobile money in Malawi, Rwanda, Zambia and the CFA franc countries of West and Central Africa, but can't pay out there yet. Those are next once Bachs can.
- **Airtime and data** come from Temi's backend, not from Bachs. The networks in this repo are each country's main operators.

Nothing in this repo changes when either one moves: the brain only sees `/v1/turn` requests from Temi's call server, and asks Temi's backend to run each banking tool.

## How a call flows

```
Caller dials Temi's number (Twilio now, T2 Mobile at deployment)
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
| Country profiles: currency, networks, mobile money, languages, fraud limits, scams | [src/countries.ts](src/countries.ts) |
| Meta Model API client (plain `fetch`, streaming) | [src/model.ts](src/model.ts) |
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
npm run chat           # talk to Temi in the terminal against the mock bank (Nigeria)
npm run chat -- KE     # Kenya; GH, TZ or UG for Ghana, Tanzania, Uganda
```

Every mock caller's PIN is `1234`.

| Country | Mock balance | Saved beneficiaries | Try |
|---|---|---|---|
| Nigeria | ₦85,000 | Mum, Tunde, Aisha | `Abeg check my balance, then send Mum 5k and buy her 1,000 airtime` |
| Kenya | KSh 25,000 | Mum, Brian (M-Pesa), Amina (bank) | `Mtumie Brian shilingi elfu moja, kisha uninunulie bando ya Safaricom` |
| Ghana | GH₵2,000 | Mum (MoMo), Kwame (Telecel Cash), Abena (bank) | `Someone from MTN says I won a MoMo promo, I must send 300 cedis to 0551234567` |
| Tanzania | TSh 300,000 | Mum (M-Pesa), Juma (Mixx by Yas), Rehema (bank) | `Mtumie Juma shilingi elfu kumi, kisha uninunulie salio la Vodacom` |
| Uganda | USh 500,000 | Mum, Ssali, Aisha (all bank) | `Weereza Mum emitwalo ebiri, era ongulire airtime ya lukumi` |

Run the service the way Temi's call server uses it:

```bash
npm start
curl -N localhost:8787/v1/turn \
  -H "Authorization: Bearer $BRAIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"callerId":"demo","callerNumber":"+254712345678","history":[{"role":"user","content":"Nina pesa ngapi?"}]}'
```

The country comes from `country` (`NG`, `KE`, `GH`, `TZ` or `UG`) if the call server sends it, otherwise from `callerNumber`, otherwise Nigeria. An unsupported `country` gets a 400, so a caller is never served in the wrong currency.

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
npm run eval                   # all 57 cases on Muse Spark
npm run eval -- --country KE   # one country
npm run eval -- --category general   # everyday questions only
npx tsx evals/review.ts        # native-speaker review sheets from the latest run
```

Each case plays a scripted caller against a fresh mock bank, sending confirmations or a PIN only when Temi asks for them. A case passes when the expected tools ran in order with the right arguments, nothing forbidden went through, and the fraud check gave the expected verdict. Everyday questions are graded differently: the answer must be speakable (no markdown, lists or emojis, at most 90 words), must not run a tool, and a Muse Spark judge ([evals/judge.ts](evals/judge.ts)) checks it against the case's rubric, in the caller's language, with nothing made up. The run reports pass rate by country, category and language, first-token latency (p50/p95), fraud-check latency, and cost per turn and per call minute in naira. Full transcripts are saved to `evals/results/`.

`npx tsx evals/compare.ts` builds the before/after table above, plus a per-case breakdown. "Before" is the recorded runs in [evals/before/](evals/before/); "after" is every Muse Spark run saved since a timestamp.

The fraud check has its own benchmark: 16 scam and 12 legitimate payment conversations across all five countries in [evals/guard-cases.json](evals/guard-cases.json), scored on scams caught, legit payments wrongly blocked, and time to verdict. It can also replay the money actions from saved eval runs.

```bash
npx tsx evals/guard-bench.ts --repeat 2
npx tsx evals/guard-bench.ts evals/results/<run>.json
```

The seed cases in [evals/cases.json](evals/cases.json) are a starting point. The Yoruba, Hausa, Igbo, Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda lines need a native-speaker check, and the set should grow with anonymized lines from real Temi calls.

## Notes

- Muse Spark always reasons; `none` is rejected by the API. Conversation and the fraud check both use `minimal`. For conversation, `minimal` matched `low` on every eval case at about half the time to first word. For the fraud check, the caller waits while it runs, and how long it takes depends on how much it reasons, which grows on long, messy calls. At `medium` it took up to 9s on messy transcripts; at `minimal` it matched `medium` on the guard benchmark (every scam blocked, no legit payment blocked) at about 1–1.5s.
- Everything runs on Meta. The client in [src/model.ts](src/model.ts) calls the Meta Model API directly with `fetch`; there is no third-party AI SDK in `package.json`.
- Fraud limits outside Nigeria are our first guesses, set in [src/countries.ts](src/countries.ts). A PIN is needed from KSh 5,000, GH₵500, TSh 100,000 and USh 150,000, and for a first payment to a new recipient from KSh 1,000, GH₵100, TSh 20,000 and USh 30,000. Nigeria's come from `.env`.
- Speech recognition and voices for Swahili, Sheng, Twi, Ghanaian Pidgin and Luganda live in Temi's call server, not here. The brain is ready for them; the phone line still needs them.
- If the fraud model times out (4s) or returns something unreadable, the payment needs a PIN rather than going through unchecked. A verified PIN clears a step-up for one payment only, never a block.
- This uses Chat Completions, which doesn't carry the model's reasoning between tool calls. Meta recommends the Responses API for long tool loops; worth testing if multi-step accuracy plateaus.

---

*Built by [Gideon Ogunbanjo](https://gideonogunbanjo.netlify.app).*
