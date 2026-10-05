// The live audio engine in real Electron, driven through the developer probe page
// (src/renderer/src/dev/engineProbe.ts). Startup runs on Chromium's fake microphone; the
// measurements use a synthetic voice the probe feeds in as the microphone (the fake device
// cannot play a WAV while the audio service is sandboxed). Output is muted, so latency
// numbers here say nothing about real hardware.
import { expect, test, type Page } from '@playwright/test';
import type { AppError } from '../../src/shared/errors';
import { vocalVolumeToDb } from '../../src/shared/controls';
import type { AudioEngine, EngineMeters } from '../../src/renderer/src/audio/engineTypes';
import { launchApp, type LaunchedApp } from './helpers/app';
import {
  centsFrom,
  encodeWav,
  findImpulses,
  float32FromBase64,
  FIXTURE_SAMPLE_RATE,
  longestRun,
  loudRuns,
  medianPitchHz,
  midiToHz,
  rms,
  synthesizeVoice,
  toDb,
} from './helpers/audioFixtures';

interface EngineProbe {
  engine: AudioEngine;
  errors: AppError[];
  backingEndedAt: number[];
  latestMeters(): EngineMeters;
  useSyntheticMicrophone(wavBase64: string | null): Promise<void>;
  requestedConstraints(): MediaStreamConstraints[];
  contextInfo(): {
    sampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    state: string;
  } | null;
  openContexts(): number;
  microphoneTracks(): {
    readyState: string;
    latencySec: number | null;
    echoCancellation: boolean | null;
    noiseSuppression: boolean | null;
    autoGainControl: boolean | null;
    channelCount: number | null;
  }[];
  startCollecting(): void;
  stopCollecting(): {
    chunks: number;
    chunkFrames: number[];
    mismatchedChunks: number;
    frames: number;
  };
  stemBase64(stem: 'vocal' | 'backing', channel: number, from?: number, to?: number): string;
  setClickBacking(options: {
    durationSec: number;
    intervalSec: number;
    firstClickFrame: number;
  }): number[];
  decodeBase64(base64: string): Promise<{
    ok: boolean;
    code: string | null;
    durationSec: number | null;
    sampleRate: number | null;
    channels: number | null;
    callerBytesIntact: boolean;
  }>;
  waitUntilContextTime(timeSec: number): Promise<void>;
  monitorPeak(durationMs: number): Promise<number>;
}

declare global {
  interface Window {
    __engineProbe: EngineProbe;
  }
}

const SAMPLE_RATE = FIXTURE_SAMPLE_RATE;
/** A3 (MIDI 57) sung 40 cents flat. */
const SUNG_MIDI = 57 - 0.4;
const VOICE = { f0Hz: midiToHz(SUNG_MIDI), toneSec: 1, silenceSec: 1, peak: 0.25 };

const voiceWavBase64 = encodeWav(synthesizeVoice(VOICE)).toString('base64');
let launched: LaunchedApp;
let page: Page;
const consoleErrors: string[] = [];

async function startEngine(target: Page): Promise<void> {
  const result = await target.evaluate(() =>
    window.__engineProbe.engine.start({ microphoneId: null, outputId: null }),
  );
  expect(result).toEqual({ ok: true, value: undefined });
}

