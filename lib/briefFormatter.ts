/**
 * briefFormatter.ts — pure function that serialises a NurseBrief to a
 * formatted plain-text string for printing or PDF download.
 *
 * Why pure / no side effects: the formatter is called from both the browser
 * (before download) and could be called server-side in tests. No DOM, no
 * fetch, no next/headers. Output is deterministic given the same input.
 *
 * Format follows the nurse handoff spec:
 *
 *   KAZI INTAKE BRIEF
 *   Language: [language_detected]     Generated: [HH:MM] EAT
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   CHIEF COMPLAINT
 *     [standardised]    ← "[verbatim]"   [UNCLEAR if sijui]
 *   ...
 *   NOT ASKED ABOUT
 *     [items or "All areas covered"]
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   [disclaimer footer]
 *
 * Confidence labels:
 *   clear      → no qualifier
 *   uncertain  → "(uncertain / haijulikani vizuri)"
 *   sijui      → "UNCLEAR — patient's words: "[verbatim]""
 *
 * All timestamps are in EAT (UTC+3) as per project standards.
 */

import type { NurseBrief, BriefItem } from '@/lib/schema';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

const BUCKET_LABELS: Record<keyof Omit<NurseBrief, 'language_detected' | 'not_asked_about'>, string> = {
  chief_complaint: 'CHIEF COMPLAINT',
  onset_duration: 'ONSET & DURATION',
  context_exposures: 'CONTEXT & EXPOSURES',
  patient_concerns: "PATIENT'S CONCERNS",
};

type BucketKey = keyof typeof BUCKET_LABELS;

const BUCKET_ORDER: BucketKey[] = [
  'chief_complaint',
  'onset_duration',
  'context_exposures',
  'patient_concerns',
];

/**
 * Format a single BriefItem into a display line.
 *
 * Rendering rules:
 *  - confidence 'sijui': show verbatim prominently, mark as UNCLEAR
 *  - confidence 'uncertain': show standardised + verbatim + qualifier
 *  - confidence 'clear': show standardised + verbatim (if different)
 */
function formatItem(item: BriefItem, index: number): string {
  const bullet = `  ${index + 1}.`;

  if (item.confidence === 'sijui') {
    // No standardised term — preserve verbatim, flag clearly for nurse
    return `${bullet} UNCLEAR — "${item.verbatim}"`;
  }

  const std = item.standardised ?? item.verbatim;
  const verbatimDiffers = item.verbatim.trim().toLowerCase() !== std.trim().toLowerCase();

  let line = `${bullet} ${std}`;

  if (verbatimDiffers) {
    line += `  ← "${item.verbatim}"`;
  }

  if (item.confidence === 'uncertain') {
    line += '  (uncertain / haijulikani vizuri)';
  }

  return line;
}

/**
 * Format a bucket section. Returns an empty string if the bucket has no items
 * (the NOT ASKED ABOUT section handles the accounting separately).
 */
function formatBucket(label: string, items: BriefItem[]): string {
  if (items.length === 0) return '';

  const lines: string[] = [label];
  items.forEach((item, i) => {
    lines.push(formatItem(item, i));
  });

  return lines.join('\n');
}

/**
 * Convert a generatedAt string to EAT time display.
 *
 * If the string is a valid ISO-8601 date, parse and add UTC+3 offset.
 * If it cannot be parsed, return it as-is (safe fallback).
 */
function formatTimestamp(generatedAt: string): string {
  try {
    const date = new Date(generatedAt);
    if (isNaN(date.getTime())) return generatedAt;

    // Offset to EAT (UTC+3)
    const eatMs = date.getTime() + 3 * 60 * 60 * 1000;
    const eat = new Date(eatMs);

    const pad = (n: number): string => String(n).padStart(2, '0');
    const datePart = `${eat.getUTCFullYear()}-${pad(eat.getUTCMonth() + 1)}-${pad(eat.getUTCDate())}`;
    const timePart = `${pad(eat.getUTCHours())}:${pad(eat.getUTCMinutes())}`;
    return `${datePart} ${timePart} EAT`;
  } catch {
    return generatedAt;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise a NurseBrief to a formatted plain-text string.
 *
 * @param brief       The structured brief from the API / tool call
 * @param generatedAt ISO-8601 timestamp string (will be converted to EAT for display)
 * @returns           Multi-line string suitable for PDF rendering or plain-text download
 */
export function formatBriefAsText(brief: NurseBrief, generatedAt: string): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────

  lines.push('KAZI INTAKE BRIEF');
  lines.push(
    `Language: ${brief.language_detected}     Generated: ${formatTimestamp(generatedAt)}`,
  );
  lines.push(RULE);
  lines.push('');

  // ── Buckets ─────────────────────────────────────────────────────────────

  for (const key of BUCKET_ORDER) {
    const label = BUCKET_LABELS[key];
    const items = brief[key];
    const section = formatBucket(label, items);
    if (section) {
      lines.push(section);
      lines.push('');
    }
  }

  // ── Not asked about ─────────────────────────────────────────────────────

  lines.push('NOT ASKED ABOUT');
  if (brief.not_asked_about.length === 0) {
    lines.push('  All areas covered.');
  } else {
    for (const item of brief.not_asked_about) {
      // Map bucket key names to human-readable labels if possible
      const humanLabel =
        BUCKET_LABELS[item as BucketKey] ??
        item.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      lines.push(`  • ${humanLabel}`);
    }
    lines.push('');
    lines.push(
      '  NOTE: The nurse must NOT read silence as a negative finding.',
    );
    lines.push(
      '  KUMBUKA: Muuguzi ASITAFSIRI kukosekana kwa taarifa kama matokeo hasi.',
    );
  }

  lines.push('');
  lines.push(RULE);
  lines.push('');

  // ── Footer / disclaimer ──────────────────────────────────────────────────

  lines.push(
    'This sheet contains only what the patient volunteered during intake.',
  );
  lines.push(
    'It is NOT a diagnosis, clinical assessment, or permanent medical record.',
  );
  lines.push(
    'All data is discarded when the session ends.',
  );
  lines.push('');
  lines.push(
    'Karatasi hii ina tu taarifa aliyotoa mgonjwa wakati wa usaili.',
  );
  lines.push(
    'SI utambuzi wa ugonjwa, tathmini ya kimatibabu, wala rekodi ya kudumu ya matibabu.',
  );
  lines.push(
    'Data yote itafutwa baada ya kikao kumalizika.',
  );
  lines.push('');
  lines.push('NOT clinically validated. Hackathon prototype — requires clinician review.');

  return lines.join('\n');
}
