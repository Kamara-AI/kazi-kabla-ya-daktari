/**
 * Client-side danger-sign interceptor.
 *
 * Why: Safety net must never depend on the model or the network.
 * If the API is down, the interceptor still works.
 *
 * Design intent: tuned wide — false positives cost a nurse ten seconds
 * (confirming a patient is not having a heart attack); false negatives
 * cost something we are not willing to trade for elegance.
 *
 * NOT clinically validated. Hackathon starting point only.
 * Must be reviewed and signed off by a qualified clinician before any
 * use with real patients.
 */

export type InterceptorResult = 'RED' | 'AMBER' | 'CLEAR';

/** Normalise text before matching: lowercase, strip diacritics, collapse whitespace. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// RED — medical emergency patterns (English / Swahili / Sheng)
// Each pattern should match on word boundaries where possible.
// ---------------------------------------------------------------------------
const RED_PATTERNS: RegExp[] = [
  // Cardiac / chest
  /chest\s*(pain|tight|tightness|crush|pressure|ache|heaviness)/,
  /maumivu\s*(ya\s*)?kifua/,
  /kifua\s*(kinauma|kinabana|inabana|pain|ni\s*nzito)/,
  /roho\s*inaenda\s*mbio/,
  /heart\s*attack/,
  /moyo\s*(unauma|inaumia|unabana)/,
  /pain\s*in\s*(my\s*)?(chest|heart)/,

  // Breathing
  /can'?t\s*(breathe?|breath)/,
  /difficulty\s*(breath|breathing)/,
  /shortness\s*of\s*breath/,
  /short\s*of\s*breath/,
  /\bgasping\b/,
  /\bkushindwa\s*kupumua/,
  /kupumua\s*kwa\s*shida/,
  /\bsipati\s*hewa\b/,
  /\bnashindwa\s*kupumua/,
  /pumzi\s*(fupi|ngumu|shida)/,
  /hewa\s*haitoshi/,
  /sinaweza\s*kupumua/,

  // Neurological — stroke signs
  /sudden\s*(weakness|paralysis|numbness|confusion)/,
  /face\s*droop(ing)?/,
  /slurred\s*speech/,
  /worst\s*headache\s*(of\s*my\s*life|ever)/,
  /\bstroke\b/,
  /\bkupooza\b/,
  /upande\s*mmoja\s*(hausikii|haujisikii|umepooza|una\s*udhaifu)/,
  /siwezi\s*kuongea\s*(vizuri|sawa)/,
  /siongei\s*vizuri/,
  /mkono\s*(mmoja|upande)\s*(una\s*udhaifu|haunikii|umekufa)/,

  // Bleeding
  /coughing\s*(up\s*)?blood/,
  /vomiting\s*(up\s*)?blood/,
  /heavy\s*bleed(ing)?/,
  /blood\s*in\s*(stool|urine|pee)/,
  /\bkukohoa\s*damu/,
  /\bkutapika\s*damu/,
  /damu\s*nyingi/,
  /\bnatokwa\s*damu\b/,
  /kutapika\s*damu/,
  /ninaruka\s*damu/,

  // Consciousness / collapse
  /\bfainted?\b/,
  /passed?\s*out/,
  /\bunresponsive\b/,
  /won'?t\s*wake\s*up/,
  /can'?t\s*wake\s*(him|her|them|up)/,
  /lost\s*consciousness/,
  /\bkuzimia\b/,
  /\bamezimia\b/,
  /\bhajitambui\b/,
  /blacked?\s*out/,
  /hazingatii\s*mazungumzo/,

  // Obstetric emergencies
  /pregnant.{0,20}(bleed|bleed(ing)?|severe\s*headache|fits|seiz|convuls)/,
  /mimba.{0,15}(na\s*damu|inatoka\s*damu|kuumwa\s*sana)/,
  /mjamzito.{0,15}(anatokwa\s*damu|anapigwa|damu|maumivu\s*makali)/,
  /baby\s*(not\s*moving|stopped\s*moving|isn'?t\s*moving)/,
  /mtoto\s*tumboni\s*(hasogei|hakisogei|hayawezi\s*kusogea)/,
  /water\s*broke/,
  /\bdegedege\b/,
  /mimba\s*(yenye\s*tatizo|ina\s*tatizo)/,

  // Paediatric danger signs
  /child\s*(not\s*feeding|not\s*waking|won'?t\s*wake|can'?t\s*wake|breathing\s*fast|having\s*fits)/,
  /baby\s*(not\s*feeding|not\s*waking|won'?t\s*wake)/,
  /mtoto\s*(hanyonyi|haamki|hana\s*nguvu|anapumua\s*haraka)/,
  /\bkifafa\b/,

  // Sepsis signs
  /stiff\s*neck.{0,20}fever/,
  /fever.{0,20}stiff\s*neck/,
  /shingo\s*ngumu.{0,15}homa/,
  /homa.{0,15}shingo\s*ngumu/,
  /non.?blanching\s*rash/,
  /rash.{0,20}won'?t\s*(fade|go\s*away).{0,20}(press|glass)/,

  // Trauma
  /deep\s*wound/,
  /broken\s*bone/,
  /severe\s*(burn|wound|bleed|trauma|crush)/,
  /\bajali\b/,
  /\bnimeumia\s*vibaya\b/,
  /\bkuungua\s*(vibaya|sana)\b/,
  /severe\s*accident/,
  /\bkuchanganyikiwa\s*ghafla\b/,
];

// ---------------------------------------------------------------------------
// AMBER — self-harm disclosure (distinct screen, calm tone, no red, no caps)
// ---------------------------------------------------------------------------
const AMBER_PATTERNS: RegExp[] = [
  /\bsuicid(e|al|ally)\b/,
  /kill\s*my(self)?/,
  /end\s*(my|this)\s*(life|pain|suffering)/,
  /don'?t\s*want\s*to\s*(live|be\s*alive|exist)/,
  /want\s*to\s*die/,
  /wish\s*i\s*(was|were)\s*dead/,
  /harm\s*my(self)?/,
  /hurt\s*my(self)?/,
  /cut\s*my(self)?/,
  /take\s*my\s*(own\s*)?life/,
  /\bjitoa\s*uhai\b/,
  /\bkujiua\b/,
  /\bkujiumiza\b/,
  /\bkujisababishia\s*madhara\b/,
  /\bsitaki\s*kuishi\b/,
  /\bnataka\s*kufa\b/,
  /maisha\s*(si\s*na\s*maana|sina\s*haja\s*yake|ni\s*mazigo)/,
  /nimechoka\s*(na\s*maisha|kuishi)/,
];

/**
 * Check text for danger signs.
 * Returns 'RED' for medical emergencies, 'AMBER' for self-harm disclosure,
 * or 'CLEAR' if no patterns match.
 *
 * Run this: (1) on typed input every keystroke batch,
 *           (2) on speech transcript before submit,
 *           (3) on Claude's structured output after brief generation.
 */
export function checkDangerSigns(text: string): InterceptorResult {
  if (!text || text.trim().length === 0) return 'CLEAR';

  const norm = normalise(text);

  for (const pattern of RED_PATTERNS) {
    if (pattern.test(norm)) return 'RED';
  }

  for (const pattern of AMBER_PATTERNS) {
    if (pattern.test(norm)) return 'AMBER';
  }

  return 'CLEAR';
}

/**
 * Convenience: check an entire NurseBrief's text fields after generation.
 * Accepts unknown so callers need no type cast (M-3).
 */
export function checkBriefForDangerSigns(brief: unknown): InterceptorResult {
  const fields = JSON.stringify(brief);
  return checkDangerSigns(fields);
}
