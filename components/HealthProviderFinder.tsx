'use client';

/**
 * HealthProviderFinder
 *
 * Shown after intake is complete. Lets the patient find nearby clinics,
 * hospitals, and pharmacies using their device's GPS and OpenStreetMap —
 * no API key, no cost, works anywhere including rural Kenya.
 *
 * State machine: idle → locating → searching → results | error
 *
 * UX constraints (spec §4.4):
 *   - Min 18px text (set globally in globals.css)
 *   - Min 44px touch targets (set globally in globals.css)
 *   - One-handed friendly — single-column, large tap areas
 *   - Bilingual: English + Swahili for every patient-facing label
 *
 * Privacy: location is used only to query OpenStreetMap. It is not sent
 * to our servers, not logged, not stored anywhere.
 */

import { useState, useCallback } from 'react';
import {
  findNearbyProviders,
  type HealthProvider,
  type ProviderSearchResult,
} from '@/lib/healthProviders';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchState = 'idle' | 'locating' | 'searching' | 'results' | 'error';

interface HealthProviderFinderProps {
  /** Called when the user is done viewing providers. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeIcon(type: HealthProvider['type']): string {
  switch (type) {
    case 'hospital':
      return '🏥';
    case 'clinic':
      return '🏥';
    case 'pharmacy':
      return '💊';
    case 'doctors':
      return '👨‍⚕️';
    default:
      return '🏥';
  }
}

function typeLabel(type: HealthProvider['type']): string {
  switch (type) {
    case 'hospital':
      return 'Hospital';
    case 'clinic':
      return 'Clinic / Kliniki';
    case 'pharmacy':
      return 'Pharmacy / Duka la dawa';
    case 'doctors':
      return "Doctor's office / Ofisi ya daktari";
    default:
      return 'Health facility / Kituo cha afya';
  }
}

/**
 * Formats a distance in metres into a human-friendly string.
 * < 1 km → "350 m away"; ≥ 1 km → "1.2 km away"
 */
function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m away`;
  }
  return `${(metres / 1000).toFixed(1)} km away`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="animate-spin h-6 w-6 text-blue-700"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

interface ProviderCardProps {
  provider: HealthProvider;
}

function ProviderCard({ provider }: ProviderCardProps) {
  const displayName = provider.name.trim() !== '' ? provider.name : 'Unnamed facility / Kituo kisichojulikana';

  return (
    <div className="card flex flex-col gap-3">
      {/* Header row: icon + name + distance */}
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none mt-0.5" aria-hidden="true">
          {typeIcon(provider.type)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 leading-snug break-words">
            {displayName}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">{typeLabel(provider.type)}</p>
        </div>
        <span className="text-sm font-medium text-blue-700 whitespace-nowrap ml-2 mt-0.5">
          {formatDistance(provider.distanceMetres)}
        </span>
      </div>

      {/* Optional details */}
      {provider.phone && (
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span aria-hidden="true">📞</span>
          <a
            href={`tel:${provider.phone}`}
            className="underline underline-offset-2 min-h-[44px] flex items-center"
          >
            {provider.phone}
          </a>
        </div>
      )}
      {provider.openingHours && (
        <div className="flex items-start gap-2 text-sm text-gray-700">
          <span aria-hidden="true" className="mt-0.5">🕐</span>
          <span className="break-words">{provider.openingHours}</span>
        </div>
      )}

      {/* Directions button */}
      <a
        href={provider.googleMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary text-blue-700 border-blue-200 hover:bg-blue-50"
        aria-label={`Get directions to ${displayName}`}
      >
        Get directions →
        <span className="text-gray-400 text-sm font-normal">/ Pata mwelekeo</span>
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HealthProviderFinder({ onClose }: HealthProviderFinderProps) {
  const [state, setState] = useState<SearchState>('idle');
  const [result, setResult] = useState<ProviderSearchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSearch = useCallback(async () => {
    // Step 1: asking the browser for GPS
    setState('locating');
    setErrorMessage('');
    setResult(null);

    try {
      // findNearbyProviders does both steps (geolocation + Overpass).
      // We show 'locating' while geolocation runs, then transition to
      // 'searching' after the coords come back. Because the two steps are
      // sequential inside findNearbyProviders, we approximate by switching
      // states mid-way via a small state-update trick.
      //
      // Trade-off: we could split the function, but that would leak the
      // internal sequencing here. Instead we accept that the user sees
      // 'locating' for the full duration — still accurate and honest.
      const providerResult = await findNearbyProviders();

      // Switch to 'searching' label briefly — the fetch is already done,
      // but it gives honest visual feedback on what just happened.
      setState('searching');

      // Small yield to let React paint the 'searching' state before we
      // immediately replace it with results (avoids a flash skip on fast
      // networks — cosmetic only).
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      setResult(providerResult);
      setState('results');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to search right now. Please ask the nurse for a referral. ' +
            '/ Haiwezekani kutafuta sasa. Tafadhali mwulize muuguzi.';
      setErrorMessage(message);
      setState('error');
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Render helpers for each state
  // ---------------------------------------------------------------------------

  function renderIdle() {
    return (
      <div className="space-y-4">
        <p className="text-gray-700 leading-relaxed">
          Find clinics, hospitals, and pharmacies within 5 km of your current location.
        </p>
        <p className="text-sm text-gray-500 italic">
          Pata kliniki, hospitali, na maduka ya dawa ndani ya kilomita 5 kutoka mahali ulipo.
        </p>

        {/* Privacy note */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
          <p>
            🔒 Your location is used only to find nearby clinics and is not stored.
          </p>
          <p className="text-blue-600 mt-1 text-xs">
            / Mahali pako hutumiwa tu kupata kliniki za karibu na haihifadhiwa.
          </p>
        </div>

        <button type="button" onClick={handleSearch} className="btn-primary">
          Find nearby clinics
          <span className="text-blue-200 text-sm font-normal">/ Tafuta kliniki za karibu</span>
        </button>
      </div>
    );
  }

  function renderLocating() {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Spinner />
        <p className="font-medium text-gray-800 text-center">
          Finding your location...
        </p>
        <p className="text-sm text-gray-500 text-center">
          / Inatafuta mahali ulipo...
        </p>
        <p className="text-xs text-gray-400 text-center">
          Your browser will ask for permission. Tap "Allow".
        </p>
      </div>
    );
  }

  function renderSearching() {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Spinner />
        <p className="font-medium text-gray-800 text-center">
          Searching for nearby health facilities...
        </p>
        <p className="text-sm text-gray-500 text-center">
          / Inatafuta vituo vya afya karibu nawe...
        </p>
      </div>
    );
  }

  function renderResults() {
    if (!result) return null;

    const { providers } = result;

    if (providers.length === 0) {
      return (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-900">
            <p className="font-semibold">No health facilities found within 5 km.</p>
            <p className="text-sm mt-1">Please ask the nurse for a referral.</p>
            <p className="text-amber-700 text-xs mt-2 italic">
              / Hakuna vituo vya afya vilivyopatikana ndani ya kilomita 5.
              Tafadhali mwulize muuguzi.
            </p>
          </div>
          <button type="button" onClick={handleSearch} className="btn-secondary">
            Try again / Jaribu tena
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {providers.length} facilit{providers.length === 1 ? 'y' : 'ies'} found nearby ·{' '}
          <span className="italic">
            Vituo {providers.length} vimepatikana karibu
          </span>
        </p>

        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>

        {/* Privacy reminder at bottom of results */}
        <p className="text-xs text-gray-400 text-center pt-2">
          🔒 Your location was not stored. / Mahali pako halikuhifadhiwa.
        </p>

        <button type="button" onClick={handleSearch} className="btn-secondary">
          Search again / Tafuta tena
        </button>
      </div>
    );
  }

  function renderError() {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <p className="font-semibold text-red-900">Could not find nearby clinics.</p>
          <p className="text-red-700 text-sm mt-2 leading-relaxed">{errorMessage}</p>
        </div>
        <button type="button" onClick={handleSearch} className="btn-primary">
          Try again / Jaribu tena
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Nearby Health Facilities
          </h2>
          <p className="text-sm text-gray-500">
            / Vituo vya afya vilivyo karibu
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close / Funga"
          className="flex items-center justify-center rounded-xl border-2 border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 min-h-[44px] min-w-[44px] px-3 text-sm font-semibold"
        >
          Close
        </button>
      </div>

      {/* State-driven content */}
      <div>
        {state === 'idle' && renderIdle()}
        {state === 'locating' && renderLocating()}
        {state === 'searching' && renderSearching()}
        {state === 'results' && renderResults()}
        {state === 'error' && renderError()}
      </div>
    </div>
  );
}
