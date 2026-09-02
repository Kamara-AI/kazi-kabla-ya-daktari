import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/lib/languageContext';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Wingu la Dalili',
  description:
    'Outpatient intake translator for Kenyan triage nurses. Not a diagnostic tool. Hackathon prototype.',
  // Prevent search engine indexing of a prototype health tool
  robots: 'noindex, nofollow',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sw">
      {/*
        lang="sw" (Swahili) as primary; the app is trilingual.
        Screen readers will use this for pronunciation guidance.
      */}
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {/* maximum-scale=1 prevents auto-zoom on input focus on iOS — important for one-handed use */}
      </head>
      <body>
        <LanguageProvider>
          <Navbar />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
