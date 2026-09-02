# Kazi: Kabla ya Daktari — Technical Design Document

**Version:** 2.0 · Merged from `kazi-flow-v2.pdf`, `Kazi_Build_Spec_v2.pdf`, and `kazi-kabla-ya-daktari.pptx`
**Status:** Hackathon prototype — not clinically validated, not for use with real patients
**Built on:** Claude (claude-haiku-4-5) · Anthropic Hackathon

---

## 1. Product Summary

**Kazi: Kabla ya Daktari** ("Work: Before the Doctor") is a triage intake translator for Kenyan outpatient clinics. It is not a symptom checker, a diagnostic tool, or a triage ranker.

**What it does:** Sits in the waiting time the patient is already spending. Takes the patient's own words — in Swahili, Sheng, English or any mixture — and returns a structured brief to the outpatient triage nurse in a dual-column format: standardised intake term alongside the patient's verbatim words.

**Primary user:** The outpatient triage nurse, seeing 60–120 patients a shift. The patient is the *subject*, not the customer.

**What it explicitly never does:**
- No diagnosis, differential, or probability
- No triage priority or urgency score
- No treatment, drug, or dosage recommendation
- No patient identifier of any kind
- No record that outlives the session
- No automated contact with any third party

---

## 2. Problem Statement

A patient arrives at the triage desk having searched his symptoms at 2am. He hands the nurse a verdict — "I have a brain tumour, I need an MRI" — instead of a symptom. Before she can gather any clinical fact, she must first dismantle a conclusion. In Swahili, Sheng and English, mid-queue, with the patient frightened and defensive.

Kazi sits in the waiting time and converts the patient's own words into the nurse's format before she meets him. She leads the encounter with a timeline instead of opening with a negotiation.

---

## 3. Architecture

### 3.1 Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Client | Next.js 14 App Router, client components | All intake state in React state. No localStorage, no sessionStorage, no IndexedDB, no cookies beyond framework essentials. |
| Safety interceptor | Pure client-side function, no network | Must work offline. Built first — before any AI code. |
| Model proxy | Single Next.js Route Handler `POST /api/brief` | Stateless. Holds the API key server-side. Logging disabled. No DB client imported into the project. |
| Model | `claude-haiku-4-5` | Fastest current model; latency < 4s p50 on venue wifi. Escalate to `claude-sonnet-4-6` only if Sheng translation quality proves insufficient. |
| Output contract | Forced tool call with JSON schema | Schema is the real guardrail — a field that cannot hold a diagnosis cannot carry one. |
| Voice | Web Speech API | Progressive enhancement, first thing cut if behind schedule. |
| Handoff | Full-screen render; `qrcode.react` optional | QR encodes brief text directly — no URL, no server fetch. |

### 3.2 Application Flow

```
1. CONSENT GATE .......... Blocking modal; AI disclosed; limitations stated.
                           Nothing reachable behind it. Reload returns here.

2. INTAKE ................ Four guided steps, one at a time.
                           Any language, any mixture. Free text.
                           |
                           +-- RED-FLAG CHECK (client, every keystroke, offline-capable)
                           |   HIT RED  -> Emergency screen (RED). No API call.
                           |   HIT AMBER -> Self-harm screen (AMBER). No API call.
                           |
                           +-- Patient can submit after any step ("Generate Now")

3. GENERATE .............. POST /api/brief -> Claude, forced tool call.
                           +-- RED-FLAG CHECK AGAIN on Claude's structured output
                               (catches signs that only surfaced after translation)

4. RENDER ................ Dual-column brief + "Not asked about" + limitations footer.
                           Patient confirmation: "Is this what you want to show the nurse?"

5. HANDOFF ............... Full-screen large-print brief for nurse.
                           Optional QR code (encodes brief text, no server fetch).
                           Optional patient-initiated share (Web Share API / sms: link).

6. PURGE ................. state = null; history entry replaced; timers cleared.
                           Inactivity auto-purge: 90s warning, 120s wipe.
```

### 3.3 Proxy Route (Server-side Only)

```typescript
// app/api/brief/route.ts — stateless, no logging, no persistence
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// POST /api/brief
// Input:  { transcript: string }
// Output: NurseBrief (tool call input from Claude)
// Errors: { error: string } with appropriate HTTP status
```

Key constraints:
- `ANTHROPIC_API_KEY` is **never** sent to the client
- No database client imported
- No request/response logging
- `temperature: 0` for translation fidelity

---

## 4. The Sijui Ladder

The judging rule for the day: **a correct "I don't know" beats a guess**.

