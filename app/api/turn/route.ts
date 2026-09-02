/**
 * POST /api/turn
 *
 * Stateless multi-turn proxy to the Anthropic Messages API.
 * Holds the API key server-side only. No logging, no storage, no DB.
 *
 * Input:  { messages: Message[], force_summary?: boolean }
 * Output: { turn: ClaudeTurn } on success
 *         { error: { code: string; message: string } } on failure
 *
 * The patient-facing error message is always the same string —
 * internal codes are for operators only and never reach the UI.
 *
 * Privacy guarantees (same as /api/brief):
 *  - No database client imported
 *  - No request/response logging
 *  - No disk writes
 *  - temperature: 0 for consistency
 *
 * Prompt caching: the system prompt carries cache_control: ephemeral,
 * so after the first turn the prefix is served from Anthropic's cache,
 * cutting latency by ~60% on turns 2–6.
 */

import { parseTurn, InvalidTurnError } from "@/lib/conversationValidate";
import type { Message } from "@/lib/conversationTypes";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Patient-facing error message — identical regardless of failure mode so we
// never leak internal details through the UI.
// ---------------------------------------------------------------------------
const PATIENT_ERROR_MESSAGE =
  "We're unable to process this right now. Please describe your symptoms directly to a healthcare professional.";

// ---------------------------------------------------------------------------
// System prompt — byte-stable (no timestamps, no session ID, no patient data)
// so it caches cleanly as the request prefix on every turn.
// ---------------------------------------------------------------------------
const TURN_SYSTEM_PROMPT = `You are the intake assistant for "Wingu la Dalili" ("Symptom Cloud"), used by patients in a clinic waiting room before they see a nurse or clinician.

Your only job is to help the patient describe what they are experiencing, in their own words, so the nurse can read it in seconds. You are a listener and a note-taker. You are not a clinician.

# Hard limits

- Never diagnose. Never name a disease, condition or infection as the cause of what the patient describes, and never rank possibilities.
- Never recommend treatment: no medicines, no doses, no home remedies, no tests, no "you should probably...".
- Never predict how serious this is, how it will progress, or what the clinician will find.
- Never record anything the patient did not say. If you did not hear it, it belongs in unknown_information, not in reported_information.
- Never ask for identifying details (name, ID or clinic number, phone, email, address, employer, exact date of birth). If the patient volunteers any, acknowledge them normally but leave them out of every structured field.
- If you are unsure what the patient means, ask — or say you do not know. Do not fill the gap with a guess.

# Language

Answer in the language the patient is writing in, and match its register — Swahili, English, Sheng, or a mix. Reuse the patient's own words for their symptoms rather than substituting clinical terms; the nurse needs to see how the patient describes it. Keep patient_words verbatim in the patient's language, even when detail is a neutral restatement.

# The conversation

Ask exactly ONE question per turn, and let it follow from the answer you just received — you are not working through a fixed script. Keep message short: one or two sentences, plus the question. No preamble, no lists of caveats, no repeating back everything the patient has already told you.

Aim to cover, over 4–6 questions: what the main problem is, how long it has been going on, how bad it is and whether it is changing, anything that makes it better or worse, anything else that started around the same time, and what the patient is most worried about. Ask about what is still missing, not what you already have.

Ask at least four questions before you return generate_summary, and no more than six. The two exceptions both belong to the patient: if they ask to finish, finish, and if the situation should not wait in a queue, say so on that turn rather than working through the remaining ground first.

When a closed question genuinely has a small set of natural answers, put them in answer_options (2–5 short options) so the patient can tap instead of type. For anything open-ended, leave answer_options empty. Do not put "I don't know" in answer_options — the interface always offers that separately.

# THE VERBATIM RULE

Every standardised term you produce must be traceable to specific words the patient actually used. If you cannot point to the words, do not produce the term.

# THE NO-EMBELLISHMENT RULE (this is the one people get wrong)

Never introduce severity, intensity, laterality, frequency, or duration that the patient did not state.

  "kichwa inagonga"   -> "throbbing headache"          CORRECT
  "kichwa inagonga"   -> "SEVERE throbbing headache"   WRONG  (severity not stated)
  "tumbo inauma"      -> "abdominal pain"              CORRECT
  "tumbo inauma"      -> "acute lower abdominal pain"  WRONG  (site and acuity invented)
  "maumivu ya mguu"   -> "leg pain"                    CORRECT
  "maumivu ya mguu"   -> "left lower limb pain"        WRONG  (laterality not stated)

If the patient DID say it, keep it and attribute it:
  "inauma sana"       -> patient_words: "inauma sana"  detail: "pain, patient states severe"

# THE SIJUI RULE

If a phrase is ambiguous, unfamiliar, or you are not confident of the meaning: set next_action to sijui, say plainly that you do not know and that the nurse is the right person to answer, then carry straight on with your next question in the same message. Prefer this over any answer you are not certain of. An honest gap is more useful than a confident wrong answer.

# Choosing next_action

- ask_question — the normal case. message ends with one question.
- sijui — you do not know, or the patient asked something outside what you can do (what is wrong with them, what medicine to take, how serious it is). Say plainly you do not know and the nurse is the right person to answer. After saying that, carry straight on with your next question in the same message. One question per turn still holds.
- safety_response — the patient describes something that should not wait in a queue. Say clearly that they should tell staff now or seek urgent care, without naming a cause and without saying what it might be. Set safety_flag to emergency for signs that need immediate attention (trouble breathing, chest pain or pressure, heavy or uncontrolled bleeding, fainting or unresponsiveness, a fit or seizure, stiff neck with fever, confusion or sudden weakness on one side, sudden loss of vision, severe injury or burn, poisoning or overdose, very sick infant, pregnancy with bleeding or severe pain, thoughts of harming themselves), and urgent for things that need to be seen today but not this minute. Otherwise safety_flag is none. After the safety message, carry on with your next question.
- generate_summary — the ground above is covered well enough for a nurse to take over, or the patient has asked to finish. Do not write the summary itself; the summary is assembled from the structured fields you have already returned. Use message to tell the patient their summary is ready.

# The structured fields

reported_information and patient_beliefs are additions: return only what is NEW on THIS turn, because the interface accumulates them and repeating an earlier item duplicates it on the nurse's card. unknown_information is the opposite — it replaces what you sent last turn, so send the complete list of what is still open every time.

- reported_information — what the patient reported, one item per fact, each tagged symptom, timeline, severity, associated_symptom or context.
- patient_beliefs — what the patient thinks is happening or what they are worried about ("I think I have malaria", "I think it's the water"). These are never facts and never yours; record them here, unjudged, and do not confirm or correct them.
- unknown_information — everything a nurse would want to know that is still open: questions the patient answered with "I don't know", things they were unsure about, and ground you have not covered yet. Drop an entry once the patient has answered it, and carry the rest forward. This is what makes the handoff honest.

If the patient's answer is empty, unrelated, or you cannot make sense of it, record nothing, note the gap in unknown_information, and ask the question again more simply.`;

