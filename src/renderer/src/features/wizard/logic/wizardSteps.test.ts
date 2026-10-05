import { describe, expect, it } from 'vitest';
import {
  applicableSteps,
  isWizardStepId,
  nextStep,
  previousStep,
  resolveStep,
  stepApplies,
  stepProgress,
  WIZARD_STEP_IDS,
  type WizardContext,
  type WizardStepId,
} from './wizardSteps';

const video: WizardContext = { mode: 'video', hasReference: false };
const videoWithReference: WizardContext = { mode: 'video', hasReference: true };
const audio: WizardContext = { mode: 'audio', hasReference: false };
const audioWithReference: WizardContext = { mode: 'audio', hasReference: true };
const everyContext = [video, videoWithReference, audio, audioWithReference];

/** Presses Continue from the first step until the wizard ends. */
function walkForward(context: WizardContext): WizardStepId[] {
  const visited: WizardStepId[] = [];
  let step: WizardStepId | null = resolveStep('microphone', context);
  while (step) {
    visited.push(step);
    step = nextStep(step, context);
  }
  return visited;
}

/** Presses Back from the last step until the wizard's beginning. */
function walkBackward(context: WizardContext): WizardStepId[] {
  const visited: WizardStepId[] = [];
  let step: WizardStepId | null = 'ready';
  while (step) {
    visited.push(step);
    step = previousStep(step, context);
  }
  return visited;
}

describe('which steps apply', () => {
  it('shows all eleven steps, in order, for video with a reference song', () => {
    expect(applicableSteps(videoWithReference)).toEqual([
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
    ]);
  });

  it('leaves out the hand-control step in Audio Only mode', () => {
    expect(stepApplies('hands', audio)).toBe(false);
    expect(stepApplies('hands', video)).toBe(true);
    expect(applicableSteps(audioWithReference)).not.toContain('hands');
  });

  it('leaves out the melody step until a reference song has been added', () => {
    expect(stepApplies('melody', video)).toBe(false);
    expect(stepApplies('melody', videoWithReference)).toBe(true);
    expect(applicableSteps(audio)).toEqual([
      'microphone',
      'mode',
      'headphones',
      'mic-test',
      'headphone-test',
      'monitoring',
      'backing',
      'reference',
      'ready',
    ]);
  });

  it('always starts with the microphone and ends ready to enter the studio', () => {
    for (const context of everyContext) {
      const steps = applicableSteps(context);
      expect(steps[0]).toBe('microphone');
      expect(steps.at(-1)).toBe('ready');
    }
  });

  it('recognises step ids', () => {
    expect(isWizardStepId('mic-test')).toBe(true);
    expect(isWizardStepId('welcome')).toBe(false);
    expect(isWizardStepId(3)).toBe(false);
  });
});

describe('Continue and Back', () => {
  it('visit exactly the steps that apply, in both directions', () => {
    for (const context of everyContext) {
      expect(walkForward(context)).toEqual(applicableSteps(context));
      expect(walkBackward(context)).toEqual(applicableSteps(context).reverse());
    }
  });

  it('skip the hand-control step in Audio Only mode', () => {
    expect(nextStep('monitoring', audio)).toBe('backing');
    expect(previousStep('backing', audio)).toBe('monitoring');
    expect(nextStep('monitoring', video)).toBe('hands');
    expect(previousStep('backing', video)).toBe('hands');
  });

  it('skip the melody step without a reference song', () => {
    expect(nextStep('reference', video)).toBe('ready');
    expect(previousStep('ready', video)).toBe('reference');
    expect(nextStep('reference', videoWithReference)).toBe('melody');
    expect(previousStep('ready', videoWithReference)).toBe('melody');
  });

  it('have nowhere to go past the ends', () => {
    for (const context of everyContext) {
      expect(previousStep('microphone', context)).toBeNull();
      expect(nextStep('ready', context)).toBeNull();
    }
  });

  it('still work from a step that has stopped applying', () => {
    // The singer was trying their hands when the app fell back to Audio Only.
    expect(nextStep('hands', audio)).toBe('backing');
    expect(previousStep('hands', audio)).toBe('monitoring');
  });
});

describe('resolving the step to show', () => {
  it('keeps a step that applies', () => {
    for (const context of everyContext) {
      for (const step of applicableSteps(context)) {
        expect(resolveStep(step, context)).toBe(step);
      }
    }
  });

  it('moves on to the next step that applies', () => {
    expect(resolveStep('hands', audio)).toBe('backing');
    expect(resolveStep('melody', video)).toBe('ready');
    expect(resolveStep('melody', audio)).toBe('ready');
  });

  it('never resolves to a step that does not apply', () => {
    for (const context of everyContext) {
      for (const step of WIZARD_STEP_IDS) {
        expect(stepApplies(resolveStep(step, context), context)).toBe(true);
      }
    }
  });
});

describe('progress', () => {
  it('counts only the steps that apply', () => {
    expect(stepProgress('microphone', video)).toEqual({ index: 0, count: 10 });
    expect(stepProgress('backing', video)).toEqual({ index: 7, count: 10 });
    expect(stepProgress('backing', audio)).toEqual({ index: 6, count: 9 });
    expect(stepProgress('ready', videoWithReference)).toEqual({ index: 10, count: 11 });
    expect(stepProgress('ready', audio)).toEqual({ index: 8, count: 9 });
  });

  it('reports a skipped step at the position of the step shown instead', () => {
    expect(stepProgress('hands', audio)).toEqual(stepProgress('backing', audio));
  });
});
