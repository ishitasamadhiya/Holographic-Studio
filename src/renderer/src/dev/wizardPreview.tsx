// Developer page: the setup wizard rendered against fixed state, one step and variant at a
// time. It is never linked from the app. Open it with HOLO_E2E_PAGE=wizard-preview.html and
// choose what to show in the URL hash, e.g. #step=1&variant=denied (the step is a number
// from 1 to 11 or a step id; variants are listed in features/wizard/preview/fixtures.ts).
//
// The fixture is exposed as window.__staticStudio: tests read `calls` to see which actions
// the wizard invoked, change `store` and `live` to play the app's part, and set
// `outcomes` to decide what an action reports back.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WizardScreen } from '@renderer/features/wizard';
import {
  parsePreviewHash,
  previewFixture,
  type WizardPreviewFixture,
} from '@renderer/features/wizard/preview/fixtures';
import { standInCameraStream } from '@renderer/features/wizard/preview/standInCamera';
import { createStaticStudio, type StaticStudio } from '@renderer/state/staticStudio';
import { StudioProvider } from '@renderer/state/studioContext';
import type { StudioActions } from '@renderer/state/studioTypes';

interface PreviewOutcomes {
  /** What calibrateHandDistance resolves to. */
  calibrationSucceeds: boolean;
}

export interface WizardPreviewStudio extends StaticStudio {
  fixture: Pick<WizardPreviewFixture, 'step' | 'variant'>;
  outcomes: PreviewOutcomes;
}

type RecordedAction = (...args: unknown[]) => Promise<unknown>;

/**
 * The static studio's actions only record their calls. The preview adds the two things a
 * recording alone cannot show: a picture in the camera preview and a calibration result.
 */
function withPreviewBehaviour(actions: StudioActions, outcomes: PreviewOutcomes): StudioActions {
  return new Proxy(actions, {
    get(target, property, receiver) {
      const record = Reflect.get(target, property, receiver) as RecordedAction;
      return (...args: unknown[]) => {
        const recorded = record(...args);
        if (property === 'attachPreview') {
          const [element] = args;
          if (element instanceof HTMLVideoElement) element.srcObject = standInCameraStream();
        }
        if (property === 'calibrateHandDistance') {
          return Promise.resolve(outcomes.calibrationSucceeds);
        }
        return recorded;
      };
    },
  });
}

function createPreviewStudio(fixture: WizardPreviewFixture): WizardPreviewStudio {
  const studio = createStaticStudio(fixture.state, fixture.live);
  const outcomes: PreviewOutcomes = { calibrationSucceeds: fixture.calibrationSucceeds };
  return {
    ...studio,
    actions: withPreviewBehaviour(studio.actions, outcomes),
    fixture: { step: fixture.step, variant: fixture.variant },
    outcomes,
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from wizard-preview.html');
const root = createRoot(container);
let renderCount = 0;

/** Builds the fixture named by the URL hash and shows the wizard on it, from scratch. */
function showSelectedFixture(): void {
  const fixture = previewFixture(parsePreviewHash(window.location.hash));
  const studio = createPreviewStudio(fixture);
  Object.assign(window, { __staticStudio: studio });
  renderCount += 1;

  root.render(
    <StrictMode>
      <div
        key={renderCount}
        style={{ height: '100%' }}
        data-testid="wizard-preview"
        data-fixture={`${fixture.step}/${fixture.variant}`}
      >
        <StudioProvider studio={studio}>
          <WizardScreen initialStep={fixture.step} />
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
