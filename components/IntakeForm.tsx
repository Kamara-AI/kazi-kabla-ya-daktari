'use client';

/**
 * IntakeForm — four-bucket guided intake.
 *
 * Implements F-02: "Text intake across the four buckets; accepts Swahili,
 * Sheng, English and code-switched input."
 *
 * Guided one-step-at-a-time UX: each question addresses one bucket.
 * The patient can go back, skip, or request generation early after step 1.
 * All input is accumulated and sent as a single labelled transcript (§5.3).
 *
 * The red-flag interceptor runs on every keystroke batch (F-03).
 * It is checked before any API call is made.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { checkDangerSigns, type InterceptorResult } from '@/lib/interceptor';

interface IntakeFormProps {
  onEmergency: (type: 'RED' | 'AMBER') => void;
  onGenerate: (transcript: string) => void;
}

const STEPS = [
  {
    id: 'chief_complaint',
    label: 'Chief Complaint',
    question: 'What brought you here today?',
    questionSw: 'Kwa nini umekuja leo?',
    placeholder: 'Describe what you are feeling, in your own words...',
    placeholderSw: 'Elezea unachohisi kwa maneno yako...',
    hint: 'You can write in English, Swahili, Sheng, or any mix.',
    hintSw: 'Unaweza kuandika kwa Kiingereza, Kiswahili, Sheng, au mchanganyiko.',
  },
  {
    id: 'onset_duration',
    label: 'Onset & Duration',
    question: 'When did it start, and how has it changed?',
    questionSw: 'Ilianza lini, na imebadilika vipi?',
    placeholder: 'e.g. "Started 3 days ago", "gets worse at night"...',
    placeholderSw: 'mfano: "ilianza juzi", "inazidi usiku"...',
    hint: 'Any detail about timing helps the nurse.',
    hintSw: 'Maelezo yoyote kuhusu wakati yatasaidia muuguzi.',
  },
  {
    id: 'context_exposures',
    label: 'Context & Exposures',
    question: 'Any recent travel, medications, or allergies?',
    questionSw: 'Una safari ya hivi karibuni, dawa unazotumia, au mzio wowote?',
    placeholder: 'e.g. "travelled to Kisumu last week", "taking aspirin", "allergic to penicillin"...',
    placeholderSw: 'mfano: "nilikuwa Kisumu wiki iliyopita", "ninameza aspirini"...',
    hint: 'Say "nothing" or "none" if not applicable.',
    hintSw: 'Sema "hakuna" kama haihusiani.',
  },
  {
    id: 'patient_concerns',
    label: 'Your Concern',
    question: 'What are you most worried about?',
    questionSw: 'Una wasiwasi mkubwa zaidi gani?',
    placeholder: 'e.g. "I think I have malaria", "I am worried about my heart"...',
    placeholderSw: 'mfano: "Nafikiri nina malaria", "ninaogopa moyo wangu"...',
    hint: 'Whatever you believe or fear — say it in your own words.',
    hintSw: 'Chochote unachokiamini au kuogopa — sema kwa maneno yako.',
  },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export default function IntakeForm({ onEmergency, onGenerate }: IntakeFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<StepId, string>>({
    chief_complaint: '',
    onset_duration: '',
    context_exposures: '',
    patient_concerns: '',
  });
  const [currentText, setCurrentText] = useState('');
  const [interceptorResult, setInterceptorResult] = useState<InterceptorResult>('CLEAR');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  // Focus textarea when step changes
  useEffect(() => {
    textareaRef.current?.focus();
    setCurrentText(answers[step.id]);
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setCurrentText(text);

      // Red-flag check on every change (F-03) — synchronous, no network
      const result = checkDangerSigns(text);
      setInterceptorResult(result);

      if (result !== 'CLEAR') {
        // Halt intake immediately — do not finish the form
        onEmergency(result);
      }
    },
    [onEmergency],
  );

  const saveCurrentAnswer = useCallback(() => {
    setAnswers((prev) => ({ ...prev, [step.id]: currentText }));
  }, [step.id, currentText]);

  const handleNext = useCallback(() => {
    saveCurrentAnswer();
    setCurrentStep((s) => s + 1);
    setInterceptorResult('CLEAR');
  }, [saveCurrentAnswer]);

  const handleBack = useCallback(() => {
    saveCurrentAnswer();
    setCurrentStep((s) => s - 1);
    setInterceptorResult('CLEAR');
  }, [saveCurrentAnswer]);

  const buildTranscript = useCallback(
    (finalAnswer: string): string => {
      const all = { ...answers, [step.id]: finalAnswer };
      const lines: string[] = [];

      if (all.chief_complaint.trim()) {
        lines.push(`CHIEF COMPLAINT: ${all.chief_complaint.trim()}`);
      }
      if (all.onset_duration.trim()) {
        lines.push(`ONSET AND DURATION: ${all.onset_duration.trim()}`);
      }
      if (all.context_exposures.trim()) {
        lines.push(`CONTEXT AND EXPOSURES: ${all.context_exposures.trim()}`);
      }
      if (all.patient_concerns.trim()) {
        lines.push(`PATIENT CONCERNS: ${all.patient_concerns.trim()}`);
      }

      return lines.join('\n\n');
    },
    [answers, step.id],
  );

  const handleSubmit = useCallback(() => {
    if (!currentText.trim() && !answers.chief_complaint.trim()) return;

    const transcript = buildTranscript(currentText);
    if (!transcript.trim()) return;

    // Run interceptor one final time before sending to API
    const finalCheck = checkDangerSigns(transcript);
    if (finalCheck !== 'CLEAR') {
      onEmergency(finalCheck);
      return;
    }

    onGenerate(transcript);
  }, [currentText, answers, buildTranscript, onEmergency, onGenerate]);

  const handleGenerateEarly = useCallback(() => {
    saveCurrentAnswer();
    const transcript = buildTranscript(currentText);

    if (!transcript.trim()) return;

    const finalCheck = checkDangerSigns(transcript);
    if (finalCheck !== 'CLEAR') {
      onEmergency(finalCheck);
      return;
    }

    onGenerate(transcript);
  }, [saveCurrentAnswer, buildTranscript, currentText, onEmergency, onGenerate]);

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Progress bar */}
      <div className="h-1.5 bg-gray-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full bg-blue-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
            Step {currentStep + 1} of {STEPS.length} · {step.label}
          </p>
          <h2 className="text-lg font-bold text-gray-900 mt-0.5">{step.question}</h2>
          <p className="text-sm text-gray-500">{step.questionSw}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6 flex flex-col gap-4 max-w-2xl mx-auto w-full">
        {/* Textarea */}
        <div className="card flex-1 flex flex-col">
          {/* L-1: maxLength cap — 1000 chars per bucket keeps total transcript under 4000 */}
          <textarea
            ref={textareaRef}
            value={currentText}
            onChange={handleTextChange}
            placeholder={`${step.placeholder}\n\n${step.placeholderSw}`}
            aria-label={step.question}
            maxLength={1000}
            className="flex-1 w-full resize-none text-lg text-gray-900 placeholder-gray-400
                       bg-transparent border-0 outline-none leading-relaxed min-h-[200px]"
            rows={6}
          />
          {currentText.length > 900 && (
            <p className="text-xs text-amber-600 mt-1">
              {1000 - currentText.length} characters remaining
            </p>
          )}
          <p className="text-sm text-gray-400 mt-3 border-t border-gray-100 pt-3">
            {step.hint} · <span className="italic">{step.hintSw}</span>
          </p>
        </div>

        {/* Navigation */}
        <div className="space-y-3">
          {/* Primary action */}
          {isLastStep ? (
            <button
              onClick={handleSubmit}
              disabled={!currentText.trim() && !answers.chief_complaint.trim()}
              className="btn-primary"
            >
              Generate Summary for Nurse
              <span className="text-blue-200 text-sm font-normal">/ Tengeneza Muhtasari</span>
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!currentText.trim()}
              className="btn-primary"
            >
              Next Question
              <span className="text-blue-200 text-sm font-normal">/ Swali Linalofuata →</span>
            </button>
          )}

          {/* Generate early — available after step 1 */}
          {currentStep > 0 && !isLastStep && (
            <button
              onClick={handleGenerateEarly}
              disabled={!answers.chief_complaint.trim()}
              className="btn-secondary text-sm"
            >
              Generate now with what I have
              <span className="text-gray-400 text-xs">/ Tengeneza sasa hivi</span>
            </button>
          )}

          {/* Back */}
          {currentStep > 0 && (
            <button onClick={handleBack} className="btn-secondary">
              ← Back / Rudi
            </button>
          )}
        </div>

        {/* Previous answers summary */}
        {currentStep > 0 && (
          <div className="card bg-gray-50">
            <p className="section-label">So far you have told us:</p>
            <div className="space-y-2 text-sm text-gray-700">
              {STEPS.slice(0, currentStep).map((s) => {
                const answer = answers[s.id];
                if (!answer) return null;
                return (
                  <div key={s.id}>
                    <span className="font-medium text-gray-500">{s.label}: </span>
                    <span className="text-gray-800">{answer.slice(0, 80)}{answer.length > 80 ? '…' : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-gray-400 text-center pb-4">
          This assistant cannot diagnose. All data is discarded when you are done.
          <br />
          Msaidizi huyu hawezi kugundua ugonjwa. Data yote itafutwa ukimaliza.
        </p>
      </div>
    </div>
  );
}
