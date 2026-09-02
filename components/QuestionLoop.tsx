'use client';

/**
 * The adaptive conversation loop — step 2 of the intake flow.
 *
 * One question on screen at a time; the exchanges so far stay visible above
 * so the patient can see what has been written down about them.
 *
 * Tone banners surface safety flags and sijui states inline without requiring
 * a separate screen — the patient can still answer and continue.
 */

import { AnswerInput } from './AnswerInput';
import type { Message } from '@/lib/conversationTypes';

export type Tone = 'normal' | 'sijui' | 'urgent' | 'emergency';

interface BannerConfig {
  label: string;
  labelSw: string;
  classes: string;
}

const BANNERS: Record<Exclude<Tone, 'normal'>, BannerConfig> = {
  emergency: {
    label: 'Do not wait in the queue — please tell the staff at the desk now.',
    labelSw: 'Usibaki foleni — tafadhali mwambie mfanyakazi wa dawati sasa.',
    classes:
      'rounded-xl bg-red-100 border-2 border-red-400 text-red-900 px-4 py-3 font-semibold',
  },
  urgent: {
    label: 'You should be seen today — let staff know as soon as possible.',
    labelSw: 'Unapaswa kuonwa leo — arifu wafanyakazi mapema iwezekanavyo.',
    classes:
      'rounded-xl bg-amber-100 border-2 border-amber-400 text-amber-900 px-4 py-3 font-semibold',
  },
  sijui: {
    label: "I'm not sure about that — the nurse will be able to help.",
    labelSw: 'Sijui kuhusu hilo — muuguzi ataweza kukusaidia.',
    classes:
      'rounded-xl bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3',
  },
};

export function QuestionLoop({
  log,
  question,
  tone,
  options,
  busy,
  answered,
  onAnswer,
  onDangerSign,
  onFinish,
  voiceDraft,
}: {
  /** Full conversation history, alternating user / assistant. */
  log: Message[];
  /** The current question text to display prominently. */
  question: string;
  /** Controls which safety/status banner to show. */
  tone: Tone;
  /** MCQ options from the model, or empty for free-text. */
  options: string[];
  /** True while an API call is in-flight. */
  busy: boolean;
  /** Number of questions answered so far (for the step counter). */
  answered: number;
  onAnswer: (text: string) => void;
  onDangerSign: (type: 'RED' | 'AMBER') => void;
  onFinish: () => void;
  /** Voice transcript to pre-fill AnswerInput for patient review before submit. */
  voiceDraft?: string;
}) {
  const banner = tone === 'normal' ? null : BANNERS[tone];

  return (
    <section className="flex flex-col gap-6">
      {/* Step counter */}
      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
        Question {answered + 1} of ~4–6
      </p>

      {/* Conversation log — patient right, assistant left */}
      {log.length > 0 && (
        <div className="flex flex-col gap-3">
          {log.map((entry, index) => (
            <div
              key={index}
              className={
                entry.role === 'user'
                  ? 'flex justify-end'
                  : 'flex justify-start'
              }
            >
              <p
                className={
                  entry.role === 'user'
                    ? 'max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-700 text-white px-4 py-3 text-base'
                    : 'max-w-[80%] rounded-2xl rounded-tl-sm bg-white border border-gray-200 text-gray-900 px-4 py-3 text-base'
                }
              >
                {entry.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Safety / status banner */}
      {banner && (
        <div className={banner.classes} role="alert">
          <p>{banner.label}</p>
          <p className="mt-1 text-sm opacity-80">{banner.labelSw}</p>
        </div>
      )}

      {/* Current question — prominent heading */}
      <h2 className="text-xl font-semibold text-gray-900 leading-snug">
        {question}
      </h2>

      {/* Answer input */}
      <AnswerInput options={options} onAnswer={onAnswer} onDangerSign={onDangerSign} busy={busy} voiceDraft={voiceDraft} />

      {/* "Generate summary" escape hatch */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onFinish}
          className="text-base text-blue-700 font-medium underline underline-offset-4
                     min-h-[44px] px-2
                     hover:text-blue-900
                     focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 rounded
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Generate My Summary / Tengeneza Muhtasari
        </button>
      </div>

      {/* Reassurance footnote */}
      <p className="text-sm text-gray-500 leading-relaxed">
        You can stop and generate your summary at any point. Anything you have
        not been asked about will be listed as still unclear for the nurse.
      </p>
    </section>
  );
}