| Level | Refusal | Trigger | Behaviour |
|-------|---------|---------|-----------|
| 1 | Refuses to diagnose | "Is this malaria?", "What do I have?" | Fixed refusal string. No hedging, no continuation. |
| 2 | Refuses to guess meaning | Ambiguous, garbled, unfamiliar phrasing | Marks item `sijui`, preserves verbatim, `standardised: null`. Renders as `[UNCLEAR — patient's words preserved]`. |
| 3 | Refuses to continue | Danger-sign keyword hit | Halts intake entirely. No API call. No brief. Sends patient to a human. |
| 4 | Refuses to overclaim itself | Its own regulatory classification | "Sijui — and neither does anyone else yet." |

---

## 5. Safety Interceptor

**Build order principle:** The interceptor ships before the AI layer. It is the one component that must never fail.

- Pure client-side function — no network dependency, no model dependency
- Runs on every keystroke batch
- Runs three times: on typed input, on speech transcript (if voice used), on Claude's structured output
- Tuned wide (recall over precision): false positives cost a nurse 10 seconds; false negatives cost more

**Trilingual lexicon categories:**

| Category | Screen |
|----------|--------|
| Cardiac / chest | RED |
| Breathing | RED |
| Neurological (stroke signs) | RED |
| Bleeding | RED |
| Consciousness | RED |
| Obstetric emergencies | RED |
| Paediatric danger signs | RED |
| Sepsis signs | RED |
| Trauma | RED |
| Self-harm disclosure | AMBER (distinct screen, distinct tone) |

**RED screen (medical emergency):**
```
STOP. Please do not finish this form.
Go to the nurse or the front desk now and show them this screen.

Simama. Usimalize fomu hii. Nenda kwa muuguzi sasa hivi.
```

**AMBER screen (self-harm disclosure):**
Calm, not alarming. No red, no capitals. Stops intake immediately. Does not attempt to counsel. Hands to a human.

---

## 6. Output Schema

```typescript
interface BriefItem {
  verbatim: string;         // Patient's exact words, original language
  standardised: string | null;  // Standard intake term. null if confidence = 'sijui'
  confidence: 'clear' | 'uncertain' | 'sijui';
}

interface NurseBrief {
  language_detected: string;
  chief_complaint: BriefItem[];
  onset_duration: BriefItem[];
  context_exposures: BriefItem[];
  patient_concerns: BriefItem[];
  not_asked_about: string[];  // Buckets with no data — never read silence as negative finding
}
```

**Why the schema is the real guardrail:** There is no field in this object that can hold a diagnosis, a probability, or a priority. Forcing the tool call means the model cannot answer in free prose. This is a stronger safety argument than "we told it not to."

---

## 7. Brief Format (Nurse View)

```
KAZI INTAKE BRIEF    Language: Swahili/Sheng mixed    Generated 09:42
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHIEF COMPLAINT
  throbbing headache          ← "kichwa inagonga"
  vomiting                    ← "nimetapika mara mbili"

ONSET AND DURATION
  began 3 days ago            ← "ilianza juzi kutwa"
  [UNCLEAR — patient's words] ← "inakuja inaenda vile vile"

CONTEXT AND EXPOSURES
  travel: Kisumu, last week   ← "nilikuwa Kisumu wiki iliyopita"
  no current medication       ← "sijameza dawa"

PATIENT'S STATED CONCERN
  patient is worried he has a brain tumour  ← "naskia ni tumour ya kichwa"
  (recorded as the patient's own worry — not a clinical possibility)

NOT ASKED ABOUT
  allergies · pregnancy status · prior episodes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This sheet contains only what the patient volunteered, translated into standard
terms. It is not an assessment. It rules nothing in and nothing out.
Items marked UNCLEAR were not understood and were deliberately not guessed.
```

Three design decisions worth defending:
1. **Verbatim column** — mistranslation is the actual clinical risk; this is the control for it
2. **"Not asked about"** — prevents a tidy structured document being read as a completed assessment
3. **Footer on every brief** — a structured document looks authoritative; this is the counterweight

---

## 8. Requirements

### Must Have (demo fails without these)

| ID | Requirement | Acceptance Test |
|----|-------------|-----------------|
| F-01 | Blocking consent gate | No input reachable until acknowledged. Reload returns to gate. |
| F-02 | Text intake across four buckets | Accepts Swahili, Sheng, English, code-switched in guided steps. |
| F-03 | Red-flag interceptor | "kifua kinauma" halts intake, shows RED screen. Works offline. |
| F-04 | Sijui boundary | Ambiguous diagnostic questions → SIJUI items in brief, not guesses. |
| F-05 | Structured brief via forced tool call | Output validates against schema on 10 consecutive runs. |
| F-06 | Dual-column rendering | Every line shows standardised term and patient verbatim. |
| F-07 | Uncertainty marking | Ambiguous input → `sijui` item with verbatim, no invented meaning. |
| F-08 | "Not asked about" section | Present on every brief, including complete ones. |
| F-09 | Purge | After "Done", no re-entry path recovers prior content. |
| F-10 | Nurse handoff | Full-screen large-print brief. QR optional, never the only path. |

