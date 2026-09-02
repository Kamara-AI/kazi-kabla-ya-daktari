/**
 * Client-side download of the nurse handoff brief.
 *
 * Approach: generate a properly structured PDF from scratch using the same
 * hand-rolled PDF serialiser strategy as the teammate's implementation in
 * kazi-ai/kabla-ya-daktari/frontend/src/pdf.ts — no npm dependencies, no
 * window.print() (unreliable on kiosk browsers with restricted print dialogs).
 *
 * The content string is already formatted by briefFormatter.ts; this module
 * only handles encoding it into a valid single-page PDF and triggering the
 * browser download.
 *
 * Why hand-rolled PDF: a nurse handoff brief is a single page of Latin-1 text.
 * Pulling in jsPDF or pdfmake for that is unjustifiable weight and a supply-
 * chain dependency we do not need.
 *
 * Character encoding: WinAnsiEncoding covers the full Latin-1 range that
 * Swahili and English text requires. Characters above U+00FF (rare in this
 * domain) become '?' — acceptable for a triage handoff sheet.
 */

// ---------------------------------------------------------------------------
// PDF constants
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4 points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FLOOR = 60; // minimum cursor y before forcing a new page
const LINE_HEIGHT = 14;
const FONT_SIZE = 10.5;
const TITLE_SIZE = 13;
const RULE_CHAR = '\u2501'; // ━  (box-drawing; mapped to nearest WinAnsi below)

// ---------------------------------------------------------------------------
// Character width estimation (Helvetica metrics, three-bucket approximation)
// ---------------------------------------------------------------------------

const NARROW_CHARS = new Set(" ijltfrI.,;:'`|!()[]{}/\\-".split(''));
const WIDE_CHARS = new Set('mwMWQ@%&'.split(''));

function textWidth(text: string, size: number): number {
  let ems = 0;
  for (const char of text) {
    ems += NARROW_CHARS.has(char) ? 0.3 : WIDE_CHARS.has(char) ? 0.86 : 0.56;
  }
  return ems * size;
}

/** Greedy word-wrap. A single word longer than the column may overhang. */
function wrapLine(text: string, size: number, indent: number): string[] {
  const usable = PAGE_WIDTH - MARGIN * 2 - indent;
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, size) > usable) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// ---------------------------------------------------------------------------
// WinAnsiEncoding table (characters above 0x7E that the standard covers)
// ---------------------------------------------------------------------------

const WINANSI: Record<string, number> = {
  '€': 128, '‚': 130, '„': 132, '…': 133, '†': 134, '‡': 135,
  '‰': 137, '‹': 139, 'Œ': 140, '\u2018': 145, '\u2019': 146,
  '\u201C': 147, '\u201D': 148, '•': 149, '–': 150, '—': 151,
  '™': 153, '›': 155, 'œ': 156,
};

/**
 * Escape a string for inclusion in a PDF literal string `(...)`.
 * Replaces characters outside WinAnsiEncoding with octal escapes or '?'.
 */
