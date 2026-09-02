# Wingu la Dalili — AI-assisted Symptom Cloud

> *"Elezea dalili zako kabla ya kuona muuguzi"*
> Describe your symptoms before seeing the nurse.

**Wingu la Dalili** is an AI-assisted intake translator for Kenyan outpatient clinics. Patients describe their symptoms in Swahili, Sheng, or English through a private, adaptive conversation — and walk away with a structured nurse handoff card that shows both the clinical restatement and their own exact words, side by side.

Built for the **Anthropic Hackathon 2026**.

---

## The Problem

A patient arrives at a public clinic in Nairobi. They have been waiting two hours. When they finally reach the nurse, they have 90 seconds to explain what is wrong. They speak Sheng or Swahili; the intake form is in English. They are anxious, possibly in pain, and do not know clinical terms.

The nurse paraphrases what they hear. By the time the patient sees the doctor, the record says "abdominal pain" — not *"tumbo inauma sana tangu jana usiku"* ("my stomach has been hurting badly since last night"). The patient's own words, which carry meaning the clinical restatement does not, are gone.

**Wingu la Dalili** sits in that gap.

---

## What It Does

1. **Consent gate** — full transparency before any input: what the AI does, what it will never do, that Claude by Anthropic is involved, and how data is handled
2. **Adaptive conversation** — Claude Haiku asks one follow-up question at a time in the patient's own language. It extracts structured symptom data without replacing the patient's words
3. **Patient review** — the patient sees everything collected and can remove any item before it reaches the nurse
4. **Nurse handoff card** — structured summary showing clinical restatement + patient's verbatim words side by side. Downloadable as PDF
5. **Nearby clinic finder** — OpenStreetMap-powered search for health facilities within 5 km, no API key required

---

## Safety Features

- **Danger-sign interceptor** — runs client-side, offline, on every keystroke. 50+ patterns in Swahili, Sheng, and English. Triggers immediately:
  - **RED screen**: chest pain, difficulty breathing, heavy bleeding, loss of consciousness, seizure, stroke signs, severe burns, poisoning, obstetric emergencies
  - **AMBER screen**: self-harm disclosure — redirects to Befrienders Kenya helpline
- **No diagnosis, ever** — enforced in the system prompt with explicit examples. The AI cannot name a disease, recommend medicine, or predict severity
- **Zero storage** — no database, no logs, no localStorage. Session wipes itself after 2 minutes of inactivity. Back button is blocked from recovering a completed session
- **Voice safety** — danger check runs on every interim voice result mid-sentence, before the patient finishes speaking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.5 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| AI model | Claude Haiku 4.5 (`claude-haiku-4-5`) via Anthropic Messages API |
| Voice input | Web Speech API — sw-KE → en-KE → en fallback |
| PDF generation | Hand-rolled A4 PDF serialiser (no npm dependencies) |
| Health providers | OpenStreetMap Overpass API + Haversine distance sort |
| Deployment | Vercel (edge runtime) | Render |

---

## Architecture

```
Patient browser
│
├── lib/interceptor.ts          Offline danger-sign lexicon (50+ patterns, 3 languages)
├── lib/conversationTypes.ts    ClaudeTurn, Message, Accumulated types
├── lib/accumulate.ts           applyTurn() — dedup, safety escalation, unknowns replace not append
├── lib/conversationValidate.ts Dependency-free parseTurn() runtime guard
├── lib/conversationSummary.ts  buildSummary() + summaryToText() for nurse handoff
├── lib/healthProviders.ts      findNearbyProviders() via Overpass API
├── lib/pdf.ts                  downloadBrief() — hand-rolled Latin-1 PDF
├── lib/languageContext.tsx     React context for EN/SW language toggle
│
├── app/api/turn/route.ts       Edge route — stateless proxy to Anthropic API
│                               Forced tool call · Prompt caching · 3-pass validation
│
└── components/
    ├── Navbar.tsx              Navy bar with AI-assisted badge + EN/SW toggle
    ├── ConsentModal.tsx        Blocking consent gate — full AI transparency
    ├── QuestionLoop.tsx        Adaptive conversation display
    ├── AnswerInput.tsx         MCQ tap-to-answer + free text + Sijui button
    ├── SummaryReview.tsx       Per-item removal before confirming
    ├── VoiceInput.tsx          Web Speech API wrapper — 1.5s auto-stop
    ├── HealthProviderFinder.tsx Geolocation + Overpass query
    ├── EmergencyScreen.tsx     RED danger screen
    └── SelfHarmScreen.tsx      AMBER screen + Befrienders Kenya helpline
```

**State machine:** `consent → welcome → asking → reviewing → handoff` (+ `emergency` / `selfharm` branches)

---

## What is Live vs Mocked

| Feature | Status |
|---|---|
| Multi-turn Claude conversation | ✅ Live — real API calls |
| Danger-sign interceptor | ✅ Live — runs offline, client-side |
| Voice input (Chrome/Edge) | ✅ Live — Web Speech API |
| EN/SW language toggle | ✅ Live |
| PDF download | ✅ Live — generated entirely in browser |
| Nearby health providers | ✅ Live — real GPS + OpenStreetMap |
| Inactivity auto-purge | ✅ Live |
| QR code on handoff card | ⚠️ Simulated — seeded pseudo-random dot matrix, labelled "not scannable" |

---

## Running Locally

```bash
# 1. Clone
git clone https://github.com/Kamara-AI/kazi-kabla-ya-daktari.git
cd kazi-kabla-ya-daktari

# 2. Install dependencies
npm install

# 3. Add your API key
cp .env.local.example .env.local
# Edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...

# 4. Start dev server
npm run dev
# → http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key — never reaches the browser |

---

## Claude's Role

Model: `claude-haiku-4-5`

Claude drives the multi-turn intake conversation via a forced tool call (`emit_turn`). Each turn it returns a structured JSON object containing:

- `message` — the question to show the patient
- `reported_information` — new symptom facts this turn (category-tagged)
- `patient_beliefs` — what the patient thinks is happening (never confirmed or denied)
- `unknown_information` — complete list of what is still open
- `safety_flag` — `none` / `urgent` / `emergency`
- `next_action` — `ask_question` / `sijui` / `safety_response` / `generate_summary`
- `answer_options` — MCQ choices when appropriate (max 5)

**What Claude must never do** (enforced in system prompt):
- Name a disease, condition, or diagnosis
- Recommend medicine, tests, doses, or home remedies
- Introduce severity, laterality, or duration the patient did not state
- Record anything the patient did not say
- Ask for identifying information

The system prompt is cached server-side (`cache_control: ephemeral`) — latency on turns 2–6 is reduced by ~60%.

---

## Team

Built at the Anthropic Hackathon 2026 by:

- [@Kamara-AI](https://github.com/Kamara-AI)
- [@abdinoor12345](https://github.com/abdinoor12345)
- [@Mucunguzi256](https://github.com/Mucunguzi256)
- [@Worsley-Labwes](https://github.com/Worsley-Labwes)
- [@ClaudiusMango](https://github.com/ClaudiusMango)

---

## Disclaimer

This is a hackathon prototype. It has not been clinically validated and is not intended for use with real patients in a production setting. The danger-sign interceptor is tuned wide for demonstration purposes and must be reviewed by a qualified clinician before any real-world deployment.
