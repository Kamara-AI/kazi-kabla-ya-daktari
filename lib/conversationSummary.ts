/**
 * Assembles the nurse-handoff summary from accumulated structured fields.
 *
 * It is assembled here, from the accumulated structured fields, and never
 * generated as fresh prose. That is the whole point: a text generation step at
 * this stage could smooth two answers into a claim the patient never made, and
 * could quietly promote "I think I have malaria" from a belief into a finding.
 * Sorting values into sections cannot do either.
 */

import type { Accumulated, Category, SafetyFlag } from "./conversationTypes";

/**
 * Each rendered line keeps a pointer back to the entry it came from. Sections
 * regroup items by category, so a line's position on the card says nothing
 * about its index in `accumulated` — without this, the review step's "Remove"
 * would strike a different line than the one the patient pointed at.
 */
export interface SummaryItem {
  text: string;
  source: { kind: "reported" | "belief" | "unknown"; index: number };
}

export interface SummarySection {
  key: string;
  title: string;
  titleSw?: string;
  note?: string;
  items: SummaryItem[];
}

export interface Summary {
  sections: SummarySection[];
  safety: SafetyFlag;
  isEmpty: boolean;
}

const SECTION_TITLES: Record<Category, { en: string; sw: string }> = {
  symptom: { en: "Symptoms", sw: "Dalili" },
  timeline: { en: "Timeline", sw: "Muda" },
  severity: { en: "Severity", sw: "Ukali" },
  associated_symptom: { en: "Associated symptoms", sw: "Dalili nyingine" },
  context: { en: "Other context", sw: "Maelezo mengine" },
};

const SECTION_ORDER: Category[] = [
  "symptom",
  "timeline",
  "severity",
  "associated_symptom",
  "context",
];

/** Show the patient's own phrasing alongside a restatement when they differ. */
function render(detail: string, patientWords: string): string {
  const same =
    detail.trim().toLowerCase() === patientWords.trim().toLowerCase();
  return same || !patientWords.trim()
    ? detail.trim()
    : `${detail.trim()} — "${patientWords.trim()}"`;
}

/** Build the structured summary from the session's accumulated data. */
export function buildSummary(accumulated: Accumulated): Summary {
  const sections: SummarySection[] = [];

  for (const category of SECTION_ORDER) {
    const items: SummaryItem[] = [];
    accumulated.reported.forEach((item, index) => {
      if (item.category !== category) return;
      items.push({
        text: render(item.detail, item.patient_words),
        source: { kind: "reported", index },
      });
    });
    if (items.length > 0) {
      const titles = SECTION_TITLES[category];
      sections.push({
        key: category,
        title: titles.en,
        titleSw: titles.sw,
        items,
      });
    }
  }

  if (accumulated.beliefs.length > 0) {
    sections.push({
      key: "beliefs",
      title: "Patient's own concerns",
      titleSw: "Wasiwasi wa mgonjwa",
      note: "Recorded as what the patient believes or is worried about — not as a finding.",
      items: accumulated.beliefs.map((item, index) => ({
        text: render(item.belief, item.patient_words),
        source: { kind: "belief" as const, index },
      })),
    });
  }

  if (accumulated.unknowns.length > 0) {
    sections.push({
      key: "unknowns",
      title: "Still unclear",
      titleSw: "Bado haijulikani",
      note: "Not asked, or the patient did not know.",
      items: accumulated.unknowns.map((text, index) => ({
        text,
        source: { kind: "unknown" as const, index },
      })),
    });
  }

  const substantive = sections.some((section) => section.key !== "unknowns");
  return { sections, safety: accumulated.safety, isEmpty: !substantive };
}

/** Plain-text form, for the QR payload and the copy-to-clipboard button. */
export function summaryToText(summary: Summary): string {
  const lines: string[] = ["KABLA YA DAKTARI — AI-assisted intake summary", ""];

  if (summary.safety !== "none") {
    lines.push(
      summary.safety === "emergency"
        ? "** FLAGGED: patient described something needing immediate attention **"
        : "** FLAGGED: patient described something needing to be seen today **",
      "",
    );
  }

  for (const section of summary.sections) {
    lines.push(section.title.toUpperCase());
    if (section.note) lines.push(`(${section.note})`);
    for (const item of section.items) lines.push(`  - ${item.text}`);
    lines.push("");
  }

  lines.push("No diagnosis was generated. Not a permanent medical record.");
  return lines.join("\n");
}
