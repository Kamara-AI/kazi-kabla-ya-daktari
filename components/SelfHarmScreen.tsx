'use client';

/**
 * SelfHarmScreen — AMBER alert.
 *
 * Shown when the danger-sign interceptor detects a self-harm or suicidal
 * ideation keyword.
 *
 * Per spec §7.1: distinct screen, distinct tone from RED.
 * - Calm, not alarming
 * - No red background, no capitals
 * - Stops intake immediately
 * - Does NOT attempt to counsel
 * - Does NOT offer coping advice
 * - Hands to a human immediately
 * - Includes a verified national helpline number
 *
 * H-2 FIX: href, aria-label, and displayed number must all match.
 * Using Befrienders Kenya: 0722 178 177 as the displayed/dialled number.
 * Verify this number is still in service before going live.
 */

interface SelfHarmScreenProps {
  onBack: () => void;
}

export default function SelfHarmScreen({ onBack }: SelfHarmScreenProps) {
  return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center px-6 py-12 text-gray-900 text-center">
      {/* Icon — calm, not alarming */}
      <div className="text-6xl mb-6" aria-hidden="true">🤝</div>

      {/* Primary message — warm, plain */}
      <div className="max-w-sm w-full space-y-6">
        <div className="card border-amber-200">
          <p className="text-2xl font-semibold text-gray-800 leading-snug mb-3">
            Thank you for telling us this.
          </p>
          <p className="text-lg text-gray-600 mb-4">
            Asante kwa kutuambia hili.
          </p>
          <p className="text-lg text-gray-800 font-medium">
            Please speak to the nurse at the desk now.{' '}
            <span className="text-amber-700">Someone is there for you.</span>
          </p>
          <p className="text-base text-gray-600 mt-2">
            Tafadhali ongea na muuguzi sasa. Kuna mtu anayekungoja.
          </p>
        </div>

        {/* Helpline */}
        <div className="card border-amber-300 bg-amber-50">
          <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Kenya Mental Health Helpline
          </p>
          {/* H-2: href, aria-label, and displayed number are now identical. */}
          <a
            href="tel:0722178177"
            className="text-3xl font-black text-amber-800 block mb-1"
            aria-label="Call Befrienders Kenya: 0722 178 177"
          >
            0722 178 177
          </a>
          <p className="text-sm text-gray-500">
            Befrienders Kenya · Free call · Simu bila malipo
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Verify this number is in service before going live with real patients.
          </p>
        </div>

        {/* Show nurse instruction */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-base text-gray-700">
            You do not need to finish this form.{' '}
            Show this screen to the nurse if it helps.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Huhitaji kumalizia fomu hii. Onyesha skrini hii kwa muuguzi ukitaka.
          </p>
        </div>

        {/* Dismissal — small, nurse use */}
        <button
          onClick={onBack}
          className="text-gray-400 underline text-sm min-h-[44px] px-6 py-3 block w-full"
          aria-label="Start a new session (nurse use only)"
        >
          Start new session (nurse use only)
        </button>
      </div>
    </div>
  );
}
