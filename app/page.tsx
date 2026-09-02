'use client';

/**
 * Root page — application state machine.
 *
 * States:
 *   consent    → blocking consent gate (F-01)
 *   intake     → guided four-bucket intake form (F-02, F-03)
 *   loading    → API call in progress
 *   brief      → patient confirmation + nurse handoff (F-05–F-10)
 *   emergency  → RED screen — medical danger sign detected (F-03)
 *   selfharm   → AMBER screen — self-harm disclosure detected (§7.1)
 *
 * All session state lives here. On purge: state = null, history replaced,
 * inactivity timers cleared. No browser storage used at any point.
 *
 * Inactivity auto-purge: 90s warning banner, 120s full wipe (S-03).
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import ConsentModal from '@/components/ConsentModal';
import IntakeForm from '@/components/IntakeForm';
import BriefView from '@/components/BriefView';
import EmergencyScreen from '@/components/EmergencyScreen';
import SelfHarmScreen from '@/components/SelfHarmScreen';

import { checkDangerSigns, checkBriefForDangerSigns } from '@/lib/interceptor';
import type { NurseBrief } from '@/lib/schema';

type AppState = 'consent' | 'intake' | 'loading' | 'brief' | 'emergency' | 'selfharm';

const INACTIVITY_WARN_MS = 90_000;   // 90 seconds
const INACTIVITY_WIPE_MS = 120_000;  // 120 seconds

export default function Home() {
  const [appState, setAppState] = useState<AppState>('consent');
  const [brief, setBrief] = useState<NurseBrief | null>(null);
  const [rawTranscript, setRawTranscript] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * purge — clears all session state and returns to consent gate.
   * Called on: Done button, inactivity wipe, back-button interception.
   * Replaces the history entry so the back button cannot recover the session (F-09).
   */
  const purge = useCallback(() => {
    setBrief(null);
    setRawTranscript('');
    setApiError(null);
    setShowInactivityWarning(false);

    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);

    // Replace history so back button cannot recover prior session content
    window.history.replaceState(null, '', window.location.pathname);
    setAppState('consent');
  }, []);

  /**
   * Inactivity timer management.
   * Resets on any user interaction when in an active session.
   */
  const resetInactivityTimers = useCallback(() => {
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);
    setShowInactivityWarning(false);

    warnTimerRef.current = setTimeout(() => {
      setShowInactivityWarning(true);
    }, INACTIVITY_WARN_MS);

    wipeTimerRef.current = setTimeout(() => {
      purge();
    }, INACTIVITY_WIPE_MS);
  }, [purge]);

  // Wire inactivity timers to user interaction during active sessions
  useEffect(() => {
    if (appState === 'consent' || appState === 'loading') return;

    resetInactivityTimers();

    const events = ['keydown', 'touchstart', 'click', 'mousemove'] as const;
    events.forEach((e) => document.addEventListener(e, resetInactivityTimers, { passive: true }));

    return () => {
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      if (wipeTimerRef.current) clearTimeout(wipeTimerRef.current);
      events.forEach((e) => document.removeEventListener(e, resetInactivityTimers));
    };
  }, [appState, resetInactivityTimers]);

  // Block back-button from recovering a completed session
  useEffect(() => {
    if (appState === 'brief' || appState === 'emergency' || appState === 'selfharm') {
      window.history.pushState(null, '', window.location.pathname);
      const handlePop = () => {
        window.history.pushState(null, '', window.location.pathname);
      };
      window.addEventListener('popstate', handlePop);
      return () => window.removeEventListener('popstate', handlePop);
    }
  }, [appState]);

  const handleConsent = useCallback(() => {
    setAppState('intake');
  }, []);

  const handleEmergency = useCallback((type: 'RED' | 'AMBER') => {
    setAppState(type === 'RED' ? 'emergency' : 'selfharm');
  }, []);

  const handleGenerate = useCallback(
    async (transcript: string) => {
      setRawTranscript(transcript);
      setApiError(null);
      setAppState('loading');

      try {
        const res = await fetch('/api/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transcript }),
          signal: AbortSignal.timeout(15_000), // 15s timeout — fail fast
        });

        if (!res.ok) {
          throw new Error(`API responded ${res.status}`);
        }

        const data: NurseBrief = await res.json();

        // Run interceptor a final time on the structured output (§7.2)
        // Catches danger signs that only surfaced after translation.
        // Uses static import (M-2) and accepts unknown directly (M-3 — no cast needed).
        const postCheck = checkBriefForDangerSigns(data);
        if (postCheck !== 'CLEAR') {
          handleEmergency(postCheck);
          return;
        }

        setBrief(data);
        setAppState('brief');
      } catch {
        // S-04: Graceful API failure — show raw verbatim to nurse. Never nothing.
        // L-3: Do not log the raw error object — sanitised fixed string only.
        // On a shared clinic tablet, DevTools console is readable by the next patient.
        setApiError(
          'Unable to generate summary. Showing your raw input for the nurse instead.',
        );
        setBrief(null);
        setAppState('brief');
      }
    },
    [handleEmergency],
  );

  return (
    <main className="min-h-screen">
      {/* Inactivity warning banner */}
      {showInactivityWarning && appState !== 'consent' && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 bg-yellow-400 text-yellow-900 text-center
                     py-3 px-4 flex items-center justify-center gap-4"
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

      {/* State machine renders */}
      {appState === 'consent' && <ConsentModal onConsent={handleConsent} />}

      {appState === 'intake' && (
        <IntakeForm onEmergency={handleEmergency} onGenerate={handleGenerate} />
      )}

      {appState === 'loading' && (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center px-8">
            <div
              className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600
                         mx-auto mb-6"
              aria-label="Loading"
            />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Preparing your brief…
            </h2>
            <p className="text-gray-500 text-lg">Inaandaa muhtasari wako…</p>
            <p className="text-gray-400 text-sm mt-4">
              Usually takes 2–4 seconds / Kawaida inachukua sekunde 2–4
            </p>
          </div>
        </div>
      )}

      {appState === 'brief' && (
        <BriefView
          brief={brief}
          rawTranscript={rawTranscript}
          error={apiError}
          onDone={purge}
        />
      )}

      {appState === 'emergency' && <EmergencyScreen onBack={purge} />}

      {appState === 'selfharm' && <SelfHarmScreen onBack={purge} />}
    </main>
  );
}
