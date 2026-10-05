import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT_LATENCY_SEC } from './engineConstants';
import {
  microphoneConstraints,
  microphoneErrorCode,
  microphoneLatencySec,
  openMicrophone,
  type MicrophoneAccess,
} from './microphone';

function domError(name: string): Error {
  const error = new Error(`${name} raised by the test`);
  error.name = name;
  return error;
}

/** A getUserMedia stand-in that answers each call from a script and records what was asked. */
function scriptedAccess(...outcomes: Array<MediaStream | Error>) {
  const requests: MediaStreamConstraints[] = [];
  const access: MicrophoneAccess = {
    getUserMedia: async (constraints) => {
      requests.push(constraints);
      const outcome = outcomes.shift();
      if (outcome === undefined) throw new Error('unexpected getUserMedia call');
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { access, requests };
}

function requestedDevice(constraints: MediaStreamConstraints | undefined): unknown {
  return (constraints?.audio as MediaTrackConstraints).deviceId;
}

const stream = { id: 'stream-under-test' } as MediaStream;

describe('microphoneConstraints', () => {
  it('asks for a raw, mono, low-latency signal', () => {
    expect(microphoneConstraints(null)).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        latency: { ideal: 0 },
      },
      video: false,
    });
  });

  it('pins the device only when one is named', () => {
    expect(requestedDevice(microphoneConstraints('usb-mic'))).toEqual({ exact: 'usb-mic' });
    expect(requestedDevice(microphoneConstraints(null))).toBeUndefined();
  });
});

describe('microphoneErrorCode', () => {
  it.each([
    ['NotAllowedError', 'microphone-permission-denied'],
    ['SecurityError', 'microphone-permission-denied'],
    ['NotFoundError', 'no-microphone'],
    ['NotReadableError', 'audio-engine-failed'],
    ['AbortError', 'audio-engine-failed'],
    ['OverconstrainedError', 'audio-engine-failed'],
  ])('maps %s to %s', (name, code) => {
    expect(microphoneErrorCode(domError(name))).toBe(code);
  });

  it('treats anything unrecognizable as an engine failure', () => {
    expect(microphoneErrorCode('boom')).toBe('audio-engine-failed');
    expect(microphoneErrorCode(null)).toBe('audio-engine-failed');
  });
});

describe('openMicrophone', () => {
  it('opens the named device', async () => {
    const { access, requests } = scriptedAccess(stream);
    expect(await openMicrophone(access, 'usb-mic')).toEqual({ ok: true, value: stream });
    expect(requests).toHaveLength(1);
    expect(requestedDevice(requests[0])).toEqual({ exact: 'usb-mic' });
  });

  it.each(['OverconstrainedError', 'NotFoundError'])(
    'falls back to the default microphone when a remembered device is gone (%s)',
    async (name) => {
      const { access, requests } = scriptedAccess(domError(name), stream);
      expect(await openMicrophone(access, 'unplugged-mic')).toEqual({ ok: true, value: stream });
      expect(requests).toHaveLength(2);
      expect(requestedDevice(requests[1])).toBeUndefined();
    },
  );

  it('reports no-microphone when the fallback finds nothing either', async () => {
    const { access } = scriptedAccess(domError('OverconstrainedError'), domError('NotFoundError'));
    const result = await openMicrophone(access, 'unplugged-mic');
    expect(result).toMatchObject({ ok: false, error: { code: 'no-microphone' } });
  });

  it('reports no-microphone when there is no input device at all', async () => {
    const { access, requests } = scriptedAccess(domError('NotFoundError'));
    const result = await openMicrophone(access, null);
    expect(result).toMatchObject({ ok: false, error: { code: 'no-microphone' } });
    expect(requests).toHaveLength(1);
  });

  it('does not retry when access was denied', async () => {
    const { access, requests } = scriptedAccess(domError('NotAllowedError'));
    const result = await openMicrophone(access, 'usb-mic');
    expect(result).toMatchObject({ ok: false, error: { code: 'microphone-permission-denied' } });
    expect(requests).toHaveLength(1);
  });

  it('reports a denial that only shows up on the fallback', async () => {
    const { access } = scriptedAccess(
      domError('OverconstrainedError'),
      domError('NotAllowedError'),
    );
    const result = await openMicrophone(access, 'unplugged-mic');
    expect(result).toMatchObject({ ok: false, error: { code: 'microphone-permission-denied' } });
  });

  it('maps a busy device to an engine failure and keeps the technical detail', async () => {
    const { access } = scriptedAccess(domError('NotReadableError'));
    const result = await openMicrophone(access, null);
    expect(result).toMatchObject({ ok: false, error: { code: 'audio-engine-failed' } });
    expect(result.ok ? '' : result.error.detail).toContain('NotReadableError');
  });

  it('fails cleanly where there is no media API', async () => {
    const result = await openMicrophone(undefined, null);
    expect(result).toMatchObject({ ok: false, error: { code: 'audio-engine-failed' } });
  });
});

describe('microphoneLatencySec', () => {
  it('uses the latency the track reports', () => {
    expect(microphoneLatencySec({ latency: 0.0053 } as MediaTrackSettings)).toBe(0.0053);
  });

  it('falls back to the default when the track reports nothing usable', () => {
    expect(microphoneLatencySec(undefined)).toBe(DEFAULT_INPUT_LATENCY_SEC);
    expect(microphoneLatencySec({})).toBe(DEFAULT_INPUT_LATENCY_SEC);
    expect(microphoneLatencySec({ latency: 0 } as MediaTrackSettings)).toBe(
      DEFAULT_INPUT_LATENCY_SEC,
    );
    expect(microphoneLatencySec({ latency: Number.NaN } as MediaTrackSettings)).toBe(
      DEFAULT_INPUT_LATENCY_SEC,
    );
  });
});
