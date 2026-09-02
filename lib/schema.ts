/**
 * Output schema for the emit_nurse_brief tool.
 *
 * Why forced tool call: there is no field in this object that can hold a
 * diagnosis, a probability, or a triage priority. Even a prompt-injected or
 * misbehaving model has nowhere to put one. This is a stronger safety argument
 * than "we told it not to" — you can hand a judge the schema.
 */

export interface BriefItem {
  /** The patient's exact words, in the original language. */
  verbatim: string;
  /**
   * Standard intake term traceable to the patient's words.
   * null when confidence is 'sijui' — never guessed.
   */
  standardised: string | null;
  confidence: 'clear' | 'uncertain' | 'sijui';
}

export interface NurseBrief {
  language_detected: string;
  chief_complaint: BriefItem[];
  onset_duration: BriefItem[];
  context_exposures: BriefItem[];
  patient_concerns: BriefItem[];
  /**
   * Buckets with no information gathered.
   * The nurse must NOT read silence as a negative finding.
   */
  not_asked_about: string[];
}

export const EMIT_NURSE_BRIEF_TOOL = {
  name: 'emit_nurse_brief',
  description:
    "Emit the structured intake brief. Every standardised term must be traceable to the patient's own words.",
  input_schema: {
    type: 'object' as const,
    properties: {
      language_detected: {
        type: 'string',
        description: 'Language(s) detected in the patient input, e.g. "Swahili", "Sheng/English mixed".',
      },
      chief_complaint: {
        type: 'array',
        items: { $ref: '#/$defs/item' },
      },
      onset_duration: {
        type: 'array',
        items: { $ref: '#/$defs/item' },
      },
      context_exposures: {
        type: 'array',
        items: { $ref: '#/$defs/item' },
      },
      patient_concerns: {
        type: 'array',
        items: { $ref: '#/$defs/item' },
      },
      not_asked_about: {
        type: 'array',
        items: { type: 'string' },
        description:
          'List bucket names (chief_complaint, onset_duration, context_exposures, patient_concerns) for which no information was gathered. The nurse must not read silence as a negative finding.',
      },
    },
    required: [
      'language_detected',
      'chief_complaint',
      'onset_duration',
      'context_exposures',
      'patient_concerns',
      'not_asked_about',
    ],
    $defs: {
      item: {
        type: 'object',
        properties: {
          verbatim: {
            type: 'string',
            description: "The patient's exact words, original language.",
          },
          standardised: {
            type: ['string', 'null'],
            description:
              "Standard intake term traceable to patient's words. null if confidence is 'sijui'.",
          },
          confidence: {
            enum: ['clear', 'uncertain', 'sijui'],
            description:
              "'sijui' = ambiguous or unfamiliar — preserve verbatim, set standardised to null, do NOT guess.",
          },
        },
        required: ['verbatim', 'standardised', 'confidence'],
      },
    },
  },
};
