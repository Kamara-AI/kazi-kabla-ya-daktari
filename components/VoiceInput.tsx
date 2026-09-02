'use client';

/**
 * VoiceInput — microphone-based transcript capture for the intake flow.
 *
 * Why Web Speech API: zero dependencies, runs entirely on-device for supported
 * browsers (Chrome, Edge, Samsung Internet — the dominant browsers on Android
 * kiosks in Kenyan clinics). Progressive enhancement: if the API is absent we
 * render nothing and the caller falls back to the text textarea.
 *
 * Locale priority: sw-KE → en-KE → en.
 * Swahili Kenya first because most patients in outpatient queues will use it.
 * Fallback to English ensures the component still works on browsers that have
 * the API but not the Swahili model installed.
 *
 * Safety: checkDangerSigns runs on every interim result. If RED or AMBER is
 * detected, recognition stops immediately and onDangerSign fires. We do NOT
 * wait for the patient to confirm — a missed emergency is far worse than an
 * interrupted recording.
 *
 * State machine: idle → listening → reviewing → idle
 *
 * The patient MUST see and can correct the final transcript before it is
 * accepted. onTranscript is called only on explicit confirmation.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { checkDangerSigns, type InterceptorResult } from '@/lib/interceptor';

// ---------------------------------------------------------------------------
// Type augmentation — the Web Speech API is not in all TypeScript DOM libs.
// We declare only what we use so there is no `any` leak.
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VoiceInputProps {
  onTranscript: (text: string) => void;
  onDangerSign: (type: 'RED' | 'AMBER') => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type VoiceState = 'idle' | 'listening' | 'reviewing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALES = ['sw-KE', 'en-KE', 'en'] as const;

/**
 * Resolve the SpeechRecognition constructor across vendor prefixes.
 * Returns null if neither variant is present (non-supporting browser).
 */
