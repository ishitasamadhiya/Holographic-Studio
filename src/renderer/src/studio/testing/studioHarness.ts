// A Studio wired to fakes for every dependency, plus the handles a test needs to drive it.
import { syntheticFrame, syntheticHand } from '@gestures/testing/syntheticHand';
import { FakeHoloApi, loadedFile } from '@renderer/recording/testing/fakeApi';
import { FakeClock } from '@renderer/recording/testing/fakeClock';
import { FakeEngine } from '@renderer/recording/testing/fakeEngine';
import { FakeVideoRecorderFactory } from '@renderer/recording/testing/fakeVideoRecorder';
import type { StudioState } from '@renderer/state/studioTypes';
import type { DeepPartial, Settings } from '@shared/settings';
import { mergeSettings } from '@shared/settingsSchema';
import { createStudio } from '../createStudio';
import {
  FakeAnalysisClient,
  FakeHandTracker,
  FakeMediaDevices,
  fakeVideoElement,
} from './fakeEnvironment';

export const ARTWORK_BYTES = new Uint8Array([1, 2, 3]).buffer;

export function createStudioHarness(settings: DeepPartial<Settings> = {}) {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock);
  const api = new FakeHoloApi();
  api.storedSettings = mergeSettings(api.storedSettings, settings);
  api.files.set('/songs/backing.wav', loadedFile('/songs/backing.wav', 'sha-backing', 30_000));
  api.files.set('/songs/other.wav', loadedFile('/songs/other.wav', 'sha-other', 20_000));
  api.files.set('/songs/reference.mp3', loadedFile('/songs/reference.mp3', 'sha-ref', 40_000));
  api.files.set('/songs/reference2.mp3', loadedFile('/songs/reference2.mp3', 'sha-ref2', 40_000));
  const mediaDevices = new FakeMediaDevices();
  const tracker = new FakeHandTracker();
  const analysis = new FakeAnalysisClient();
  const recorders = new FakeVideoRecorderFactory(clock);
  const studio = createStudio({
    api: api.api,
    createAudioEngine: () => engine,
    createHandTracker: () => tracker,
    createAnalysisClient: () => analysis,
    mediaDevices,
    clock,
    videoRecorders: recorders,
    renderTakeArtwork: async () => ARTWORK_BYTES,
    now: () => new Date(2026, 9, 5, 14, 30),
  });
  const { actions, live } = studio;

  const state = (): StudioState => studio.store.getState();

  /** Lets queued promise work (saves, device switches, loads) finish. */
  const settle = (): Promise<void> => clock.advance(0);

  /** Runs `count` display frames, `everyMs` apart, calling `beforeFrame` before each. */
  const runFrames = async (
    count: number,
    everyMs = 33,
    beforeFrame: (index: number) => void = () => undefined,
  ): Promise<void> => {
    for (let index = 0; index < count; index++) {
      beforeFrame(index);
      await clock.runFrame(everyMs);
    }
  };

  /** A tracker frame showing the right hand (open unless `closure` says otherwise). */
  const emitRightHand = (closure = 0, palmScale = 0.18): void => {
    tracker.emitFrame(
      syntheticFrame(clock.nowMs(), [syntheticHand({ side: 'right', closure, palmScale })]),
    );
  };

  /** Initializes straight into the studio with a camera preview attached. */
  const openStudio = async (): Promise<HTMLVideoElement> => {
    await actions.initialize();
    const preview = fakeVideoElement();
    actions.attachPreview(preview);
    await settle();
    return preview;
  };

  return {
    clock,
    engine,
    api,
    mediaDevices,
    tracker,
    analysis,
    recorders,
    studio,
    actions,
    live,
    state,
    settle,
    runFrames,
    emitRightHand,
    openStudio,
  };
}

export type StudioHarness = ReturnType<typeof createStudioHarness>;