function escapePdfString(text: string): string {
  // Replace Unicode box-drawing ruler with a simple ASCII dashes run
  const normalised = text
    .replace(/[\u2500-\u257F]/g, '-')  // box-drawing → hyphen
    .replace(/←/g, '<-')
    .replace(/→/g, '->');

  let out = '';
  for (const char of normalised) {
    const code = WINANSI[char] ?? char.codePointAt(0) ?? 63;
    if (char === '(' || char === ')' || char === '\\') {
      out += `\\${char}`;
    } else if (code >= 32 && code <= 126) {
      out += char;
    } else if (code <= 255) {
      out += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      out += '?';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout: convert the pre-formatted text into positioned PDF operators
// ---------------------------------------------------------------------------

interface PdfLine {
  text: string;
  x: number;
  y: number;
  bold: boolean;
  size: number;
}

function layoutText(content: string): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let currentPage: PdfLine[] = [];
  let cursor = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    if (currentPage.length > 0) pages.push(currentPage);
    currentPage = [];
    cursor = PAGE_HEIGHT - MARGIN;
  };

  const addLine = (text: string, size: number, indent: number, bold: boolean, gap: number) => {
    cursor -= gap;
    if (cursor < FLOOR) newPage();
    cursor -= size + 2; // size + small leading padding

    const wrapped = wrapLine(text, size, indent);
    for (let i = 0; i < wrapped.length; i++) {
      if (i > 0) {
        cursor -= size + 2;
        if (cursor < FLOOR) newPage();
      }
      currentPage.push({
        text: wrapped[i],
        x: MARGIN + (i > 0 ? indent + 12 : indent),
        y: cursor,
        bold,
        size,
      });
    }
  };

  const rawLines = content.split('\n');

  for (const raw of rawLines) {
    const trimmed = raw.trimEnd();

    // Title line (all caps, leading text "KAZI INTAKE BRIEF")
    if (trimmed === 'KAZI INTAKE BRIEF') {
      addLine(trimmed, TITLE_SIZE, 0, true, 0);
      continue;
    }

    // Separator rule (line of ━ or -)
    if (/^[━\-─]{5,}/.test(trimmed)) {
      addLine('------------------------------------------------', FONT_SIZE, 0, false, 4);
      continue;
    }

    // Section headings (all caps, no leading whitespace, not the title)
    if (trimmed.length > 0 && trimmed === trimmed.toUpperCase() && !/^\s/.test(raw)) {
      addLine(trimmed, FONT_SIZE + 0.5, 0, true, 10);
      continue;
    }

    // Blank line — just advance cursor
    if (trimmed.length === 0) {
      cursor -= 6;
      continue;
    }

    // Indented content lines
    const leadingSpaces = raw.length - raw.trimStart().length;
    const indent = Math.min(leadingSpaces * 4, 36);
    addLine(trimmed, FONT_SIZE, indent, false, 2);
  }

  if (currentPage.length > 0) pages.push(currentPage);
  return pages;
}

// ---------------------------------------------------------------------------
// PDF serialisation
// ---------------------------------------------------------------------------

/**
 * Convert a single page's lines into a PDF content stream (BT/ET operators).
 */
function pageToStream(lines: PdfLine[]): string {
  const operators: string[] = [];
  for (const line of lines) {
    const font = line.bold ? 'F2' : 'F1';
    operators.push(
      `BT /${font} ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm ` +
        `(${escapePdfString(line.text)}) Tj ET`,
    );
  }
  return operators.join('\n');
}

/**
 * Build a complete, parseable PDF binary from the content streams.
 * Returns a Uint8Array of Latin-1 bytes (PDF 1.4 compatible).
 */
function buildPdfBytes(streams: string[]): Uint8Array<ArrayBuffer> {
  // Object layout:
  //   1: catalog
  //   2: pages
  //   3: regular font (Helvetica)
  //   4: bold font (Helvetica-Bold)
  //   5, 7, 9…: page objects
  //   6, 8, 10…: content stream objects

  const FIRST_PAGE_OBJ = 5;
  const objects: string[] = new Array(FIRST_PAGE_OBJ + streams.length * 2).fill('');
  const kids = streams.map((_, i) => `${FIRST_PAGE_OBJ + i * 2} 0 R`).join(' ');

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${streams.length} /Kids [${kids}] >>`;
  objects[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  streams.forEach((stream, i) => {
    const pageObj = FIRST_PAGE_OBJ + i * 2;
    const streamObj = pageObj + 1;
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
      `/Contents ${streamObj} 0 R >>`;
    objects[streamObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // Build body with cross-reference tracking
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let n = 1; n < objects.length; n++) {
    offsets[n] = body.length;
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // Convert to Latin-1 bytes.
  // new ArrayBuffer() produces Uint8Array<ArrayBuffer> (not ArrayBufferLike),
  // which satisfies the BlobPart constraint under strict TypeScript lib typings.
  const bytes = new Uint8Array(new ArrayBuffer(body.length));
  for (let i = 0; i < body.length; i++) {
    bytes[i] = body.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download the nurse handoff brief as a PDF file.
 *
 * @param content   Pre-formatted brief text from briefFormatter.ts
 * @param generatedAt  Timestamp string used for the filename (e.g. "2026-09-02T14-30")
 */
export function downloadBrief(content: string, generatedAt: string): void {
  // Sanitise the timestamp for use in a filename
  const safeStamp = generatedAt.replace(/[^0-9A-Za-z-]/g, '-').replace(/-{2,}/g, '-');
  const filename = `kazi-brief-${safeStamp}.pdf`;

  const pages = layoutText(content);
  // If content is empty, write one blank page so we don't emit a malformed PDF
  const streams = pages.length > 0
    ? pages.map(pageToStream)
    : [''];

  const bytes = buildPdfBytes(streams);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';

  // Append to body: detached anchors are silently ignored by Firefox and
  // some WebKit builds (same pattern as teammate's pdf.ts).
  document.body.append(link);
  link.click();
  link.remove();

  // Safari reads the blob after click returns — revoke after a safe delay
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
