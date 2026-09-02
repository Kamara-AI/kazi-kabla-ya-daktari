'use client';

/**
 * BriefView — dual-column nurse handoff brief.
 *
 * Implements F-05 (structured brief), F-06 (dual-column rendering),
 * F-07 (uncertainty marking), F-08 ("Not asked about"), F-10 (nurse handoff).
 *
 * Two phases:
 *   1. Patient confirmation — "Is this what you want to show the nurse?"
 *   2. Nurse handoff — full-screen large-print view
 *
 * Fallback (S-04): if brief is null (API failure), show raw transcript.
 * Degrade to unformatted, never to nothing.
 *
 * Design rationale (§9.2 of spec):
 *   - Verbatim column: mistranslation is the real clinical risk; this is the control.
 *   - "Not asked about": prevents a tidy sheet being read as a completed assessment.
 *   - Footer on every view: a structured document looks authoritative; this is the counterweight.
 */

import { useState } from 'react';
import type { NurseBrief, BriefItem } from '@/lib/schema';

interface BriefViewProps {
  brief: NurseBrief | null;
  rawTranscript: string;
  error: string | null;
  onDone: () => void;
}

const SECTION_LABELS: Record<keyof Omit<NurseBrief, 'language_detected' | 'not_asked_about'>, string> = {
  chief_complaint: 'Chief Complaint',
  onset_duration: 'Onset & Duration',
  context_exposures: 'Context & Exposures',
  patient_concerns: "Patient's Stated Concern",
};

function ConfidenceBadge({ confidence }: { confidence: BriefItem['confidence'] }) {
  if (confidence === 'clear') return null;
  if (confidence === 'sijui') {
    return (
      <span className="inline-block text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded ml-2">
        UNCLEAR
      </span>
    );
  }
  return (
    <span className="inline-block text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded ml-2">
      uncertain
    </span>
  );
}

