'use client';

/**
 * Summary review — steps 3 and 4 of the intake flow.
 *
 * The summary is rendered straight from the accumulated fields via buildSummary
 * and the patient can strike any single reported item or belief before
 * confirming. Removal is purely local — no model call required.
 *
 * "Still unclear" items (unknowns) cannot be removed: hiding a gap would make
 * the handoff look more complete than it is. The nurse must see what was not
 * covered.
 *
 * Touch targets: all interactive elements are min-h-[44px] per spec §4.4.
 * Bilingual labels: English first, Swahili in parentheses or secondary.
 */

import { buildSummary } from '@/lib/conversationSummary';
import type { Accumulated } from '@/lib/conversationTypes';

export function SummaryReview({
  accumulated,
  onRemoveReported,
  onRemoveBelief,
  onEdit,
  onConfirm,
  busy,
}: {
  accumulated: Accumulated;
  onRemoveReported: (index: number) => void;
  onRemoveBelief: (index: number) => void;
  /** Go back to the question loop to add or correct something. */
  onEdit: () => void;
  /** Proceed to the nurse handoff card. */
  onConfirm: () => void;
  busy: boolean;
}) {
  const summary = buildSummary(accumulated);

  return (
    <section className="flex flex-col gap-6">
      {/* Step label */}
      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
        Review your summary / Kagua muhtasari wako
      </p>

      <h2 className="text-xl font-semibold text-gray-900 leading-snug">
        Is this an accurate summary of what you want to tell the nurse?
        <span className="block text-base font-normal text-gray-500 mt-1">
          Hii ni muhtasari sahihi wa unachotaka kumwambia muuguzi?
        </span>
      </h2>

      <p className="text-base text-gray-600 leading-relaxed">
        This was put together from your answers only. Remove anything you would
        rather not pass on.
      </p>

      {/* Safety banner */}
      {summary.safety !== 'none' && (
        <div
          role="alert"
          className={
            summary.safety === 'emergency'
              ? 'rounded-xl bg-red-100 border-2 border-red-400 text-red-900 px-4 py-3 font-semibold'
              : 'rounded-xl bg-amber-100 border-2 border-amber-400 text-amber-900 px-4 py-3 font-semibold'
          }
        >
          {summary.safety === 'emergency'
            ? 'Flagged for immediate attention — please also tell the staff at the desk.'
            : 'Flagged to be seen today — let staff know when you hand this in.'}
        </div>
      )}

      {/* Empty state */}
      {summary.isEmpty && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-4 text-gray-600">
          Nothing has been recorded yet. Go back and add something before
          confirming.
        </div>
      )}

      {/* Summary card */}
      {!summary.isEmpty && (
        <div className="card flex flex-col gap-5">
          {summary.sections.map((section) => (
            <div key={section.key}>
              {/* Section title — English / Swahili */}
              <h3 className="section-label">
                {section.title}
                {section.titleSw && (
                  <span className="normal-case font-normal ml-1 text-gray-400">
                    / {section.titleSw}
                  </span>
                )}
              </h3>

              {/* Section note (for beliefs and unknowns) */}
              {section.note && (
                <p className="text-sm text-gray-500 italic mb-2">
                  {section.note}
                </p>
              )}

              {/* Items */}
              <ul className="flex flex-col gap-2">
                {section.items.map((item) => (
                  <li
                    key={`${item.source.kind}-${item.source.index}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="text-base text-gray-900 flex-1 leading-relaxed pt-1">
                      {item.text}
                    </span>

                    {/*
                     * "Still unclear" items cannot be removed.
                     * Hiding a gap would make the handoff look more complete
                     * than it is — the nurse must see what was not covered.
                     */}
                    {item.source.kind !== 'unknown' && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove: ${item.text}`}
                        onClick={() =>
                          item.source.kind === 'belief'
                            ? onRemoveBelief(item.source.index)
                            : onRemoveReported(item.source.index)
                        }
                        className="flex-shrink-0 rounded-lg border border-gray-200 bg-white
                                   text-sm text-gray-500 font-medium px-3 py-1 min-h-[44px]
                                   hover:bg-red-50 hover:border-red-300 hover:text-red-700
                                   focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   transition-colors"
                      >
                        Remove / Ondoa
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="btn-secondary min-h-[44px]"
        >
          Add or correct something / Ongeza au rekebisha kitu
        </button>

        <button
          type="button"
          disabled={busy || summary.isEmpty}
          onClick={onConfirm}
          className="btn-primary min-h-[44px]"
        >
          Confirm Summary / Thibitisha Muhtasari
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 text-center leading-relaxed">
        No diagnosis was generated. Not a permanent medical record.
        <br />
        Hakuna utambuzi wa ugonjwa uliozalishwa. Si rekodi ya kudumu ya matibabu.
      </p>
    </section>
  );
}