function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w['SpeechRecognition'] === 'function') {
    return w['SpeechRecognition'] as SpeechRecognitionConstructor;
  }
  if (typeof w['webkitSpeechRecognition'] === 'function') {
    return w['webkitSpeechRecognition'] as SpeechRecognitionConstructor;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VoiceInput({ onTranscript, onDangerSign, disabled = false }: VoiceInputProps) {
  // Progressive enhancement gate — evaluated once on mount
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Track current locale index for fallback
  const localeIndexRef = useRef(0);
  // Accumulate final segments across recognition events
  const accumulatedRef = useRef('');

  // Check support after mount (SSR-safe)
  useEffect(() => {
    setIsSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Core recognition logic
  // -------------------------------------------------------------------------

  const buildRecognition = useCallback(
    (localeIndex: number): SpeechRecognitionInstance | null => {
      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (!SpeechRecognition) return null;

      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = LOCALES[localeIndex] ?? 'en';
      return rec;
    },
    [],
  );

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent auto-transition
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    try {
      setErrorMessage('');
      setInterim('');
      setFinalTranscript('');
      accumulatedRef.current = '';
      localeIndexRef.current = 0;

      const rec = buildRecognition(0);
      if (!rec) {
        setIsSupported(false);
        return;
      }

      rec.onstart = () => {
        setVoiceState('listening');
      };

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let interimText = '';
        let finalText = accumulatedRef.current;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalText += (finalText ? ' ' : '') + transcript.trim();
          } else {
            interimText += transcript;
          }
        }

        accumulatedRef.current = finalText;
        setInterim(interimText);

        // Run danger check on combined text — catch emergencies mid-sentence
        const textToCheck = finalText + (interimText ? ' ' + interimText : '');
        const danger: InterceptorResult = checkDangerSigns(textToCheck);
        if (danger === 'RED' || danger === 'AMBER') {
          stopRecognition();
          setVoiceState('idle');
          onDangerSign(danger);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        // 'no-speech' is not a real error — just silence; let onend handle it
        if (event.error === 'no-speech') return;

        // language-not-supported: try next locale in fallback chain
        if (event.error === 'language-not-supported' || event.error === 'network') {
          const next = localeIndexRef.current + 1;
          if (next < LOCALES.length) {
            localeIndexRef.current = next;
            stopRecognition();
            // Brief timeout lets the browser release the mic before reopening
            setTimeout(() => startListening(), 150);
            return;
          }
        }

        stopRecognition();
        setVoiceState('idle');
        const friendly =
          event.error === 'not-allowed'
            ? 'Microphone access denied. Please allow microphone access in your browser settings. / Ruhusa ya maikrofoni imekataliwa.'
            : `Could not start recording (${event.error}). Please try typing instead. / Haikuwezekana kurekodi. Jaribu kuandika.`;
        setErrorMessage(friendly);
        // BUG-05: do NOT call onTranscript('') here — in the welcome state it
        // would silently clear whatever the patient had already typed.
      };

      rec.onend = () => {
        // Recognition ended (could be silence timeout, or we called stop())
        const finalText = accumulatedRef.current;
        setInterim('');

        if (finalText.trim()) {
          setFinalTranscript(finalText.trim());
          setVoiceState('reviewing');
        } else {
          // Nothing captured; stay idle and show a gentle nudge
          setVoiceState('idle');
          setErrorMessage(
            "We didn't catch anything. Try speaking closer to the microphone. / Hatukusikia chochote. Jaribu kusema karibu na maikrofoni.",
          );
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (err) {
      // Wrap the entire block — permissions prompt rejection throws synchronously in some browsers
      setVoiceState('idle');
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(
        `Could not start voice input: ${message}. Please try typing instead. / Haikuwezekana kuanza sauti.`,
      );
      onTranscript('');
    }
  }, [buildRecognition, stopRecognition, onDangerSign, onTranscript]);

  const handleMicClick = useCallback(() => {
    if (disabled) return;
    if (voiceState === 'listening') {
      // Manual stop — commit whatever we have
      stopRecognition();
      const finalText = accumulatedRef.current;
      setInterim('');
      if (finalText.trim()) {
        setFinalTranscript(finalText.trim());
        setVoiceState('reviewing');
      } else {
        setVoiceState('idle');
      }
      return;
    }
    startListening();
  }, [disabled, voiceState, stopRecognition, startListening]);

  const handleConfirm = useCallback(() => {
    const text = finalTranscript.trim();
    if (!text) return;

    // Final danger check on confirmed text before handing off
    const danger: InterceptorResult = checkDangerSigns(text);
    if (danger === 'RED' || danger === 'AMBER') {
      onDangerSign(danger);
      return;
    }

    onTranscript(text);
    setVoiceState('idle');
    setFinalTranscript('');
    setErrorMessage('');
  }, [finalTranscript, onTranscript, onDangerSign]);

  const handleReset = useCallback(() => {
    stopRecognition();
    setVoiceState('idle');
    setFinalTranscript('');
    setInterim('');
    setErrorMessage('');
    accumulatedRef.current = '';
  }, [stopRecognition]);

  // -------------------------------------------------------------------------
  // Render guard — only show after we know support status
  // -------------------------------------------------------------------------

  // null = not yet checked (SSR / first paint)
  if (isSupported === null) return null;
  // API absent — caller handles fallback
  if (isSupported === false) return null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isListening = voiceState === 'listening';
  const isReviewing = voiceState === 'reviewing';

  return (
    <div className="flex flex-col gap-4" role="region" aria-label="Voice input / Sauti">
      {/* Microphone trigger */}
      {!isReviewing && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleMicClick}
            disabled={disabled}
            aria-label={
              isListening
                ? 'Stop recording / Acha kurekodi'
                : 'Start voice input / Anza kurekodi sauti'
            }
            aria-pressed={isListening}
            className={[
              // 56px minimum as per spec §4.4 — larger for pain-impaired patients
              'relative flex items-center justify-center rounded-full',
              'w-16 h-16 min-w-[56px] min-h-[56px]',
              'font-semibold text-white shadow-md',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-all duration-150',
              isListening
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900',
            ].join(' ')}
          >
            {/* Pulse ring — only while listening */}
            {isListening && (
              <span
                className="absolute inset-0 rounded-full bg-red-500 opacity-60 animate-ping"
                aria-hidden="true"
              />
            )}
            {/* Mic icon (inline SVG — no icon library dependency) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-7 h-7 relative z-10"
              aria-hidden="true"
            >
              {isListening ? (
                // Square stop icon while recording
                <rect x="6" y="6" width="12" height="12" rx="1" />
              ) : (
                // Microphone icon at rest
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-7 10a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2h3v-2.07A7 7 0 0 1 5 11z" />
              )}
            </svg>
          </button>

          {/* State label */}
          <p className="text-sm font-medium text-gray-600 text-center" aria-live="polite">
            {isListening
              ? 'Listening… / Sikiza…'
              : 'Tap to speak / Bonyeza kuongea'}
          </p>

          {/* Live interim transcript */}
          {isListening && interim && (
            <p
              className="text-sm italic text-gray-400 text-center max-w-sm px-4"
              aria-live="polite"
              aria-label="Live transcript"
            >
              {interim}
            </p>
          )}
        </div>
      )}

      {/* Review stage — editable textarea + confirm/reset */}
      {isReviewing && (
        <div className="card flex flex-col gap-4">
          <div>
            <p className="section-label">Check what we heard / Angalia tulichosikia</p>
            <p className="text-sm text-gray-500 mb-3">
              You can edit before confirming. / Unaweza kuhariri kabla ya kuthibitisha.
            </p>
            <textarea
              value={finalTranscript}
              onChange={(e) => setFinalTranscript(e.target.value)}
              aria-label="Transcript — edit if needed / Maneno — hariri ikihitajika"
              rows={5}
              className="w-full resize-none rounded-xl border border-gray-300 bg-gray-50
                         text-gray-900 text-lg leading-relaxed p-4
                         focus:outline-none focus:ring-4 focus:ring-blue-400
                         min-h-[120px]"
            />
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!finalTranscript.trim()}
            className="btn-primary"
          >
            Use this
            <span className="text-blue-200 text-sm font-normal">/ Tumia hii</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="btn-secondary"
          >
            Try again
            <span className="text-gray-400 text-sm font-normal">/ Jaribu tena</span>
          </button>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3
                     text-sm text-amber-800 leading-relaxed"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
