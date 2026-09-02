/**
 * Client-side shape validation for ClaudeTurn.
 *
 * The API already enforces this schema via the emit_turn tool contract, and
 * the backend re-validates with Pydantic. This third check exists because the
 * flow spec puts the gate here: nothing is shown to the patient until the JSON
 * has been proven to be a valid turn. Intentionally hand-written and
 * dependency-free — a validator is not a good place for a supply chain.
 */

import {
  CATEGORIES,
  NEXT_ACTIONS,
  SAFETY_FLAGS,
  type Category,
  type ClaudeTurn,
  type NextAction,
  type PatientBelief,
  type ReportedItem,
  type SafetyFlag,
} from "./conversationTypes";

export class InvalidTurnError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, at: string): string {
  if (typeof value !== "string")
    throw new InvalidTurnError(`${at} was not a string`);
  return value;
}

function requireArray(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value))
    throw new InvalidTurnError(`${at} was not an array`);
  return value;
}

function requireMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  at: string,
): T {
  const text = requireString(value, at);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new InvalidTurnError(`${at} was not one of ${allowed.join(", ")}`);
  }
  return text as T;
}

function parseReportedItem(value: unknown, at: string): ReportedItem {
  if (!isRecord(value)) throw new InvalidTurnError(`${at} was not an object`);
  return {
    category: requireMember<Category>(value.category, CATEGORIES, `${at}.category`),
    detail: requireString(value.detail, `${at}.detail`),
    patient_words: requireString(value.patient_words, `${at}.patient_words`),
  };
}

function parseBelief(value: unknown, at: string): PatientBelief {
  if (!isRecord(value)) throw new InvalidTurnError(`${at} was not an object`);
  return {
    belief: requireString(value.belief, `${at}.belief`),
    patient_words: requireString(value.patient_words, `${at}.patient_words`),
  };
}

/** Throws `InvalidTurnError` unless `value` is a complete, well-typed ClaudeTurn. */
export function parseTurn(value: unknown): ClaudeTurn {
  if (!isRecord(value)) throw new InvalidTurnError("turn was not an object");

  const message = requireString(value.message, "message").trim();
  if (!message) throw new InvalidTurnError("message was empty");

  const nextAction = requireMember<NextAction>(
    value.next_action,
    NEXT_ACTIONS,
    "next_action",
  );

  const turn: ClaudeTurn = {
    message,
    reported_information: requireArray(
      value.reported_information,
      "reported_information",
    ).map((item, i) => parseReportedItem(item, `reported_information[${i}]`)),
    patient_beliefs: requireArray(
      value.patient_beliefs,
      "patient_beliefs",
    ).map((item, i) => parseBelief(item, `patient_beliefs[${i}]`)),
    unknown_information: requireArray(
      value.unknown_information,
      "unknown_information",
    ).map((item, i) => requireString(item, `unknown_information[${i}]`)),
    safety_flag: requireMember<SafetyFlag>(
      value.safety_flag,
      SAFETY_FLAGS,
      "safety_flag",
    ),
    next_action: nextAction,
    answer_options: requireArray(
      value.answer_options,
      "answer_options",
    ).map((item, i) => requireString(item, `answer_options[${i}]`)),
  };

  // Blank options would render as unlabelled buttons, and a long list stops
  // being a tappable choice — treat either as a turn we cannot show.
  if (turn.answer_options.some((option) => !option.trim())) {
    throw new InvalidTurnError("answer_options contained a blank option");
  }
  if (turn.answer_options.length > 6) {
    throw new InvalidTurnError(
      `answer_options had ${turn.answer_options.length} options`,
    );
  }

  return turn;
}
