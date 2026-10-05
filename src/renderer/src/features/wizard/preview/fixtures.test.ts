import { describe, expect, it } from 'vitest';
import { isAppError } from '@shared/errors';
import { createInitialStudioState, deepMerge } from '@renderer/state/staticStudio';
import { resolveStep, WIZARD_STEP_IDS } from '../logic/wizardSteps';
import { parsePreviewHash, PREVIEW_VARIANTS, previewFixture } from './fixtures';

describe('parsePreviewHash', () => {
  it('reads a step number and a variant', () => {
    expect(parsePreviewHash('#step=1&variant=denied')).toEqual({
      step: 'microphone',
      variant: 'denied',
    });
    expect(parsePreviewHash('#step=11&variant=audio')).toEqual({ step: 'ready', variant: 'audio' });
  });

  it('accepts a step id as well', () => {
    expect(parsePreviewHash('#step=mic-test&variant=passed')).toEqual({
      step: 'mic-test',
      variant: 'passed',
    });
  });

  it('uses the first variant of the step when none (or an unknown one) is given', () => {
    expect(parsePreviewHash('#step=7')).toEqual({ step: 'hands', variant: 'both' });
    expect(parsePreviewHash('#step=7&variant=three-hands')).toEqual({
      step: 'hands',
      variant: 'both',
    });
    // Names that exist on every object are not variants.
    expect(parsePreviewHash('#step=7&variant=constructor').variant).toBe('both');
  });

  it('opens the first step for a missing or unknown step', () => {
    expect(parsePreviewHash('')).toEqual({ step: 'microphone', variant: 'granted' });
    expect(parsePreviewHash('#step=0').step).toBe('microphone');
    expect(parsePreviewHash('#step=12').step).toBe('microphone');
    expect(parsePreviewHash('#step=welcome').step).toBe('microphone');
  });
});

describe('preview fixtures', () => {
  const selections = WIZARD_STEP_IDS.flatMap((step) =>
    Object.keys(PREVIEW_VARIANTS[step]).map((variant) => ({ step, variant })),
  );

  it('cover every step', () => {
    for (const step of WIZARD_STEP_IDS) {
      expect(Object.keys(PREVIEW_VARIANTS[step]).length, step).toBeGreaterThan(0);
    }
  });

  it('open on a step that applies to their own state', () => {
    for (const selection of selections) {
      const fixture = previewFixture(selection);
      const state = deepMerge(createInitialStudioState(), fixture.state);
      const shown = resolveStep(fixture.step, {
        mode: state.settings.mode,
        hasReference: state.reference.status !== 'none',
      });
      expect(shown, `${selection.step}/${selection.variant}`).toBe(selection.step);
    }
  });

  it('only ever carry friendly errors', () => {
    for (const selection of selections) {
      const state = deepMerge(createInitialStudioState(), previewFixture(selection).state);
      for (const error of [
        state.engine.error,
        state.camera.error,
        state.tracking.error,
        state.backing.error,
        state.reference.error,
      ]) {
        if (error !== null) expect(isAppError(error)).toBe(true);
      }
    }
  });

  it('do not leak one variant into another', () => {
    const denied = previewFixture({ step: 'microphone', variant: 'denied' });
    const granted = previewFixture({ step: 'microphone', variant: 'granted' });
    expect(denied.state.permissions?.microphone).toBe('denied');
    expect(granted.state.permissions?.microphone).toBe('granted');
    expect(granted.state.engine?.error ?? null).toBeNull();
  });
});
