/**
 * The turn contract for the Kazi multi-turn conversation engine.
 *
 * Mirrors backend/schema.py. Every field is required and non-nullable —
 * structured outputs are strictest with closed schemas, and "absent" is
 * always representable as an empty list or an explicit enum member.
 */

export const CATEGORIES = [
  "symptom",
  "timeline",
  "severity",
  "associated_symptom",
  "context",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SAFETY_FLAGS = ["none", "urgent", "emergency"] as const;
export type SafetyFlag = (typeof SAFETY_FLAGS)[number];

export const NEXT_ACTIONS = [
  "ask_question",
  "sijui",
  "safety_response",
  "generate_summary",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

/** One thing the patient actually reported. Never inferred. */
export interface ReportedItem {
  category: Category;
  /** Neutral restatement, no clinical interpretation. */
  detail: string;
  /** The patient's own phrasing, verbatim. */
  patient_words: string;
}

/** Something the patient thinks is true. Stays labelled as a belief. */
export interface PatientBelief {
  belief: string;
  patient_words: string;
}

/** The structured object Claude returns exactly once per turn. */
export interface ClaudeTurn {
  /** The only text shown to the patient this turn. */
  message: string;
  reported_information: ReportedItem[];
  patient_beliefs: PatientBelief[];
  unknown_information: string[];
  safety_flag: SafetyFlag;
  next_action: NextAction;
  /** MCQ choices for this question, or empty for free text. */
  answer_options: string[];
}

/**
 * What the client posts back each turn. The server is stateless —
 * the full history travels with every request.
 */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Everything the summary is built from.
 *
 * `reported` and `beliefs` accumulate across turns — each new turn appends
 * only what is new. `unknowns` is replaced by each turn's list, because a
 * question that has since been answered is no longer unknown. `safety` is
 * raised, never lowered.
 */
export interface Accumulated {
  reported: ReportedItem[];
  beliefs: PatientBelief[];
  unknowns: string[];
  safety: SafetyFlag;
}

export const EMPTY_ACCUMULATED: Accumulated = {
  reported: [],
  beliefs: [],
  unknowns: [],
  safety: "none",
};