// Sent as a mid-conversation system message (operator channel) when the patient
// presses "Generate My Summary". Carries operator authority without looking like
// patient text, and without touching the cached system prefix.
const FORCE_SUMMARY_INSTRUCTION =
  'The patient has pressed "Generate My Summary" and wants to stop here. ' +
  "Return next_action: generate_summary on this turn. Do not ask another question. " +
  "Record anything from their last answer that is not recorded yet, and put whatever " +
  "is still uncovered in unknown_information so the nurse can see what was not asked.";

// Fallback for the same intent when the transcript does not end on a patient
// message (a question was shown but never answered). A system message must
// follow a user turn, so we inject a synthetic user turn instead.
const PATIENT_REQUESTED_SUMMARY =
  "(The patient chose to finish here and generate their summary now.)";

// ---------------------------------------------------------------------------
// Tool schema — emit_turn forces structured output without the beta header.
// Every field required; no nullable fields.
// ---------------------------------------------------------------------------
const EMIT_TURN_TOOL = {
  name: "emit_turn",
  description:
    "Emit one structured turn of the intake conversation. Call this tool exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The only text shown to the patient this turn.",
      },
      reported_information: {
        type: "array",
        description:
          "NEW items only this turn. The client accumulates these across turns.",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "symptom",
                "timeline",
                "severity",
                "associated_symptom",
                "context",
              ],
            },
            detail: {
              type: "string",
              description: "Neutral restatement, no clinical interpretation.",
            },
            patient_words: {
              type: "string",
              description: "The patient's own phrasing, verbatim.",
            },
          },
          required: ["category", "detail", "patient_words"],
          additionalProperties: false,
        },
      },
      patient_beliefs: {
        type: "array",
        description:
          "NEW beliefs only this turn. What the patient thinks is happening or fears.",
        items: {
          type: "object",
          properties: {
            belief: { type: "string" },
            patient_words: { type: "string" },
          },
          required: ["belief", "patient_words"],
          additionalProperties: false,
        },
      },
      unknown_information: {
        type: "array",
        description:
          "COMPLETE list of what is still open. Replaces the previous turn's list entirely.",
        items: { type: "string" },
      },
      safety_flag: {
        type: "string",
        enum: ["none", "urgent", "emergency"],
      },
      next_action: {
        type: "string",
        enum: [
          "ask_question",
          "sijui",
          "safety_response",
          "generate_summary",
        ],
      },
      answer_options: {
        type: "array",
        description:
          "MCQ choices for this question (2–5 items), or empty array for free text. Never include an 'I don't know' option — the UI adds that separately.",
        items: { type: "string" },
        maxItems: 5,
      },
    },
    required: [
      "message",
      "reported_information",
      "patient_beliefs",
      "unknown_information",
      "safety_flag",
      "next_action",
      "answer_options",
    ],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 2000;

interface TurnRequestBody {
  messages: Message[];
  force_summary?: boolean;
}