/** Meter readings over one full period of the voice: the loudest level and a voiced pitch. */
async function observeMeters(
  target: Page,
): Promise<{ inputLevel: number; detectedMidi: number | null }> {
  return target.evaluate(async () => {
    const probe = window.__engineProbe;
    let inputLevel = 0;
    let detectedMidi: number | null = null;
    const until = performance.now() + 2200;
    while (performance.now() < until) {
      const meters = probe.latestMeters();
      inputLevel = Math.max(inputLevel, meters.inputLevel);
      if (meters.detectedMidi !== null && meters.inputLevel > 0.1)
        detectedMidi = meters.detectedMidi;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { inputLevel, detectedMidi };
  });
}

/** Records the stems for `durationSec` with the given controls; returns channel 0 of the vocal. */
async function captureVocal(
  target: Page,
  setup: { autotune?: number; echo?: number; volume?: number; durationSec?: number },
): Promise<Float32Array> {
  const frames = await target.evaluate(async (options) => {
    const probe = window.__engineProbe;
    const { engine } = probe;
    engine.setControls({
      autotune: options.autotune ?? 0,
      echo: options.echo ?? 0,
      volume: options.volume ?? 0.5,
    });
    // Let the chain's own parameter smoothing settle (and an old echo die away).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    probe.startCollecting();
    await engine.startCapture();
    await new Promise((resolve) => setTimeout(resolve, (options.durationSec ?? 2.2) * 1000));
    const finished = await engine.stopCapture();
    probe.stopCollecting();
    return finished.frames;
  }, setup);
  expect(frames).toBeGreaterThan(SAMPLE_RATE);
  return float32FromBase64(
    await target.evaluate(() => window.__engineProbe.stemBase64('vocal', 0)),
  );
}

/** Pitch over the steady part of the longest note in a recording, in cents from MIDI `note`. */
function steadyPitchCents(vocal: Float32Array, note: number): number {
  const run = longestRun(loudRuns(vocal));
  // Skip the onset (the correction glides in) and keep clear of the release.
  const from = run.start + Math.round(0.3 * SAMPLE_RATE);
  const to = run.end - Math.round(0.05 * SAMPLE_RATE);
  expect(to - from).toBeGreaterThan(0.3 * SAMPLE_RATE);
  return centsFrom(medianPitchHz(vocal, from, to), note);
}

/** RMS of the steady middle of the longest note, in dBFS. */
function steadyLevelDb(vocal: Float32Array): number {
  const run = longestRun(loudRuns(vocal));
  return toDb(rms(vocal, run.start + 4800, run.end - 4800));
}

test.describe.serial('audio engine', () => {
  test.beforeAll(async () => {
    launched = await launchApp({ page: 'engine-probe.html' });
    page = launched.page;
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.waitForFunction(() => window.__engineProbe !== undefined);
  });

  test.afterAll(async () => {
    await launched?.close();
  });

  test('decodes audio files before the engine has started', async () => {
    const wavBase64 = voiceWavBase64;
    const decoded = await page.evaluate(
      (bytes) => window.__engineProbe.decodeBase64(bytes),
      wavBase64,
    );
    expect(decoded).toMatchObject({
      ok: true,
      sampleRate: 48000,
      channels: 1,
      callerBytesIntact: true,
    });
    expect(decoded.durationSec).toBeCloseTo(VOICE.toneSec + VOICE.silenceSec, 3);

    const garbage = Buffer.from('this is not an audio file at all'.repeat(64)).toString('base64');
    const rejected = await page.evaluate(
      (bytes) => window.__engineProbe.decodeBase64(bytes),
      garbage,
    );
    expect(rejected).toMatchObject({ ok: false, code: 'unsupported-audio-file' });
  });

  test('starts under the production CSP, loads both worklets, and meters the microphone', async () => {
    expect(await page.evaluate(() => location.origin)).toBe('app://studio');
    await startEngine(page);
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => {
      const probe = window.__engineProbe;
      return {
        running: probe.engine.isRunning,
        sampleRate: probe.engine.sampleRate,
        context: probe.contextInfo(),
        tracks: probe.microphoneTracks(),
        constraints: probe.requestedConstraints().at(-1),
        latency: probe.engine.getLatency(),
      };
    });
    const meters = await observeMeters(page);
    expect(state.running).toBe(true);
    expect(state.sampleRate).toBe(48000);
    expect(state.context?.state).toBe('running');
    expect(state.tracks.at(-1)).toMatchObject({
      readyState: 'live',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(state.constraints?.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      latency: { ideal: 0 },
    });
    // The fake microphone's beeps reach the vocal chain.
    expect(meters.inputLevel).toBeGreaterThan(0.1);
    // Only known once the vocal-chain worklet has reported in.
    expect(state.latency.processingSec).toBeGreaterThan(0);

    const ms = (sec: number) => Number((sec * 1000).toFixed(2));
    const monitoringSec =
      state.latency.inputSec + state.latency.processingSec + state.latency.outputSec;
    console.log(
      'Latency (fake devices, muted output: NOT representative of real hardware):',
      JSON.stringify({
        baseLatencyMs: ms(state.context?.baseLatencySec ?? Number.NaN),
        outputLatencyMs: ms(state.context?.outputLatencySec ?? Number.NaN),
        micTrackLatencySettingMs:
          state.tracks.at(-1)?.latencySec == null ? null : ms(state.tracks.at(-1)?.latencySec ?? 0),
        engineInputMs: ms(state.latency.inputSec),
        engineOutputMs: ms(state.latency.outputSec),
        processingMs: ms(state.latency.processingSec),
        monitoringMs: ms(monitoringSec),
      }),
    );
  });

  test('switches the microphone while running, releasing the old one', async () => {
    const result = await page.evaluate(async (wav) => {
      const probe = window.__engineProbe;
      await probe.useSyntheticMicrophone(wav);
      const switched = await probe.engine.setMicrophone(null);
      return { switched, tracks: probe.microphoneTracks().map((track) => track.readyState) };
    }, voiceWavBase64);
    expect(result.switched).toEqual({ ok: true, value: undefined });
    expect(result.tracks).toEqual(['ended', 'live']);
    // Let the meters forget the old microphone's last reading.
    await page.waitForTimeout(300);
    const meters = await observeMeters(page);
    console.log('Synthetic voice meters:', JSON.stringify(meters));
    expect(meters.inputLevel).toBeGreaterThan(0.2);
    expect(meters.inputLevel).toBeLessThan(0.3);
    expect(Math.abs((meters.detectedMidi ?? 0) - SUNG_MIDI)).toBeLessThan(0.15);
  });

  test('decodes audio files while running, at the engine rate', async () => {
    const wavBase64 = voiceWavBase64;
    const decoded = await page.evaluate(
      (bytes) => window.__engineProbe.decodeBase64(bytes),
      wavBase64,
    );
    expect(decoded).toMatchObject({ ok: true, sampleRate: 48000, callerBytesIntact: true });
    const rejected = await page.evaluate(
      (bytes) => window.__engineProbe.decodeBase64(bytes),
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64'),
    );
    expect(rejected).toMatchObject({ ok: false, code: 'unsupported-audio-file' });
  });

  test('captures both stems in lockstep from exactly the requested frame', async () => {
    const result = await page.evaluate(async () => {
      const probe = window.__engineProbe;
      const { engine } = probe;
      engine.setControls({ autotune: 0, echo: 0, volume: 0.5 });
      probe.startCollecting();
      const requestedFrame = Math.round((engine.currentTimeSec + 0.2) * engine.sampleRate);
      const started = await engine.startCapture(requestedFrame / engine.sampleRate);
      await new Promise((resolve) => setTimeout(resolve, 2400));
      const finished = await engine.stopCapture();
      return {
        requestedFrame,
        startedFrame: started.startContextTimeSec * engine.sampleRate,
        finished,
        collected: probe.stopCollecting(),
      };
    });
    console.log(
      'Capture:',
      JSON.stringify({ ...result, collected: { ...result.collected, chunkFrames: undefined } }),
    );
    // Exact up to the float round trip frame -> seconds -> frame.
    expect(result.startedFrame).toBeCloseTo(result.requestedFrame, 6);
    expect(result.collected.chunks).toBeGreaterThanOrEqual(8);
    expect(result.collected.mismatchedChunks).toBe(0);
    expect(result.collected.frames).toBe(result.finished.frames);
    // Quarter-second chunks; only the last one (the tail) may be shorter.
    expect(new Set(result.collected.chunkFrames.slice(0, -1))).toEqual(new Set([12000]));

    const vocal = float32FromBase64(
      await page.evaluate(() => window.__engineProbe.stemBase64('vocal', 0)),
    );
    const right = float32FromBase64(
      await page.evaluate(() => window.__engineProbe.stemBase64('vocal', 1)),
    );
    expect(vocal.length).toBe(result.finished.frames);
    expect(rms(right)).toBeCloseTo(rms(vocal), 6);
    // The vocal stem is the fake microphone's voice, at its pitch and level (unity volume).
    const cents = steadyPitchCents(vocal, 57);
    console.log(`Vocal stem pitch: ${cents.toFixed(1)} cents from A3 (sung at -40)`);
    expect(Math.abs(cents + 40)).toBeLessThan(5);
    const expectedDb = toDb(rms(synthesizeVoice(VOICE), 4800, VOICE.toneSec * SAMPLE_RATE - 4800));
    expect(Math.abs(steadyLevelDb(vocal) - expectedDb)).toBeLessThan(1);
  });

  test('backing track: sample-exact start, song position, natural end', async () => {
    const delaySec = 0.5;
    const result = await page.evaluate(async (delay) => {
      const probe = window.__engineProbe;
      const { engine } = probe;
      engine.setMix({ backingVolume: 1 });
      const clicks = probe.setClickBacking({
        durationSec: 3,
        intervalSec: 0.5,
        firstClickFrame: 100,
      });
      probe.startCollecting();
      const captureFrame = Math.round((engine.currentTimeSec + 0.2) * engine.sampleRate);
      const captureAt = captureFrame / engine.sampleRate;
      const started = await engine.startCapture(captureAt);
      const backingAt = engine.startBacking({ atContextTimeSec: captureAt + delay });
      const positionBeforeStart = engine.getSongPositionSec();
      const endedBefore = probe.backingEndedAt.length;

      await probe.waitUntilContextTime(backingAt + 1);
      const first = { position: engine.getSongPositionSec(), time: engine.currentTimeSec };
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = { position: engine.getSongPositionSec(), time: engine.currentTimeSec };
      const outputSec = engine.getLatency().outputSec;

      await probe.waitUntilContextTime(backingAt + 3.4);
      const finished = await engine.stopCapture();
      return {
        clicks,
        captureFrame,
        startedFrame: started.startContextTimeSec * engine.sampleRate,
        backingFrame: backingAt * engine.sampleRate,
        expectedBackingFrame: captureFrame + delay * engine.sampleRate,
        positionBeforeStart,
        first,
        second,
        outputSec,
        backingAt,
        endedAt: probe.backingEndedAt.slice(endedBefore),
        playingAfterEnd: engine.isBackingPlaying,
        positionAfterEnd: engine.getSongPositionSec(),
        frames: finished.frames,
        collected: probe.stopCollecting(),
      };
    }, delaySec);

    expect(result.startedFrame).toBeCloseTo(result.captureFrame, 6);
    expect(result.backingFrame).toBeCloseTo(result.expectedBackingFrame, 6);
    expect(result.positionBeforeStart).toBeNull();
    expect(result.collected.mismatchedChunks).toBe(0);

    // Song position: what is heard, advancing with the audio clock.
    const { first, second } = result;
    expect(first.position).not.toBeNull();
    expect(second.position).not.toBeNull();
    const advanced = (second.position ?? 0) - (first.position ?? 0);
    expect(Math.abs(advanced - (second.time - first.time))).toBeLessThan(0.002);
    const expectedPosition = first.time - result.backingAt - result.outputSec;
    expect(Math.abs((first.position ?? 0) - expectedPosition)).toBeLessThan(0.002);

    // Natural end: once, about three seconds after the start.
    expect(result.endedAt).toHaveLength(1);
    expect(result.endedAt[0]).toBeGreaterThanOrEqual(result.backingAt + 3);
    expect(result.endedAt[0]).toBeLessThan(result.backingAt + 3.4);
    expect(result.playingAfterEnd).toBe(false);
    expect(result.positionAfterEnd).toBeNull();

    const backing = float32FromBase64(
      await page.evaluate(() => window.__engineProbe.stemBase64('backing', 0)),
    );
    const found = findImpulses(backing, 0.5);
    const offset = delaySec * SAMPLE_RATE;
    const expected = result.clicks.map((frame) => frame + offset);
    console.log('Backing clicks: expected', expected, 'found', found);
    expect(found).toHaveLength(expected.length);
    found.forEach((position, index) => {
      expect(Math.abs(position - (expected[index] ?? Number.NaN))).toBeLessThanOrEqual(1);
      // Untouched by any transport fade (backing volume is 1).
      expect(Math.abs(backing[position] ?? 0)).toBeCloseTo(1, 5);
    });

    // A stop is not an "end".
    const stoppedEarly = await page.evaluate(async () => {
      const probe = window.__engineProbe;
      const before = probe.backingEndedAt.length;
      const at = probe.engine.startBacking();
      await probe.waitUntilContextTime(at + 0.3);
      const position = probe.engine.stopBacking();
      await new Promise((resolve) => setTimeout(resolve, 3200));
      return { position, ended: probe.backingEndedAt.length - before };
    });
    expect(stoppedEarly.ended).toBe(0);
    expect(stoppedEarly.position).toBeGreaterThan(0.3);
    expect(stoppedEarly.position).toBeLessThan(0.5);
  });

  test('pause and resume cut exactly the paused span out of both stems', async () => {
    const result = await page.evaluate(async () => {
      const probe = window.__engineProbe;
      const { engine } = probe;
      const rate = engine.sampleRate;
      const clicks = probe.setClickBacking({
        durationSec: 4,
        intervalSec: 0.25,
        firstClickFrame: 3000,
      });
      probe.startCollecting();
      const start = Math.round((engine.currentTimeSec + 0.2) * rate);
      const pause = start + 45000;
      const resume = pause + 28800;
      const secondPause = resume + 33600;

      await engine.startCapture(start / rate);
      engine.startBacking({ atContextTimeSec: start / rate });
      await probe.waitUntilContextTime(pause / rate - 0.1);
      const capturePaused = engine.pauseCapture(pause / rate);
      const resumeFrom = engine.stopBacking(pause / rate);
      await capturePaused;
      await probe.waitUntilContextTime(resume / rate - 0.1);
      const captureResumed = engine.resumeCapture(resume / rate);
      engine.startBacking({ offsetSec: resumeFrom, atContextTimeSec: resume / rate });
      await captureResumed;
      await probe.waitUntilContextTime(secondPause / rate - 0.1);
      await engine.pauseCapture(secondPause / rate);
      engine.stopBacking(secondPause / rate);
      await probe.waitUntilContextTime(secondPause / rate + 0.1);
      const finished = await engine.stopCapture();
      return {
        clicks,
        resumeFrom,
        expectedFrames: pause - start + (secondPause - resume),
        frames: finished.frames,
        collected: probe.stopCollecting(),
      };
    });

    expect(result.resumeFrom * SAMPLE_RATE).toBeCloseTo(45000, 6);
    expect(result.frames).toBe(result.expectedFrames);
    expect(result.collected.frames).toBe(result.expectedFrames);
    expect(result.collected.mismatchedChunks).toBe(0);

    // The backing restarted from where it paused, on the frame the capture resumed, so every
    // click sits at its own position in the track — including across the pause.
    const backing = float32FromBase64(
      await page.evaluate(() => window.__engineProbe.stemBase64('backing', 0)),
    );
    const found = findImpulses(backing, 0.5);
    const expected = result.clicks.filter((frame) => frame < result.expectedFrames);
    console.log('Clicks across the pause: expected', expected, 'found', found);
    expect(found).toHaveLength(expected.length);
    found.forEach((position, index) => {
      expect(Math.abs(position - (expected[index] ?? Number.NaN))).toBeLessThanOrEqual(1);
      // Untouched by any transport fade (backing volume is 1).
      expect(Math.abs(backing[position] ?? 0)).toBeCloseTo(1, 5);
    });
    const vocal = float32FromBase64(
      await page.evaluate(() => window.__engineProbe.stemBase64('vocal', 0)),
    );
    expect(vocal.length).toBe(backing.length);
    await page.evaluate(() => window.__engineProbe.engine.setBackingTrack(null));
  });

  test('vocal volume follows the shared dB mapping', async () => {
    const levels: Record<string, number> = {};
    for (const volume of [0, 0.5, 1]) {
      levels[volume] = steadyLevelDb(await captureVocal(page, { volume }));
    }
    const quiet = (levels[0] ?? 0) - (levels[0.5] ?? 0);
    const loud = (levels[1] ?? 0) - (levels[0.5] ?? 0);
    console.log(`Volume: 0 -> ${quiet.toFixed(2)} dB, 1 -> +${loud.toFixed(2)} dB (re 0.5)`);
    expect(Math.abs(quiet - vocalVolumeToDb(0))).toBeLessThan(1);
    expect(Math.abs(loud - vocalVolumeToDb(1))).toBeLessThan(1);
  });

  test('echo leaves a decaying tail after the voice stops; no echo leaves silence', async () => {
    // A held note (no gaps), cut off at a known moment by turning the input trim to zero.
    const heldNote = encodeWav(synthesizeVoice({ ...VOICE, toneSec: 4, silenceSec: 0 }));
    await page.evaluate(async (wav) => {
      const probe = window.__engineProbe;
      await probe.useSyntheticMicrophone(wav);
      await probe.engine.setMicrophone(null);
    }, heldNote.toString('base64'));

    const tail = async (echo: number) => {
      const cutFrame = await page.evaluate(async (echoLevel) => {
        const probe = window.__engineProbe;
        const { engine } = probe;
        engine.setControls({ autotune: 0, echo: echoLevel, volume: 0.5 });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        probe.startCollecting();
        const started = await engine.startCapture();
        await new Promise((resolve) => setTimeout(resolve, 900));
        const cutAt = engine.currentTimeSec;
        engine.setMix({ micGain: 0 });
        await new Promise((resolve) => setTimeout(resolve, 1300));
        await engine.stopCapture();
        probe.stopCollecting();
        engine.setMix({ micGain: 1 });
        return Math.round((cutAt - started.startContextTimeSec) * engine.sampleRate);
      }, echo);
      const vocal = float32FromBase64(
        await page.evaluate(() => window.__engineProbe.stemBase64('vocal', 0)),
      );
      const held = toDb(rms(vocal, cutFrame - 0.3 * SAMPLE_RATE, cutFrame - 0.05 * SAMPLE_RATE));
      // Windows start 150 ms after the cut, once the input trim's own glide has died away.
      const levelAfterCut = (fromSec: number) => {
        const from = cutFrame + Math.round(fromSec * SAMPLE_RATE);
        return toDb(rms(vocal, from, from + 0.15 * SAMPLE_RATE)) - held;
      };
      return {
        early: levelAfterCut(0.15),
        middle: levelAfterCut(0.45),
        late: levelAfterCut(0.75),
      };
    };
    const withEcho = await tail(1);
    const withoutEcho = await tail(0);
    await page.evaluate(async (wav) => {
      const probe = window.__engineProbe;
      await probe.useSyntheticMicrophone(wav);
      await probe.engine.setMicrophone(null);
    }, voiceWavBase64);

    console.log('Echo tail (dB re held note):', JSON.stringify({ withEcho, withoutEcho }));
    expect(withEcho.early).toBeGreaterThan(-20);
    expect(withEcho.middle).toBeLessThan(withEcho.early - 2);
    expect(withEcho.late).toBeLessThan(withEcho.middle - 2);
    expect(withEcho.late).toBeGreaterThan(-60);
    expect(withoutEcho.early).toBeLessThan(-60);
  });

  test('autotune pulls the flat voice onto the nearest semitone, and only when asked', async () => {
    const before = steadyPitchCents(await captureVocal(page, { autotune: 0 }), 57);
    const after = steadyPitchCents(await captureVocal(page, { autotune: 1 }), 57);
    console.log(
      `Autotune: ${before.toFixed(1)} cents at 0 -> ${after.toFixed(1)} cents at 1 (re A3)`,
    );
    expect(Math.abs(before + 40)).toBeLessThan(5);
    expect(Math.abs(after)).toBeLessThan(10);
  });

  test('pitch targets steer the correction: key without a song clock, melody with one', async () => {
    // A♭ major has no A: the nearest scale note to the flat A is A♭ (MIDI 56). The melody
    // asks for B♭ (58), 1.4 semitones away, within the pull range, but only applies while the
    // backing track (the song clock) is playing.
    await page.evaluate(() => {
      window.__engineProbe.engine.setPitchTargets({
        notes: new Float32Array([0, 600, 58]),
        key: { tonic: 8, mode: 'major', confidence: 1 },
        tuningCents: 0,
      });
    });
    const keyOnly = steadyPitchCents(await captureVocal(page, { autotune: 1 }), 56);

    await page.evaluate(() => {
      const probe = window.__engineProbe;
      probe.setClickBacking({ durationSec: 30, intervalSec: 10, firstClickFrame: 0 });
      probe.engine.setMix({ backingVolume: 0 });
      probe.engine.startBacking();
    });
    const withMelody = steadyPitchCents(await captureVocal(page, { autotune: 1 }), 58);
    const meters = await page.evaluate(() => window.__engineProbe.latestMeters());
    await page.evaluate(() => {
      const { engine } = window.__engineProbe;
      engine.stopBacking();
      engine.setBackingTrack(null);
      engine.setPitchTargets(null);
      engine.setMix({ backingVolume: 0.8 });
    });
    console.log(
      `Pitch targets: key only -> ${keyOnly.toFixed(1)} cents from A♭3; melody -> ${withMelody.toFixed(1)} cents from B♭3`,
    );
    expect(Math.abs(keyOnly)).toBeLessThan(10);
    expect(Math.abs(withMelody)).toBeLessThan(10);
    expect(meters.targetMidi === null || Math.abs(meters.targetMidi - 58) < 0.01).toBe(true);
  });

  test('mic gain trims the recording; monitoring only affects the headphones', async () => {
    const unity = steadyLevelDb(await captureVocal(page, {}));
    await page.evaluate(() => window.__engineProbe.engine.setMix({ micGain: 0.5 }));
    const halved = steadyLevelDb(await captureVocal(page, {}));
    await page.evaluate(() => window.__engineProbe.engine.setMix({ micGain: 1 }));
    console.log(`Mic gain 0.5: ${(halved - unity).toFixed(2)} dB`);
    expect(Math.abs(halved - unity - 20 * Math.log10(0.5))).toBeLessThan(1);

    const heardOn = await page.evaluate(() => window.__engineProbe.monitorPeak(2100));
    await page.evaluate(() => window.__engineProbe.engine.setMix({ monitoringEnabled: false }));
    const unmonitored = steadyLevelDb(await captureVocal(page, {}));
    const heardOff = await page.evaluate(() => window.__engineProbe.monitorPeak(2100));
    await page.evaluate(() => window.__engineProbe.engine.setMix({ monitoringEnabled: true }));
    console.log(
      `Monitoring: heard peak on ${heardOn.toFixed(3)}, off ${heardOff.toFixed(5)}; stem ${(unmonitored - unity).toFixed(2)} dB`,
    );
    expect(heardOn).toBeGreaterThan(0.1);
    expect(heardOff).toBeLessThan(0.001);
    expect(Math.abs(unmonitored - unity)).toBeLessThan(0.3);
  });

  test('stop releases the microphone; start/stop cycles leave nothing behind', async () => {
    await page.evaluate(() => window.__engineProbe.engine.stop());
    const afterStop = await page.evaluate(() => ({
      running: window.__engineProbe.engine.isRunning,
      tracks: window.__engineProbe.microphoneTracks().map((track) => track.readyState),
      openContexts: window.__engineProbe.openContexts(),
    }));
    expect(afterStop.running).toBe(false);
    expect(afterStop.tracks.every((state) => state === 'ended')).toBe(true);
    expect(afterStop.openContexts).toBe(0);

    for (let cycle = 0; cycle < 3; cycle++) {
      await startEngine(page);
      expect((await observeMeters(page)).inputLevel).toBeGreaterThan(0.1);
      await page.evaluate(() => window.__engineProbe.engine.stop());
    }
    const afterCycles = await page.evaluate(() => ({
      tracks: window.__engineProbe.microphoneTracks().map((track) => track.readyState),
      openContexts: window.__engineProbe.openContexts(),
      errors: window.__engineProbe.errors,
    }));
    expect(afterCycles.tracks.every((state) => state === 'ended')).toBe(true);
    expect(afterCycles.openContexts).toBe(0);
    expect(afterCycles.errors).toEqual([]);

    // Restarting while running also works.
    await startEngine(page);
    await startEngine(page);
    const restarted = await page.evaluate(() => ({
      liveTracks: window.__engineProbe
        .microphoneTracks()
        .filter((track) => track.readyState === 'live').length,
      openContexts: window.__engineProbe.openContexts(),
    }));
    expect(restarted).toEqual({ liveTracks: 1, openContexts: 1 });
    await page.evaluate(() => window.__engineProbe.engine.stop());
  });

  test('no console errors', () => {
    expect(consoleErrors).toEqual([]);
  });
});
