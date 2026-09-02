/**
 * Accumulating the structured fields across turns.
 *
 * This is the only place session content is assembled, and it only ever moves
 * values that came out of a validated turn. Nothing is rewritten, merged or
 * inferred here — that is what lets the summary step promise it invents nothing.
 */

import type {
  Accumulated,
  ClaudeTurn,
  PatientBelief,
  ReportedItem,
} from "./conversationTypes";

const SAFETY_RANK = { none: 0, urgent: 1, emergency: 2 } as const;

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeReported(
  existing: ReportedItem[],
  incoming: ReportedItem[],
): ReportedItem[] {
  const seen = new Set(
    existing.map((item) => `${item.category}|${normalise(item.detail)}`),
  );
  const merged = [...existing];
  for (const item of incoming) {
    if (!item.detail.trim()) continue;
    const key = `${item.category}|${normalise(item.detail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeBeliefs(
  existing: PatientBelief[],
  incoming: PatientBelief[],
): PatientBelief[] {
  const seen = new Set(existing.map((item) => normalise(item.belief)));
  const merged = [...existing];
  for (const item of incoming) {
    if (!item.belief.trim()) continue;
    const key = normalise(item.belief);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** Merge a new turn into the running session state. */
export function applyTurn(current: Accumulated, turn: ClaudeTurn): Accumulated {
  const unknowns: string[] = [];
  const seenUnknowns = new Set<string>();
  for (const item of turn.unknown_information) {
    const key = normalise(item);
    if (!key || seenUnknowns.has(key)) continue;
    seenUnknowns.add(key);
    unknowns.push(item.trim());
  }

  return {
    reported: mergeReported(current.reported, turn.reported_information),
    beliefs: mergeBeliefs(current.beliefs, turn.patient_beliefs),
    // Replaced, not appended: each turn restates what is still open, so a
    // question the patient has since answered drops off the nurse's card.
    unknowns,
    // Raised, never lowered. A flag that fired earlier in the session still
    // belongs on the handoff even if later turns are calm.
    safety:
      SAFETY_RANK[turn.safety_flag] > SAFETY_RANK[current.safety]
        ? turn.safety_flag
        : current.safety,
  };
}

/** Per-item removal for the review step. The patient can strike anything before confirming. */
export function removeReported(current: Accumulated, index: number): Accumulated {
  return {
    ...current,
    reported: current.reported.filter((_, i) => i !== index),
  };
}

export function removeBelief(current: Accumulated, index: number): Accumulated {
  return {
    ...current,
    beliefs: current.beliefs.filter((_, i) => i !== index),
  };
}