function BriefSection({
  title,
  items,
  handoffMode,
}: {
  title: string;
  items: BriefItem[];
  handoffMode: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="section-label">{title}</p>
      <div className="divide-y divide-gray-100">
        {items.map((item, i) => (
          <div key={i} className={`brief-row ${handoffMode ? 'py-4' : 'py-3'}`}>
            {/* Standardised term */}
            <div className={`brief-standard ${handoffMode ? 'text-xl' : 'text-base'}`}>
              {item.confidence === 'sijui' || item.standardised === null ? (
                <span className="text-amber-700 font-medium">
                  [UNCLEAR — see patient&apos;s words]
                  <ConfidenceBadge confidence={item.confidence} />
                </span>
              ) : (
                <>
                  {item.standardised}
                  <ConfidenceBadge confidence={item.confidence} />
                </>
              )}
            </div>

            {/* Verbatim — the audit trail */}
            <div className={`brief-verbatim ${handoffMode ? 'text-base' : 'text-sm'} mt-1 sm:mt-0`}>
              ← &ldquo;{item.verbatim}&rdquo;
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BriefView({ brief, rawTranscript, error, onDone }: BriefViewProps) {
  const [handoffMode, setHandoffMode] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const sections: Array<{
    key: keyof Omit<NurseBrief, 'language_detected' | 'not_asked_about'>;
    label: string;
    items: BriefItem[];
  }> = brief
    ? [
        { key: 'chief_complaint', label: SECTION_LABELS.chief_complaint, items: brief.chief_complaint },
        { key: 'onset_duration', label: SECTION_LABELS.onset_duration, items: brief.onset_duration },
        { key: 'context_exposures', label: SECTION_LABELS.context_exposures, items: brief.context_exposures },
        { key: 'patient_concerns', label: SECTION_LABELS["patient_concerns"], items: brief.patient_concerns },
      ]
    : [];

  const generatedAt = new Date().toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Nairobi',
  });

  // Fallback: API failure — show raw transcript
  if (!brief && rawTranscript) {
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-8 max-w-2xl mx-auto">
        <div className="card border-amber-200 mb-4">
          <p className="font-bold text-amber-800 mb-2">⚠ Summary could not be generated</p>
          <p className="text-gray-700 text-sm">{error}</p>
        </div>
        <div className="card">
          <p className="section-label">Patient&apos;s raw input (for nurse)</p>
          <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">{rawTranscript}</p>
        </div>
        <div className="mt-4">
          <button onClick={onDone} className="btn-primary">
            Done — Start New Session / Maliza
          </button>
        </div>
      </div>
    );
  }

  // Handoff mode — full-screen large print for nurse
  if (handoffMode && brief) {
    return (
      <div className="min-h-screen bg-white px-6 py-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-900">
          <div>
            <h1 className="text-2xl font-black text-gray-900">KAZI INTAKE BRIEF</h1>
            <p className="text-base text-gray-600 mt-1">
              Language: <strong>{brief.language_detected}</strong> · Generated {generatedAt} EAT
            </p>
          </div>
          <div className="text-right">
            <span className="inline-block bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full">
              AI-ASSISTED · NOT ASSESSED
            </span>
          </div>
        </div>

        {/* Sections */}
        {sections.map((s) => (
          <BriefSection key={s.key} title={s.label} items={s.items} handoffMode={true} />
        ))}

        {/* Not asked about — F-08: always rendered, including on complete briefs.
            A complete brief that hides this section looks like a finished clinical record.
            Even when empty, the section heading signals to the nurse that the list was checked. */}
        <div className="mb-6 bg-gray-50 rounded-xl p-4">
          <p className="section-label">Not Asked About</p>
          {brief.not_asked_about.length > 0 ? (
            <>
              <p className="text-gray-600 text-base">
                {brief.not_asked_about.join(' · ')}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Absence of data here does not mean absence of symptoms. The nurse should ask
                about these directly if clinically relevant.
              </p>
            </>
          ) : (
            <p className="text-gray-500 text-base">
              All four areas were covered in this session.
            </p>
          )}
        </div>

        {/* Footer — on every brief including handoff */}
        <div className="border-t-2 border-gray-200 pt-4 mt-6">
          <p className="text-sm text-gray-500 leading-relaxed">
            <strong>This sheet contains only what the patient volunteered</strong>, translated
            into standard terms. It is not an assessment. It rules nothing in and nothing out.
            Items marked <strong>UNCLEAR</strong> were not understood and were deliberately not
            guessed. Review the verbatim column to audit the translation.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Kazi: Kabla ya Daktari — hackathon prototype — not clinically validated
          </p>
        </div>

        {/* Done button */}
        <div className="mt-8">
          <button
            onClick={onDone}
            className="btn-primary"
          >
            Done — Purge &amp; Start New Session / Maliza
          </button>
        </div>
      </div>
    );
  }

  // Patient confirmation view
  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8 max-w-2xl mx-auto">
      {/* Step header */}
      <div className="mb-6">
        {!confirmed ? (
          <>
            <h2 className="text-2xl font-bold text-gray-900">
              Is this what you want to show the nurse?
            </h2>
            <p className="text-gray-500 mt-1">
              Je, hii ndiyo unayotaka kumwonyesha muuguzi?
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-900">
              Ready for the nurse
            </h2>
            <p className="text-gray-500 mt-1">
              Iko tayari kwa muuguzi.
            </p>
          </>
        )}
      </div>

      {/* Brief preview */}
      <div className="card mb-6">
        {/* Language badge */}
        {brief && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-gray-400">
              Language: <strong className="text-gray-600">{brief.language_detected}</strong>
            </span>
            <span className="text-xs text-gray-400">Generated {generatedAt} EAT</span>
          </div>
        )}

        {/* Sections */}
        {sections.map((s) => (
          <BriefSection key={s.key} title={s.label} items={s.items} handoffMode={false} />
        ))}

        {/* Not asked about — F-08: always rendered, including complete briefs. */}
        {brief && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="section-label">Not Asked About</p>
            {brief.not_asked_about.length > 0 ? (
              <p className="text-sm text-gray-500">
                {brief.not_asked_about.join(' · ')}
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                All four areas were covered in this session.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 leading-relaxed">
            This sheet contains only what you volunteered, translated into standard terms.
            It is not an assessment. Items marked UNCLEAR were not guessed.
          </p>
        </div>
      </div>

      {/* Confirmation actions */}
      {!confirmed ? (
        <div className="space-y-3">
          <button
            onClick={() => setConfirmed(true)}
            className="btn-primary"
          >
            Yes, show the nurse this summary
            <span className="text-blue-200 text-sm font-normal">/ Ndio, mwonyeshe muuguzi</span>
          </button>
          <button
            onClick={onDone}
            className="btn-secondary"
          >
            No, start over / Hapana, anza upya
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => setHandoffMode(true)}
            className="btn-primary text-xl py-6"
          >
            Show nurse — large screen view
            <span className="text-blue-200 text-sm font-normal">/ Mwonyeshe muuguzi →</span>
          </button>
          <button onClick={onDone} className="btn-secondary">
            Done — Start New Session / Maliza
          </button>
        </div>
      )}
    </div>
  );
}
