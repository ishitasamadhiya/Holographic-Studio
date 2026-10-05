// Which wizard steps exist, which of them apply to this singer, and how Back and Continue
// move between them. Pure, so the sequencing can be tested without rendering anything.
import type { RecordingMode } from '@shared/settings';

/** Every step, in the order a singer meets them. */
export const WIZARD_STEP_IDS = [
  'microphone',
  'mode',
  'headphones',
  'mic-test',
  'headphone-test',
  'monitoring',
  'hands',
  'backing',
  'reference',
  'melody',
  'ready',
] as const;

export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

/** The facts that decide which steps apply. */
export interface WizardContext {
  mode: RecordingMode;
  /** A reference song has been added, whatever became of its analysis. */
  hasReference: boolean;
}

export interface StepProgress {
  /** Position among the steps that apply, starting at 0. */
  index: number;
  /** How many steps apply. */
  count: number;
}

export function isWizardStepId(value: unknown): value is WizardStepId {
  return WIZARD_STEP_IDS.includes(value as WizardStepId);
}

export function stepApplies(step: WizardStepId, context: WizardContext): boolean {
  switch (step) {
    case 'hands':
      return context.mode === 'video';
    case 'melody':
      return context.hasReference;
    default:
      return true;
  }
}

export function applicableSteps(context: WizardContext): WizardStepId[] {
  return WIZARD_STEP_IDS.filter((step) => stepApplies(step, context));
}

/**
 * The step to show when `step` was asked for: the step itself when it applies, otherwise
 * the next one that does. This is what makes a step disappear from under the singer
 * gracefully, e.g. the hand-control step when the app has to fall back to Audio Only.
 */
export function resolveStep(step: WizardStepId, context: WizardContext): WizardStepId {
  const candidates = WIZARD_STEP_IDS.slice(WIZARD_STEP_IDS.indexOf(step));
  // The last step always applies, so there is always a match.
  return candidates.find((candidate) => stepApplies(candidate, context)) ?? 'ready';
}

/** The step Continue leads to, or null on the last step. */
export function nextStep(step: WizardStepId, context: WizardContext): WizardStepId | null {
  const later = WIZARD_STEP_IDS.slice(WIZARD_STEP_IDS.indexOf(step) + 1);
  return later.find((candidate) => stepApplies(candidate, context)) ?? null;
}

/** The step Back leads to, or null on the first step. */
export function previousStep(step: WizardStepId, context: WizardContext): WizardStepId | null {
  const earlier = WIZARD_STEP_IDS.slice(0, WIZARD_STEP_IDS.indexOf(step));
  return earlier.findLast((candidate) => stepApplies(candidate, context)) ?? null;
}

/** Where `step` sits among the steps that apply ("Step 3 of 9"). */
export function stepProgress(step: WizardStepId, context: WizardContext): StepProgress {
  const steps = applicableSteps(context);
  return { index: Math.max(0, steps.indexOf(resolveStep(step, context))), count: steps.length };
}
