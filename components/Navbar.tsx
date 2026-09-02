'use client';

/**
 * Navbar — persistent top bar for all screens.
 *
 * Contains:
 * - App name ("Kazi") on the left, with a bilingual tagline below it.
 * - EN / SW pill toggle buttons on the right.
 *
 * The tagline and aria labels switch with the active language so the bar
 * itself is a live demonstration of the language switcher's effect.
 *
 * Touch targets: all buttons are min 44×44 px per WCAG 2.5.5.
 * Background: bg-slate-900 (dark navy) with white text.
 */

import { useLang } from '@/lib/languageContext';
import type { Lang } from '@/lib/languageContext';

const TAGLINES: Record<Lang, string> = {
  en: 'Describe your symptoms before seeing the nurse',
  sw: 'Elezea dalili zako kabla ya kuona muuguzi',
};

export default function Navbar() {
  const { lang, setLang } = useLang();

  return (
    <nav
      className="w-full bg-slate-900 text-white px-4 py-3 flex items-center justify-between"
      style={{ minHeight: '64px' }}
      aria-label="Application navigation"
    >
      {/* Left: app name + tagline */}
      <div className="flex flex-col justify-center">
        <span className="font-bold text-xl leading-tight">Wingu la Dalili</span>
        <span className="text-slate-300 text-sm leading-snug mt-0.5">
          {TAGLINES[lang]}
        </span>
      </div>

      {/* Right: language toggle pills */}
      <div className="flex items-center gap-2" role="group" aria-label="Language switcher">
        {(['en', 'sw'] as Lang[]).map((l) => {
          const isActive = lang === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={isActive}
              aria-label={l === 'en' ? 'Switch to English' : 'Badilisha lugha kwa Kiswahili'}
              className={[
                'font-semibold text-sm rounded-full px-4 uppercase tracking-wide',
                'min-h-[44px] min-w-[44px]',
                'transition-colors duration-150',
                isActive
                  ? 'bg-white text-slate-900'
                  : 'bg-transparent text-white border border-white hover:bg-slate-700',
              ].join(' ')}
            >
              {l.toUpperCase()}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
