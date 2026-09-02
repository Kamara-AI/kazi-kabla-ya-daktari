/**
 * POST /api/brief
 *
 * Stateless proxy to the Anthropic Messages API.
 * Holds the API key server-side only.
 *
 * Privacy guarantees:
 *  - No database client imported (absence of the dependency is the proof)
 *  - No request/response logging
 *  - No disk writes
 *  - temperature: 0 for translation fidelity, not creativity
 *
 * Input:  { transcript: string }  — the patient's concatenated input across all four buckets
 * Output: NurseBrief              — the tool call input from Claude (§9.1 of spec)
 * Errors: { error: string }       — never expose raw API errors to the patient
 */

import { KAZI_SYSTEM_PROMPT } from '@/lib/prompt';
import { EMIT_NURSE_BRIEF_TOOL } from '@/lib/schema';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Configuration error — should never reach production without the key set
    return Response.json({ error: 'CONFIGURATION_ERROR' }, { status: 500 });
  }

  let transcript: string;
  try {
    const body = await req.json();
    transcript = body?.transcript;
  } catch {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  // L-1: input length cap — prevents context-window overflow and API cost abuse
  const MAX_TRANSCRIPT_CHARS = 4000;
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    return Response.json({ error: 'EMPTY_INPUT' }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return Response.json({ error: 'INPUT_TOO_LONG' }, { status: 400 });
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,                   // server-side only — never reaches the client
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',             // fastest current model; latency target < 4s p50
      max_tokens: 1500,
      temperature: 0,                        // translation fidelity, not creativity
      system: KAZI_SYSTEM_PROMPT,
      tools: [EMIT_NURSE_BRIEF_TOOL],
      tool_choice: { type: 'tool', name: 'emit_nurse_brief' },
      messages: [{ role: 'user', content: transcript }],
    }),
  });

  if (!anthropicRes.ok) {
    // Do not expose raw API errors to the patient
    return Response.json({ error: 'API_ERROR' }, { status: 502 });
  }

  const data = await anthropicRes.json();
  const toolBlock = data.content?.find(
    (b: { type: string }) => b.type === 'tool_use',
  );

  if (!toolBlock) {
    return Response.json({ error: 'NO_BRIEF' }, { status: 502 });
  }

  // M-1: Runtime field-presence validation before forwarding to client.
  // TypeScript types are compile-time only; enforce the required shape at runtime.
  const input = toolBlock.input as Record<string, unknown>;
  const requiredArrays = [
    'chief_complaint',
    'onset_duration',
    'context_exposures',
    'patient_concerns',
    'not_asked_about',
  ];
  const missing = requiredArrays.filter((k) => !Array.isArray(input[k]));
  if (missing.length > 0) {
    return Response.json({ error: 'MALFORMED_BRIEF' }, { status: 502 });
  }

  // Nothing logged, nothing stored — return the tool call input directly
  return Response.json(input);
}