### Should Have

| ID | Feature |
|----|---------|
| S-01 | Voice input via Web Speech API (sw-KE → en-KE fallback); transcript shown for correction before submit |
| S-02 | Patient-initiated share via Web Share API / sms: / WhatsApp deep link |
| S-03 | Inactivity auto-purge (90s warning, 120s wipe) |
| S-04 | Graceful API failure: degrade to raw verbatim, never to nothing |

### Explicitly Out of Scope

- Any diagnosis, differential, or "possible causes"
- Any triage priority, urgency score, or queue ordering
- Any treatment, drug, dosage, or home remedy
- Any patient identifier
- Any record that outlives the session
- Any automated third-party contact
- Any claim of clinical validation

### Non-Functional

| Property | Target |
|----------|--------|
| Brief generation latency | < 4s p50 on venue wifi |
| Red-flag check latency | Synchronous, client-side, sub-frame. Never awaits network. |
| Offline behaviour | Consent gate and red-flag interceptor fully offline. Brief generation requires network and says so. |
| Reading level | Patient-facing copy at primary-school level in all three languages. |
| Accessibility | Min 18px body text, 44px touch targets, one-handed use, person in pain or frightened. |

---

## 9. Compliance Position (Kenya AI Bill 2026)

**Our position:** Limited risk.

**Reasoning:** Kazi performs no clinical decision-making, produces no diagnosis, probability or triage priority, and takes no action. It restructures the patient's own words into a standard format and hands them to a human who holds all clinical authority.

**The counter-argument (we raise it ourselves):** The Bill appears to classify by sector, and healthcare is a named high-risk sector. On a strict sector reading, Kazi is high risk regardless of how narrow its function is.

**Our honest answer:** Sijui — and neither does anyone else yet. The classification criteria are deferred to regulations that do not exist. We state our position, we state the counter-argument, and we built for both.

**Cross-tier controls we implement regardless of classification:**

| Control | Implementation |
|---------|----------------|
| AI transparency notice | Blocking consent modal before any input field |
| Data minimisation (DPA 2019) | No name, ID, phone, DOB collected or accepted |
| No retention | No DB, no logs, no disk writes. In-memory only, purged on completion. |
| Human oversight by construction | Output is an input to a nurse. Cannot route, book, refer, or discharge. |
| Escalate-only automation | Interceptor's only possible effect: move patient toward a human faster. |

**If ruled high risk:** Registration on public register; pre-deployment risk and human rights impact assessments; DPIA; five-year input/output retention — which directly contradicts our zero-retention design. We would not deploy into a clinic without resolving this.

---

## 10. Risk Register

| Risk | Sev | Mitigation |
|------|-----|------------|
| Mistranslation changes clinical meaning | High | Verbatim column; no-embellishment rule in prompt; temperature 0; sijui marking. |
| Danger sign missed (Swahili/Sheng) | High | Trilingual lexicon; three checkpoints; recall over precision; clinician review required before real use. |
| Nurse over-trusts structured sheet | High | "Not asked about" section; limitations footer; no priority/severity in schema. |
| Self-harm disclosure handled as routine form field | High | AMBER category with distinct screen; stops intake; no counselling; immediate human handover. |
| Model emits a diagnosis despite prompt | Med | Schema has no field for one; tool call forced; adversarial pass before demo. |
| API key exposed client-side | High | Server-only route handler. Grep client bundle for key before demo. |
| Venue network fails | Med | Consent gate + interceptor offline. Screen recording as backup. |
| Previous patient data visible on shared tablet | High | Purge on done, 120s inactivity, navigation; no browser storage. |

---

## 11. What We Say Sijui To

- **Our risk tier** — classification criteria have not been made
- **Translation accuracy** — we have not measured it; this is the first thing to test with real users
- **Danger-sign completeness** — starting point from published danger signs, not clinician-validated
- **Sheng coverage** — Sheng varies by neighbourhood, age, and year
- **Whether nurses would use it** — we designed for a role we have not yet sat beside for a shift

---

*Kazi: Kabla ya Daktari — Build Specification v2.0 · Hackathon prototype, not clinically validated, not for use with real patients · Regulatory content is an engineering self-assessment, not legal advice.*
