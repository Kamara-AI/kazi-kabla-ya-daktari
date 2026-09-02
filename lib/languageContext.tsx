'use client';

/**
 * languageContext.tsx — global language state for Kazi: Kabla ya Daktari.
 *
 * Stores the active UI language ('en' | 'sw') in React state and exposes it
 * via context so any client component can read or toggle the language without
 * prop-drilling. Defaults to English ('en') — the nurse-facing summary output
 * is always bilingual regardless of this setting.
 */

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type Lang = 'en' | 'sw';

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * LanguageProvider — wraps the app shell in layout.tsx.
 * All children can call useLang() to read or update the active language.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * useLang — returns { lang, setLang }.
 * Throws if called outside a LanguageProvider tree — this is intentional:
 * a missing provider is a programming error, not a runtime condition to handle.
 */
export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx === null) {
    throw new Error('useLang must be used inside a <LanguageProvider>');
  }
  return ctx;
}