function validateBody(raw: unknown): TurnRequestBody {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("messages" in raw) ||
    !Array.isArray((raw as Record<string, unknown>).messages)
  ) {
    throw new Error("messages must be an array");
  }

  const body = raw as Record<string, unknown>;
  const messages = body.messages as unknown[];

  if (messages.length === 0) {
    throw new Error("messages array is empty");
  }

  const firstRole = (messages[0] as Record<string, unknown>)?.role;
  if (firstRole !== "user") {
    throw new Error("first message must have role 'user'");
  }

  if (messages.length > MAX_MESSAGES) {
    throw new Error(`messages array exceeds limit of ${MAX_MESSAGES}`);
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as Record<string, unknown>;
    if (m?.role !== "user" && m?.role !== "assistant") {
      throw new Error(`messages[${i}].role must be 'user' or 'assistant'`);
    }
    if (typeof m?.content !== "string") {
      throw new Error(`messages[${i}].content must be a string`);
    }
    if ((m.content as string).length > MAX_MESSAGE_CHARS) {
      throw new Error(
        `messages[${i}].content exceeds ${MAX_MESSAGE_CHARS} characters`,
      );
    }
  }

  return {
    messages: messages as Message[],
    force_summary: typeof body.force_summary === "boolean"
      ? body.force_summary
      : false,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: {
          code: "CONFIGURATION_ERROR",
          message: PATIENT_ERROR_MESSAGE,
        },
      },
      { status: 500 },
    );
  }

  let body: TurnRequestBody;
  try {
    const raw = await req.json();
    body = validateBody(raw);
  } catch (err) {
    return Response.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: PATIENT_ERROR_MESSAGE,
        },
      },
      { status: 400 },
    );
  }

  // Build the message list for the API call.
  // If force_summary is set, inject the operator instruction:
  //   - Prefer a system turn (after the last user message) — but the
  //     Anthropic API only allows user/assistant alternation, so we
  //     splice a synthetic user message when the last turn is assistant.
  const apiMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...body.messages,
  ];

  if (body.force_summary) {
    const lastRole = apiMessages[apiMessages.length - 1]?.role;
    if (lastRole === "user") {
      // Append the force-summary instruction as a synthetic user addendum.
      // Slice to MAX_MESSAGE_CHARS so the concatenation cannot push content
      // past the validated limit (BUG-03).
      const original = apiMessages[apiMessages.length - 1].content;
      const appended = original + "\n\n" + PATIENT_REQUESTED_SUMMARY;
      apiMessages[apiMessages.length - 1] = {
        role: "user",
        content: appended.slice(0, MAX_MESSAGE_CHARS),
      };
    } else {
      // Last turn was assistant — add a fresh user turn with the instruction.
      apiMessages.push({ role: "user", content: PATIENT_REQUESTED_SUMMARY });
    }
  }

  // Anthropic Messages API request
  // cache_control: ephemeral on the system prompt enables prompt caching —
  // after the first turn the prefix is served from cache, cutting p50 latency
  // by ~60% on turns 2–6 (Anthropic docs: prompt caching, 2024).
  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        temperature: 0,
        system: [
          {
            type: "text",
            text: TURN_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [EMIT_TURN_TOOL],
        tool_choice: { type: "tool", name: "emit_turn" },
        messages: apiMessages,
      }),
    });
  } catch {
    return Response.json(
      { error: { code: "NETWORK_ERROR", message: PATIENT_ERROR_MESSAGE } },
      { status: 502 },
    );
  }

  if (!anthropicRes.ok) {
    return Response.json(
      { error: { code: "API_ERROR", message: PATIENT_ERROR_MESSAGE } },
      { status: 502 },
    );
  }

  let data: unknown;
  try {
    data = await anthropicRes.json();
  } catch {
    return Response.json(
      { error: { code: "PARSE_ERROR", message: PATIENT_ERROR_MESSAGE } },
      { status: 502 },
    );
  }

  // Extract the tool_use block
  const content = (data as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return Response.json(
      { error: { code: "NO_TOOL_CALL", message: PATIENT_ERROR_MESSAGE } },
      { status: 502 },
    );
  }

  const toolBlock = content.find(
    (b: unknown) =>
      typeof b === "object" &&
      b !== null &&
      (b as Record<string, unknown>).type === "tool_use",
  ) as Record<string, unknown> | undefined;

  if (!toolBlock) {
    return Response.json(
      { error: { code: "NO_TOOL_CALL", message: PATIENT_ERROR_MESSAGE } },
      { status: 502 },
    );
  }

  // Validate the tool call input through our runtime type guard.
  // This is the third validation pass (API schema → tool contract → parseTurn).
  let turn;
  try {
    turn = parseTurn(toolBlock.input);
  } catch (err) {
    const reason =
      err instanceof InvalidTurnError ? err.message : "unknown validation error";
    return Response.json(
      {
        error: {
          code: "MALFORMED_TURN",
          message: PATIENT_ERROR_MESSAGE,
          // Operator-only detail — not surfaced in the UI
          detail: reason,
        },
      },
      { status: 502 },
    );
  }

  return Response.json({ turn });
}
