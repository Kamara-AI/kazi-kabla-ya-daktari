'use client';

/**
 * ConsentModal — blocking gate.
 *
 * Nothing behind this modal is reachable until the user explicitly
 * acknowledges. Reload returns here (parent state = 'consent').
 *
 * Per spec §2.4: AI transparency notice before any input field exists.
 * Discloses: AI is involved, what it does, what it does NOT do,
 * that it is not medical advice, and that symptom text is sent
 * to a model API for processing.
 *
 * Also names the one automated behaviour we have: the keyword
 * safety interceptor — rather than hiding it behind a "zero automation" claim.
 */

interface ConsentModalProps {
  onConsent: () => void;
}

export default function ConsentModal({ onConsent }: ConsentModalProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-950 px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-blue-700 px-8 py-6 text-white text-center">
          <p className="text-sm font-semibold uppercase tracking-widest opacity-80 mb-1">
            Kabla ya Kuanza · Before We Start
          </p>
          <h1 className="text-3xl font-bold">Kazi</h1>
          <p className="text-blue-200 text-base mt-1">Kabla ya Daktari</p>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-5 text-gray-800 text-base leading-relaxed">
          {/* What it is */}
          <div>
            <p className="font-semibold text-gray-900 mb-1">
              Msaidizi wa kujaza fomu · Form-filling assistant
            </p>
            <p>
              This assistant helps you describe your symptoms to the nurse in their
              standard format. It is <strong>not a doctor</strong> and cannot give
              medical advice or a diagnosis.
            </p>
            <p className="text-gray-600 mt-1 text-sm">
              Msaidizi huyu anakusaidia kuelezea dalili zako kwa muuguzi.
              Hana uwezo wa kugundua ugonjwa wako.
            </p>
          </div>

          {/* What it does NOT do */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="font-semibold text-gray-900 mb-2">This assistant will NEVER:</p>
            <ul className="space-y-1 text-sm text-gray-700">
              <li>✗ Tell you what illness you have</li>
              <li>✗ Recommend medicine, tests, or treatment</li>
              <li>✗ Ask for your name, ID, or phone number</li>
              <li>✗ Save or share your information</li>
            </ul>
          </div>

          {/* Data handling */}
          <div>
            <p className="font-semibold text-gray-900 mb-1">Your data / Data yako</p>
            <p className="text-sm text-gray-700">
              No name, ID, or phone number is collected. What you type is sent to
              an AI model to prepare your summary. It is not saved anywhere — not
              here, not on your device, not anywhere.
            </p>
          </div>

          {/* The one automated behaviour */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="font-semibold text-amber-900 text-sm mb-1">
              One automated safety check
            </p>
            <p className="text-sm text-amber-800">
              As you type, an automated check watches for emergency warning signs.
              If it finds one, it stops the form and tells you to go to the nurse
              immediately. This is the only automated decision this app makes.
            </p>
          </div>

          {/* Not medical advice */}
          <p className="text-xs text-gray-500 text-center">
            This is a hackathon prototype. Not clinically validated.
            Not for use with real patients in a production setting.
          </p>
        </div>

        {/* CTA */}
        <div className="px-8 pb-8">
          <button
            onClick={onConsent}
            className="btn-primary"
            aria-label="I understand and want to continue"
          >
            I Understand — Continue
            <span className="text-blue-200 text-sm font-normal">/ Naelewa — Endelea</span>
          </button>
        </div>
      </div>
    </div>
  );
}
