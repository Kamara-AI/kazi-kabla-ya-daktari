'use client';

/**
 * Three ways to answer one question: tap an option, type freely, or say
 * you do not know. Options never replace the text box — a fixed list that
 * does not fit the patient's situation is exactly how detail gets lost.
 *
 * Touch targets: all interactive elements are min-h-[44px] per spec §4.4.
 */

import { useState } from 'react';

/** Max characters per message — mirrors the API route's per-message limit. */
export const MAX_MESSAGE_CHARS = 2000;

/** Constant so QuestionLoop can detect and label the "not sure" path. */
export const NOT_SURE_ANSWER = "I'm not sure / Sijui";

export function AnswerInput({
  options,
  onAnswer,
  busy,
}: {
  options: string[];
  onAnswer: (text: string) => void;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  const submit = (value: string): void => {
    setText('');
    onAnswer(value);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* MCQ option buttons — shown only when the model provides them */}
      {options.length > 0 && (
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => submit(option)}
              className="btn-secondary text-left justify-start min-h-[44px]"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Free-text input — always present so the patient can add nuance */}
      <textarea
        rows={3}
        maxLength={MAX_MESSAGE_CHARS}
        value={text}
        placeholder={
          options.length > 0
            ? 'Or answer in your own words…'
            : 'Type your answer here…'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && trimmed) {
            submit(trimmed);
          }
        }}
        className="w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3
                   text-base text-gray-900 placeholder-gray-400 resize-none
                   focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-500
                   min-h-[44px]"
      />

      {/* Action row: "not sure" on the left, Send on the right */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(NOT_SURE_ANSWER)}
          className="flex items-center justify-center rounded-xl border-2 border-gray-200
                     bg-white text-gray-600 font-medium text-base px-4 py-2 min-h-[44px]
                     hover:bg-gray-50 active:bg-gray-100
                     focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Not sure / Sijui
        </button>

        <button
          type="button"
          disabled={!trimmed || busy}
          onClick={() => submit(trimmed)}
          className="btn-primary flex-1 min-h-[44px]"
        >
          {busy ? 'Sending…' : 'Send / Tuma'}
        </button>
      </div>
    </div>
  );
}
