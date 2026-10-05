import { describe, expect, it } from 'vitest';
import { createAppError, FRIENDLY_ERROR_MESSAGES } from '@shared/errors';
import type { CameraState, EngineState } from '@renderer/state/studioTypes';
import { canStartRecording, findStudioProblem } from './problems';

function engine(overrides: Partial<EngineState> = {}): EngineState {
  return { status: 'running', error: null, monitoringLatencyMs: 20, ...overrides };
}

function camera(overrides: Partial<CameraState> = {}): CameraState {
  return { status: 'running', error: null, width: 1280, height: 720, ...overrides };
}

describe('findStudioProblem', () => {
  it('finds nothing while audio and camera are healthy', () => {
    expect(findStudioProblem(engine(), camera(), 'video')).toBeNull();
    expect(findStudioProblem(engine({ status: 'starting' }), camera(), 'video')).toBeNull();
  });

  it('sends a denied microphone to System Settings first', () => {
    const error = createAppError('microphone-permission-denied');
    const problem = findStudioProblem(engine({ status: 'error', error }), camera(), 'video');
    expect(problem).toEqual({
      source: 'microphone',
      title: 'Microphone access is off',
      message: error.message,
      actions: ['open-system-settings', 'retry'],
    });
  });

  it('offers only a retry for other audio failures', () => {
    const error = createAppError('no-microphone');
    const problem = findStudioProblem(engine({ status: 'error', error }), camera(), 'audio');
    expect(problem?.title).toBe('No microphone found');
    expect(problem?.actions).toEqual(['retry']);
  });

  it('falls back to a friendly message when the error is missing', () => {
    const problem = findStudioProblem(engine({ status: 'error' }), camera(), 'video');
    expect(problem?.title).toBe('Sound could not start');
    expect(problem?.message).toBe(FRIENDLY_ERROR_MESSAGES['audio-engine-failed']);
  });

  it('offers Audio Only as a way around a camera problem', () => {
    const denied = createAppError('camera-permission-denied');
    expect(
      findStudioProblem(engine(), camera({ status: 'error', error: denied }), 'video'),
    ).toEqual({
      source: 'camera',
      title: 'Camera access is off',
      message: denied.message,
      actions: ['open-system-settings', 'retry', 'switch-to-audio'],
    });

    const missing = createAppError('no-camera');
    const problem = findStudioProblem(
      engine(),
      camera({ status: 'error', error: missing }),
      'video',
    );
    expect(problem?.title).toBe('No camera found');
    expect(problem?.actions).toEqual(['retry', 'switch-to-audio']);
  });

  it('ignores camera trouble in Audio Only', () => {
    const error = createAppError('no-camera');
    expect(findStudioProblem(engine(), camera({ status: 'error', error }), 'audio')).toBeNull();
  });

  it('reports the audio problem when both devices fail', () => {
    const problem = findStudioProblem(
      engine({ status: 'error', error: createAppError('audio-engine-failed') }),
      camera({ status: 'error', error: createAppError('no-camera') }),
      'video',
    );
    expect(problem?.source).toBe('microphone');
  });
});

describe('canStartRecording', () => {
  it('needs live audio', () => {
    expect(canStartRecording(engine(), camera(), 'video')).toBe(true);
    expect(canStartRecording(engine({ status: 'starting' }), camera(), 'video')).toBe(false);
    expect(canStartRecording(engine({ status: 'off' }), camera(), 'audio')).toBe(false);
    expect(canStartRecording(engine({ status: 'error' }), camera(), 'audio')).toBe(false);
  });

  it('is blocked by a camera error only in video mode', () => {
    const broken = camera({ status: 'error' });
    expect(canStartRecording(engine(), broken, 'video')).toBe(false);
    expect(canStartRecording(engine(), broken, 'audio')).toBe(true);
    expect(canStartRecording(engine(), camera({ status: 'starting' }), 'video')).toBe(true);
  });
});
