// Developer page: the studio screen rendered against fixed state, one fixture at a time. It
// is never linked from the app. Open it with HOLO_E2E_PAGE=studio-preview.html and choose
// what to show in the URL hash, e.g. #state=recording (the ids are listed in
// features/studio/fixtures/studioFixtures.ts).
//
// The fixture is exposed as window.__staticStudio: tests read `calls` to see which actions
// the screen invoked, change `store` and `live` to play the app's part, and set
// `animation.running` to false to hold the live readouts still.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioScreen } from '@renderer/features/studio';
import { busyBackdropStream } from '@renderer/features/studio/fixtures/busyBackdrop';
import {
  animateLive,
  parseFixtureHash,
  studioFixture,
  type StudioFixtureId,
} from '@renderer/features/studio/fixtures/studioFixtures';
import { createStaticStudio, type StaticStudio } from '@renderer/state/staticStudio';
import { StudioProvider } from '@renderer/state/studioContext';
import type { StudioActions } from '@renderer/state/studioTypes';

export interface StudioPreviewStudio extends StaticStudio {
  fixture: StudioFixtureId;
  /** Whether the live readouts are being moved like a performance. */
  animation: { running: boolean };
}

type RecordedAction = (...args: unknown[]) => Promise<unknown>;

/** The static studio only records calls; the preview also gives the camera a picture. */
function withStandInCamera(actions: StudioActions): StudioActions {
  return new Proxy(actions, {
    get(target, property, receiver) {
      const record = Reflect.get(target, property, receiver) as RecordedAction;
      return (...args: unknown[]) => {
        const recorded = record(...args);
        const [element] = args;
        if (property === 'attachPreview' && element instanceof HTMLVideoElement) {
          element.srcObject = busyBackdropStream();
        }
        return recorded;
      };
    },
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from studio-preview.html');
const root = createRoot(container);
let renderCount = 0;
let stopAnimation: (() => void) | null = null;

/** Moves the fixture's live readouts every frame while `animation.running` is true. */
function startAnimation(studio: StudioPreviewStudio): () => void {
  let frameId = 0;
  let previousMs = performance.now();
  const startMs = previousMs;
  const tick = (nowMs: number) => {
    if (studio.animation.running) {
      const recording = studio.store.getState().recording.status === 'recording';
      animateLive(studio.live, (nowMs - startMs) / 1000, (nowMs - previousMs) / 1000, recording);
    }
    previousMs = nowMs;
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frameId);
}

/** Builds the fixture named by the URL hash and shows the studio on it, from scratch. */
function showSelectedFixture(): void {
  const fixture = studioFixture(parseFixtureHash(window.location.hash));
  const base = createStaticStudio(fixture.state, fixture.live);
  const studio: StudioPreviewStudio = {
    ...base,
    actions: withStandInCamera(base.actions),
    fixture: fixture.id,
    animation: { running: fixture.animate },
  };
  Object.assign(window, { __staticStudio: studio });

  stopAnimation?.();
  stopAnimation = startAnimation(studio);
  renderCount += 1;

  root.render(
    <StrictMode>
      <div
        key={renderCount}
        style={{ height: '100%' }}
        data-testid="studio-preview"
        data-fixture={fixture.id}
      >
        <StudioProvider studio={studio}>
          <StudioScreen initialOverlay={fixture.overlay ?? undefined} />
        </StudioProvider>
      </div>
    </StrictMode>,
  );
}

// Window buttons are drawn over the content on macOS only; the design system reads this.
window.holo?.app
  .getInfo()
  .then((info) => {
    document.documentElement.dataset.platform = info.platform;
  })
  .catch(() => undefined);

showSelectedFixture();
window.addEventListener('hashchange', showSelectedFixture);
