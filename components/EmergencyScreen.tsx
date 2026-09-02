'use client';

/**
 * EmergencyScreen — RED alert.
 *
 * Shown when the danger-sign interceptor detects a medical emergency keyword.
 * Per spec §7.1: full red screen, largest type, unambiguous.
 *
 * Design constraints:
 * - Comprehensible at a glance (spec §4.4)
 * - Works for a person in pain or frightened (spec §4.4)
 * - Does NOT continue the intake form
 * - Does NOT call the API
 * - Does NOT attempt to assess severity or advise
 */

interface EmergencyScreenProps {
  /** Returns to the consent gate and purges all state. */
  onBack: () => void;
}

export default function EmergencyScreen({ onBack }: EmergencyScreenProps) {
  return (
    <div className="min-h-screen bg-red-600 flex flex-col items-center justify-center px-6 py-12 text-white text-center">
      {/* Icon */}
      <div className="text-8xl mb-6" aria-hidden="true">🚨</div>

      {/* Primary message — largest type, unambiguous */}
      <h1 className="text-4xl font-black leading-tight mb-4 max-w-sm">
        STOP.<br />
        Go to the nurse NOW.
      </h1>

      {/* Swahili */}
      <p className="text-2xl font-bold mb-8 text-red-100 max-w-sm leading-snug">
        Simama.<br />
        Nenda kwa muuguzi SASA.
      </p>

      {/* Show-this-screen instruction */}
      <div className="bg-white text-red-700 rounded-2xl p-6 max-w-sm w-full mb-8">
        <p className="font-bold text-xl mb-2">Show this screen to the nurse.</p>
        <p className="text-base text-red-600">
          Onyesha skrini hii kwa muuguzi.
        </p>
        <p className="text-sm text-red-500 mt-3">
          Do not finish this form. Your symptoms need to be checked by a person right now.
        </p>
        <p className="text-xs text-red-400 mt-1">
          Usimalize fomu hii. Dalili zako zinahitaji kukaguliwa na mtu sasa hivi.
        </p>
      </div>

      {/* Dismissal — small and secondary, nurse uses it after they've seen the patient */}
      <button
        onClick={onBack}
        className="text-red-200 underline text-base mt-4 min-h-[44px] px-6 py-3"
        aria-label="Start a new session (nurse use only)"
      >
        Start new session (nurse use only)
      </button>
    </div>
  );
}
