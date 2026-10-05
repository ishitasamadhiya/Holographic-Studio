import { describe, expect, it } from 'vitest';
import { createInitialStudioState, deepMerge } from '@renderer/state/staticStudio';
import type { StudioState } from '@renderer/state/studioTypes';
import type { DeepPartial } from '@shared/settings';
import { setupSummary } from './setupSummary';

function state(patch: DeepPartial<StudioState>): StudioState {
  return deepMerge(createInitialStudioState(), patch);
}

const devices = {
  microphones: [{ id: 'usb', label: 'Scarlett Solo USB' }],
  cameras: [{ id: 'facetime', label: 'FaceTime HD Camera' }],
  outputs: [{ id: 'airpods', label: 'AirPods Pro' }],
  outputSelectionSupported: true,
};
const song = { name: 'Midnight City.mp3', path: '/music/Midnight City.mp3', durationSec: 243 };

function valuesById(rows: ReturnType<typeof setupSummary>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.id, row.value]));
}

describe('setupSummary', () => {
  it('lists the chosen devices and songs for a video setup', () => {
    const rows = setupSummary(
      state({
        devices,
        settings: {
          mode: 'video',
          devices: { microphoneId: 'usb', cameraId: 'facetime', outputId: 'airpods' },
        },
        backing: { status: 'ready', file: song },
        reference: { status: 'ready', file: { ...song, name: 'Midnight City (Original).m4a' } },
      }),
    );
    expect(rows.map((row) => row.label)).toEqual([
      'Microphone',
      'Recording',
      'Camera',
      'Headphones',
      'Backing track',
      'Original song',
    ]);
    expect(valuesById(rows)).toEqual({
      microphone: 'Scarlett Solo USB',
      recording: 'Video with hand gestures',
      camera: 'FaceTime HD Camera',
      headphones: 'AirPods Pro',
      backing: 'Midnight City.mp3',
      reference: 'Midnight City (Original).m4a',
    });
  });

  it('leaves the camera out in Audio Only mode', () => {
    const rows = setupSummary(state({ devices, settings: { mode: 'audio' } }));
    expect(rows.map((row) => row.id)).toEqual([
      'microphone',
      'recording',
      'headphones',
      'backing',
      'reference',
    ]);
    expect(valuesById(rows).recording).toBe('Audio only with sliders');
  });

  it('says "System default" for devices left on the default', () => {
    const values = valuesById(setupSummary(state({ devices })));
    expect(values.microphone).toBe('System default');
    expect(values.camera).toBe('System default');
    expect(values.headphones).toBe('System default');
  });

  it('explains the output when it cannot be chosen in the app', () => {
    const values = valuesById(
      setupSummary(state({ devices: { ...devices, outputSelectionSupported: false } })),
    );
    expect(values.headphones).toBe("Your computer's current output");
  });

  it('describes singing without songs', () => {
    const values = valuesById(setupSummary(state({})));
    expect(values.backing).toBe('None · singing a cappella');
    expect(values.reference).toBe('None');
  });

  it('says so when the melody is still being learned', () => {
    const values = valuesById(
      setupSummary(state({ reference: { status: 'analyzing', file: song, progress: 0.4 } })),
    );
    expect(values.reference).toBe('Midnight City.mp3 · still learning the melody');
  });

  it('does not present a song that failed as part of the setup', () => {
    const values = valuesById(
      setupSummary(
        state({
          backing: { status: 'failed', file: song },
          reference: { status: 'failed', file: song },
        }),
      ),
    );
    expect(values.backing).toBe('None · singing a cappella');
    expect(values.reference).toBe('Could not be used');
  });
});
