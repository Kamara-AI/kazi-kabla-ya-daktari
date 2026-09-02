'use client';

/**
 * Root page — application state machine.
 *
 * States:
 *   consent    → blocking consent gate (F-01)
 *   welcome    → "what brings you in today?" single-question seed screen
 *   asking     → adaptive multi-turn conversation loop (F-02, F-03)
 *   reviewing  → patient reviews accumulated summary before confirming (F-04)
 *   handoff    → nurse handoff card with PDF / copy / nearby providers (F-05–F-10)
 *   emergency  → RED screen — medical danger sign detected (F-03)
 *   selfharm   → AMBER screen — self-harm disclosure detected (§7.1)
 *
 * All session state lives here. On purge: state resets to consent, history
 * replaced, timers cleared. No browser storage used at any point (S-02).
 *
 * Inactivity auto-purge: 90s warning banner, 120s full wipe (S-03).
 *
 * Multi-turn conversation flow:
 *   1. Patient states chief complaint (welcome screen)
 *   2. /api/turn drives adaptive Q&A via Claude Haiku (asking state)
 *   3. Structured fields accumulate client-side via accumulate.ts
 *   4. Patient reviews and can remove items (reviewing state)
 *   5. Nurse handoff card generated purely from accumulated fields (handoff state)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import ConsentModal from '@/components/ConsentModal';
import EmergencyScreen from '@/components/EmergencyScreen';
import SelfHarmScreen from '@/components/SelfHarmScreen';
import { QuestionLoop } from '@/components/QuestionLoop';
import type { Tone } from '@/components/QuestionLoop';
import { SummaryReview } from '@/components/SummaryReview';
import VoiceInput from '@/components/VoiceInput';
import HealthProviderFinder from '@/components/HealthProviderFinder';

import { checkDangerSigns } from '@/lib/interceptor';
import { applyTurn, removeReported, removeBelief } from '@/lib/accumulate';
import { buildSummary, summaryToText } from '@/lib/conversationSummary';
import { parseTurn, InvalidTurnError } from '@/lib/conversationValidate';
import { downloadBrief } from '@/lib/pdf';
import {
  EMPTY_ACCUMULATED,
  type ClaudeTurn,
  type Message,
  type Accumulated,
} from '@/lib/conversationTypes';

type AppState =
  | 'consent'
  | 'welcome'
  | 'asking'
  | 'reviewing'
  | 'handoff'
  | 'emergency'
  | 'selfharm';

const INACTIVITY_WARN_MS = 90_000;
const INACTIVITY_WIPE_MS = 120_000;

export default function Home() {
  const [appState, setAppState] = useState<AppState>('consent');

  // Conversation state — all in-memory, never persisted
  const [messages, setMessages] = useState<Message[]>([]);
  const [accumulated, setAccumulated] = useState<Accumulated>(EMPTY_ACCUMULATED);
  const [currentTurn, setCurrentTurn] = useState<ClaudeTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(0);

  // Handoff screen state
  const [copied, setCopied] = useState(false);
  const [showProviders, setShowProviders] = useState(false); // BUG-09: toggled on handoff

  // Welcome screen state
  const [welcomeText, setWelcomeText] = useState('');

  // Voice draft — holds a confirmed voice transcript for AnswerInput pre-fill
  // during the asking state. Cleared on submit and on purge.
  const [voiceDraft, setVoiceDraft] = useState('');

  // Inactivity banner
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Session purge — called on Done, inactivity wipe, and back-button intercept.
  // ---------------------------------------------------------------------------
  const purge = useCallback(() => {
    setMessages([]);
    setAccumulated(EMPTY_ACCUMULATED);
    setCurrentTurn(null);
    setBusy(false);
    setAnswered(0);
    setCopied(false);
    setShowProviders(false);
    setWelcomeText('');
    setVoiceDraft('');
    setShowInactivityWarning(false);

    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);

    // Replace history so back button cannot recover prior session content (F-09)
    window.history.replaceState(null, '', window.location.pathname);
    setAppState('consent');
  }, []);

  // ---------------------------------------------------------------------------
  // Inactivity timers — reset on any user interaction during active sessions.
  // ---------------------------------------------------------------------------
  const resetInactivityTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);
    setShowInactivityWarning(false);

    warnTimerRef.current = setTimeout(
      () => setShowInactivityWarning(true),
      INACTIVITY_WARN_MS,
    );
    wipeTimerRef.current = setTimeout(() => purge(), INACTIVITY_WIPE_MS);
  }, [purge]);

  useEffect(() => {
    // BUG-06: emergency and selfharm screens must not auto-purge — a nurse
    // reading the handoff card mid-handoff should never have it disappear.
    if (appState === 'consent' || appState === 'emergency' || appState === 'selfharm') return;

    resetInactivityTimers();

    const events = ['keydown', 'touchstart', 'click', 'mousemove'] as const;
    events.forEach((e) =>
      document.addEventListener(e, resetInactivityTimers, { passive: true }),
    );

    return () => {
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);
      events.forEach((e) =>
        document.removeEventListener(e, resetInactivityTimers),
      );
    };
  }, [appState, resetInactivityTimers]);

  // Block back-button from recovering a completed session (F-09)
  useEffect(() => {
    const blockingStates: AppState[] = [
      'reviewing',
      'handoff',
      'emergency',
      'selfharm',
    ];
    if (!blockingStates.includes(appState)) return;

    window.history.pushState(null, '', window.location.pathname);
    const handlePop = () =>
      window.history.pushState(null, '', window.location.pathname);
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [appState]);

  // ---------------------------------------------------------------------------
  // Danger sign routing (F-03 / §7)
  // ---------------------------------------------------------------------------
  const handleEmergency = useCallback((type: 'RED' | 'AMBER') => {
    setBusy(false);
    setAppState(type === 'RED' ? 'emergency' : 'selfharm');
  }, []);

  // ---------------------------------------------------------------------------
  // Core API call — POST /api/turn, validate response, return parsed turn.
  // Returns null on network or validation error; the caller decides how to recover.
  // ---------------------------------------------------------------------------
  const callTurn = useCallback(
    async (
      msgs: Message[],
      force_summary = false,
    ): Promise<ClaudeTurn | null> => {
      setBusy(true);
      try {
        const res = await fetch('/api/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: msgs, force_summary }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;

        const data = await res.json();
        return parseTurn(data.turn);
      } catch {
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Welcome screen submission — seeds the conversation with the chief complaint.
  // ---------------------------------------------------------------------------
  const handleWelcomeSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;

      const danger = checkDangerSigns(text);
      if (danger !== 'CLEAR') {
        handleEmergency(danger);
        return;
      }

      const userMsg: Message = { role: 'user', content: text.trim() };
      const msgs: Message[] = [userMsg];

      setMessages(msgs);
      setAppState('asking'); // show loading (currentTurn is still null)

      const turn = await callTurn(msgs);
      if (!turn) {
        // Network failure on first turn — go back so the patient can retry.
        setAppState('welcome');
        return;
      }

      // Run interceptor on model output — danger signs can surface in translation.
      const msgDanger = checkDangerSigns(turn.message);
      if (msgDanger !== 'CLEAR') {
        handleEmergency(msgDanger);
        return;
      }

      const newAccumulated = applyTurn(EMPTY_ACCUMULATED, turn);
      setAccumulated(newAccumulated);
      setCurrentTurn(turn);

      if (turn.next_action === 'generate_summary') {
        setAppState('reviewing');
      }
      // Otherwise stay in 'asking' — currentTurn is now set, QuestionLoop renders.
    },
    [busy, callTurn, handleEmergency],
  );

  // ---------------------------------------------------------------------------
  // Question loop answer handler — called by QuestionLoop and VoiceInput.
  // ---------------------------------------------------------------------------
  const handleAnswer = useCallback(
    async (answer: string) => {
      if (!answer.trim() || busy || !currentTurn) return;

      // Clear the voice draft so the next question starts with an empty textarea.
      setVoiceDraft('');

      const danger = checkDangerSigns(answer);
      if (danger !== 'CLEAR') {
        handleEmergency(danger);
        return;
      }

      // Append the model's current question as an assistant message, then the
      // patient's answer as a user message, before calling the API.
      const assistantMsg: Message = {
        role: 'assistant',
        content: currentTurn.message,
      };
      const userMsg: Message = { role: 'user', content: answer.trim() };
      const newMsgs: Message[] = [...messages, assistantMsg, userMsg];

      setMessages(newMsgs);
      setAnswered((n) => n + 1);

      const turn = await callTurn(newMsgs);
      if (!turn) return; // Network error — keep current question visible for retry.

      const msgDanger = checkDangerSigns(turn.message);
      if (msgDanger !== 'CLEAR') {
        handleEmergency(msgDanger);
        return;
      }

      const newAccumulated = applyTurn(accumulated, turn);
      setAccumulated(newAccumulated);
      setCurrentTurn(turn);

      if (turn.next_action === 'generate_summary') {
        setAppState('reviewing');
      }
      // Otherwise currentTurn updated → QuestionLoop re-renders with next question.
    },
    [busy, currentTurn, messages, accumulated, callTurn, handleEmergency],
  );

  // ---------------------------------------------------------------------------
  // "Generate my summary" escape hatch — force the model to summarise now.
  // BUG-01: only navigate to reviewing on success; stay in asking on failure.
  // ---------------------------------------------------------------------------
  const handleFinishEarly = useCallback(async () => {
    if (busy) return;
    const turn = await callTurn(messages, true);
    if (!turn) return; // network error — stay in asking, patient can retry
    setAccumulated(applyTurn(accumulated, turn));
    setAppState('reviewing');
  }, [busy, messages, accumulated, callTurn]);

  // ---------------------------------------------------------------------------
  // "Add or correct something" — patient goes back from reviewing to asking.
  //
  // BUG-02: do NOT reuse the stale generate_summary currentTurn. Clear it and
  // get a fresh question so the model does not immediately bounce back to
  // generate_summary. The messages array does not include the generate_summary
  // assistant message (it was never appended), so the model sees the last user
  // answer and asks a natural follow-up.
  // ---------------------------------------------------------------------------
  const handleEditRequest = useCallback(async () => {
    setCurrentTurn(null);
    setVoiceDraft('');
    setAppState('asking'); // shows loading spinner (currentTurn === null)
    const turn = await callTurn(messages);
    if (!turn) return; // network error — stay in asking with spinner
    if (turn.next_action === 'generate_summary') {
      // Model still wants to wrap up — apply any new data and go back to reviewing.
      setAccumulated(applyTurn(accumulated, turn));
      setAppState('reviewing');
      return;
    }
    const msgDanger = checkDangerSigns(turn.message);
    if (msgDanger !== 'CLEAR') {
      handleEmergency(msgDanger);
      return;
    }
    setCurrentTurn(turn);
  }, [messages, accumulated, callTurn, handleEmergency]);

  // ---------------------------------------------------------------------------
  // Handoff screen — PDF download and copy-to-clipboard
  // ---------------------------------------------------------------------------
  const summary = useMemo(() => buildSummary(accumulated), [accumulated]);

  const handleDownloadPdf = useCallback(() => {
    const text = summaryToText(summary);
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', '-')
      .replace(':', '-');
    downloadBrief(text, stamp);
  }, [summary]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryToText(summary));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [summary]);

  // ---------------------------------------------------------------------------
  // QuestionLoop tone — derived from the current turn's safety / action state.
  // ---------------------------------------------------------------------------
  const tone = useMemo((): Tone => {
    if (!currentTurn) return 'normal';
    if (currentTurn.safety_flag === 'emergency') return 'emergency';
    if (currentTurn.safety_flag === 'urgent') return 'urgent';
    if (currentTurn.next_action === 'sijui') return 'sijui';
    return 'normal';
  }, [currentTurn]);

  // The conversation log shown in QuestionLoop — full history so the patient
  // can see everything that has been recorded about them.
  const conversationLog = useMemo(() => messages, [messages]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen">
      {/* Inactivity warning banner */}
      {showInactivityWarning && appState !== 'consent' && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 bg-yellow-400 text-yellow-900
                     text-center py-3 px-4 flex items-center justify-center gap-4"
        >
          <span className="font-semibold text-base">
            Session will clear in 30 seconds due to inactivity.
          </span>
          <button
            onClick={resetInactivityTimers}
            className="bg-yellow-900 text-yellow-100 font-bold px-4 py-2 rounded-lg
                       text-sm min-h-[44px] hover:bg-yellow-800"
          >
            Continue / Endelea
          </button>
        </div>
      )}

      {/* ── consent ── */}
      {appState === 'consent' && (
        <ConsentModal onConsent={() => setAppState('welcome')} />
      )}

      {/* ── welcome ── */}
      {appState === 'welcome' && (
        <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
              Step 1 of 4
            </p>
            <h1 className="text-2xl font-bold text-gray-900 leading-snug">
              What brings you in today?
              <span className="block text-lg font-normal text-gray-500 mt-1">
                Ni nini kimeleta leo?
              </span>
            </h1>
          </div>

          <p className="text-base text-gray-600 leading-relaxed">
            Describe your main problem in your own words — Swahili, English, or
            Sheng is fine. The nurse will see what you write.
          </p>

          <textarea
            className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3
                       text-base text-gray-900 placeholder-gray-400 leading-relaxed
                       focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100
                       resize-none transition-colors"
            rows={5}
            maxLength={1000}
            placeholder="e.g. Nimekuwa na maumivu ya kichwa kwa siku tatu…"
            value={welcomeText}
            onChange={(e) => setWelcomeText(e.target.value)}
            aria-label="Describe your main problem"
            disabled={busy}
          />

          {/* Character counter near limit */}
          {welcomeText.length >= 900 && (
            <p className="text-sm text-orange-600 text-right -mt-4">
              {1000 - welcomeText.length} characters remaining
            </p>
          )}

          {/* Voice input — renders only if Web Speech API is available */}
          <VoiceInput
            onTranscript={(text) => setWelcomeText(text)}
            onDangerSign={handleEmergency}
            disabled={busy}
          />

          <button
            type="button"
            disabled={busy || !welcomeText.trim()}
            onClick={() => handleWelcomeSubmit(welcomeText)}
            className="btn-primary min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Please wait… / Subiri…' : 'Continue / Endelea →'}
          </button>
        </div>
      )}

      {/* ── asking — loading (currentTurn not yet received) ── */}
      {appState === 'asking' && !currentTurn && (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center px-8">
            <div
              className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600
                         mx-auto mb-6"
              aria-label="Loading"
            />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              One moment…
            </h2>
            <p className="text-gray-500 text-lg">Subiri kidogo…</p>
          </div>
        </div>
      )}

      {/* ── asking — conversation loop ── */}
      {appState === 'asking' && currentTurn && (
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
          <QuestionLoop
            log={conversationLog}
            question={currentTurn.message}
            tone={tone}
            options={currentTurn.answer_options}
            busy={busy}
            answered={answered}
            onAnswer={handleAnswer}
            onFinish={handleFinishEarly}
            voiceDraft={voiceDraft}
          />
          {/* Voice input rendered below the text answer area.
              onTranscript pre-fills AnswerInput so the patient can review/edit
              before pressing Send — it does NOT auto-submit. */}
          <VoiceInput
            onTranscript={setVoiceDraft}
            onDangerSign={handleEmergency}
            disabled={busy}
          />
        </div>
      )}

      {/* ── reviewing ── */}
      {appState === 'reviewing' && (
        <div className="max-w-3xl mx-auto px-4 py-8">
          <SummaryReview
            accumulated={accumulated}
            onRemoveReported={(i) =>
              setAccumulated(removeReported(accumulated, i))
            }
            onRemoveBelief={(i) =>
              setAccumulated(removeBelief(accumulated, i))
            }
            onEdit={handleEditRequest}
            onConfirm={() => setAppState('handoff')}
            busy={busy}
          />
        </div>
      )}

      {/* ── handoff ── */}
      {appState === 'handoff' && (
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-8">
          {/* Header */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
              Step 4 of 4
            </p>
            <h2 className="text-2xl font-bold text-gray-900 leading-snug">
              Show this to the nurse
              <span className="block text-lg font-normal text-gray-500 mt-1">
                Onyesha hii kwa muuguzi
              </span>
            </h2>
          </div>

          {/* Labels */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800
                             text-xs font-semibold px-3 py-1">
              AI-assisted summary
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700
                             text-xs font-semibold px-3 py-1">
              No diagnosis was generated
            </span>
            {summary.safety !== 'none' && (
              <span
                className={
                  summary.safety === 'emergency'
                    ? 'inline-flex items-center rounded-full bg-red-100 text-red-800 text-xs font-semibold px-3 py-1'
                    : 'inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-3 py-1'
                }
              >
                {summary.safety === 'emergency'
                  ? 'Immediate attention'
                  : 'Seen today'}
              </span>
            )}
          </div>

          {/* Safety alert */}
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

          {/* Summary card */}
          <div className="card flex flex-col gap-5">
            {summary.sections.map((section) => (
              <div key={section.key}>
                <h3 className="section-label">
                  {section.title}
                  {section.titleSw && (
                    <span className="normal-case font-normal ml-1 text-gray-400">
                      / {section.titleSw}
                    </span>
                  )}
                </h3>
                {section.note && (
                  <p className="text-sm text-gray-500 italic mb-2">
                    {section.note}
                  </p>
                )}
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => (
                    <li
                      key={`${item.source.kind}-${item.source.index}`}
                      className="text-base text-gray-900 leading-relaxed"
                    >
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="btn-secondary min-h-[44px]"
            >
              Download PDF / Pakua PDF
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="btn-secondary min-h-[44px]"
            >
              {copied ? 'Copied! / Imenakiliwa!' : 'Copy summary text / Nakili maandishi'}
            </button>
            <button
              type="button"
              onClick={purge}
              className="btn-primary min-h-[44px]"
            >
              Done / Mwisho
            </button>
          </div>

          {/* Nearby health providers — BUG-09: toggle so Close actually works */}
          {!showProviders ? (
            <button
              type="button"
              onClick={() => setShowProviders(true)}
              className="btn-secondary min-h-[44px]"
            >
              Find nearby clinics / Tafuta kliniki za karibu
            </button>
          ) : (
            <HealthProviderFinder onClose={() => setShowProviders(false)} />
          )}

          {/* Disclaimer */}
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            The PDF is the same summary, built on this device. Nothing is
            uploaded, and it is not a permanent medical record.
            <br />
            PDF ni muhtasari huo huo, uliojengwa kwenye kifaa hiki. Hakuna
            kinachopakiwa, na si rekodi ya kudumu ya matibabu.
          </p>
        </div>
      )}

      {/* ── emergency / selfharm ── */}
      {appState === 'emergency' && <EmergencyScreen onBack={purge} />}
      {appState === 'selfharm' && <SelfHarmScreen onBack={purge} />}
    </main>
  );
}
