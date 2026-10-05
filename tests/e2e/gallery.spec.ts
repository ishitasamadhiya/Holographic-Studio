import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/app';

// The component gallery (src/renderer/src/dev/gallery.tsx) doubles as the design system's
// test bench: this spec exercises the interactive components there and saves screenshots of
// the gallery and the composed mocks to test-results/gallery for visual review.

const screenshotDir = resolve(__dirname, '../../test-results/gallery');
type GalleryView = 'components' | 'studio' | 'wizard' | 'settings';

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ page: 'gallery.html' });
  page = launched.page;
  await expect(page.getByTestId('gallery-root')).toBeVisible();
});

test.afterAll(async () => {
  await launched?.close();
});

test.afterEach(async () => {
  await page.emulateMedia({ reducedMotion: null });
});

/**
 * Opens a gallery view on a freshly loaded page, so no test sees what another one left
 * behind (toasts, open layers, slider positions, injected styles).
 */
async function openView(view: GalleryView): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next === 'components' ? '' : next;
  }, view);
  await page.reload();
  await expect(page.getByTestId('gallery-root')).toHaveAttribute('data-view', view);
  // Park the pointer where it hovers nothing.
  await page.mouse.move(5, 300);
}

function screenshotPath(name: string): string {
  // Another Playwright run may have cleaned test-results in the meantime.
  mkdirSync(join(screenshotDir, 'sections'), { recursive: true });
  return join(screenshotDir, name);
}

function toasts(): Locator {
  return page.getByTestId('toast-viewport').getByTestId('toast');
}

async function sliderValue(slider: Locator): Promise<number> {
  return Number(await slider.getAttribute('aria-valuenow'));
}

/** Presses the mouse at one fraction of a slider's travel and releases it at another. */
async function dragSlider(slider: Locator, fromFraction: number, toFraction: number) {
  await slider.scrollIntoViewIfNeeded();
  const rail = await slider.locator('[data-slider-rail]').boundingBox();
  if (!rail) throw new Error('The slider rail is not visible');
  const y = rail.y + rail.height / 2;
  await page.mouse.move(rail.x + rail.width * fromFraction, y);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width * toFraction, y, { steps: 8 });
  await page.mouse.up();
}

/** Makes the exit animations (and the timers that wait for them) slow enough to act within. */
async function slowDownExits(durationMs: number): Promise<void> {
  await page.addStyleTag({ content: `:root { --duration-base: ${durationMs}ms; }` });
}

interface FocusRingReport {
  /** How many tab stops were focused. */
  checked: number;
  /** Tab stops that did not show the complete ring (outline plus halo) when focused. */
  missing: string[];
}

/**
 * Focuses every tab stop inside `scope` the way the keyboard would and reports those that
 * show no focus ring. The ring may be on the element itself or on a part of it (the slider
 * draws it around its thumb).
 */
async function scanFocusRings(scope: Locator): Promise<FocusRingReport> {
  // A real key press first: only then does programmatic focus count as keyboard focus.
  await page.keyboard.press('Shift');
  return scope.evaluate((root) => {
    const tabStops = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.checkVisibility({ visibilityProperty: true }),
    );
    const showsRing = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        style.outlineStyle === 'solid' &&
        parseFloat(style.outlineWidth) >= 2 &&
        // The dark gap of --focus-halo: proves the box-shadow part survived as well.
        style.boxShadow.includes('rgba(8, 8, 11, 0.9)')
      );
    };

    const missing: string[] = [];
    for (const element of tabStops) {
      element.focus({ preventScroll: true });
      const name =
        element.getAttribute('aria-label') ??
        element.getAttribute('data-testid') ??
        element.textContent?.trim().slice(0, 40) ??
        '';
      const description = `${element.tagName.toLowerCase()} "${name}"`;
      if (!element.matches(':focus-visible')) {
        missing.push(`${description} (did not take keyboard focus)`);
      } else if (![element, ...element.querySelectorAll('*')].some(showsRing)) {
        missing.push(description);
      }
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return { checked: tabStops.length, missing };
  });
}

/**
 * Lists the descendants of `container` that stick out of its right edge, plus the container
 * itself when its content is wider than its box. Empty means every line fits.
 */
function horizontalOverflow(container: Locator): Promise<string[]> {
  return container.evaluate((root) => {
    const overflowing: string[] = [];
    if (root.scrollWidth > root.clientWidth) {
      overflowing.push(`container (${root.scrollWidth} > ${root.clientWidth})`);
    }
    const right = root.getBoundingClientRect().right;
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > right + 0.5) {
        overflowing.push(`${element.tagName.toLowerCase()} "${element.textContent?.slice(0, 30)}"`);
      }
    }
    return overflowing;
  });
}

function appRegion(locator: Locator): Promise<string> {
  return locator.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('-webkit-app-region'),
  );
}

test.describe('component gallery', () => {
  test.beforeEach(async () => {
    await openView('components');
  });

  test('renders every component family', async () => {
    const testIds = [
      'section-foundations',
      'glass-regular-photo',
      'button-primary',
      'button-danger',
      'record-idle',
      'record-recording',
      'demo-slider',
      'demo-segmented',
      'demo-toggle',
      'demo-select',
      'demo-dropzone',
      'indicator-gesture-live',
      'indicator-manual',
      'demo-meter-horizontal',
      'demo-meter-vertical',
      'status-chip-ready',
      'demo-progress',
      'demo-banner',
      'demo-stepper',
      'icon-grid',
      'studio-mock',
      'wizard-card',
    ];
    for (const testId of testIds) {
      await expect(page.getByTestId(testId).first(), testId).toBeVisible();
    }

    // The icon set is complete enough to draw the whole app.
    expect(await page.getByTestId('icon-grid').locator('svg').count()).toBeGreaterThanOrEqual(25);
    await expect(page.getByTestId('record-countdown')).toHaveText(/^[123]$/);
    await expect(page.getByTestId('demo-select-empty')).toBeDisabled();
    await expect(page.getByTestId('demo-select-empty')).toContainText('No cameras found');
    // A field showing an error marks its control as invalid.
    await expect(page.getByTestId('demo-select-empty')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('demo-select')).not.toHaveAttribute('aria-invalid');
  });

  test('every tab stop shows a focus ring under keyboard focus', async () => {
    const report = await scanFocusRings(page.getByTestId('gallery-root'));
    // Buttons of every variant, record buttons in every state, sliders, switches, selects…
    expect(report.checked).toBeGreaterThan(60);
    expect(report.missing).toEqual([]);

    // The cases that once had no ring at all. Ghost buttons have no shadow of their own, and
    // the recording button animates while it is focused.
    for (const testId of ['button-ghost', 'record-recording', 'record-paused']) {
      const control = page.getByTestId(testId);
      await control.focus();
      await expect(control).toHaveCSS('outline-style', 'solid');
      await expect(control).toHaveCSS('outline-width', '2px');
      await expect(control).toHaveCSS('box-shadow', /rgba\(8, 8, 11, 0\.9\)/);
    }
    // The recording ripple still runs, on its own pseudo-element.
    const rippleAnimation = await page
      .getByTestId('record-recording')
      .evaluate((button) => getComputedStyle(button, '::after').animationName);
    expect(rippleAnimation).toContain('ripple');
  });

  test('slider responds to the keyboard', async () => {
    const slider = page.getByTestId('demo-slider');
    await slider.focus();
    expect(await sliderValue(slider)).toBe(0.35);

    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '0.36');
    await expect(slider).toHaveAttribute('aria-valuetext', '36%');

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '0.34');

    await page.keyboard.press('PageUp');
    await expect(slider).toHaveAttribute('aria-valuenow', '0.44');

    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');

    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
  });

  test('slider follows a pointer drag and settles on the unity detent', async () => {
    const slider = page.getByTestId('demo-slider');
    await dragSlider(slider, 0.1, 0.75);
    await expect.poll(() => sliderValue(slider)).toBeCloseTo(0.75, 1);

    // Released a little past the middle, the volume slider lands exactly on unity (0 dB).
    const volume = page.getByTestId('demo-slider-unity');
    await dragSlider(volume, 0.9, 0.512);
    await expect(volume).toHaveAttribute('aria-valuenow', '0.5');
    await expect(volume).toHaveAttribute('aria-valuetext', '0.0 dB');
    await expect(page.getByTestId('demo-slider-committed')).toHaveText('Last committed: 0.0 dB');
  });

  test('a field label names its control and passes clicks on to it', async () => {
    const rowSlider = page.getByRole('slider', { name: 'In a form row' });
    await expect(rowSlider).toHaveCount(1);
    await page.getByText('In a form row', { exact: true }).click();
    await expect(rowSlider).toBeFocused();

    // A native control is activated by its label without help: the switch toggles.
    const toggle = page.getByTestId('demo-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByText('Hear my voice', { exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('switch toggles with the mouse and the keyboard', async () => {
    const toggle = page.getByTestId('demo-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toHaveAccessibleName('Hear my voice');
    await expect(toggle).toHaveAccessibleDescription('Your processed voice in the headphones');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('segmented control selects by click and by arrow keys', async () => {
    const group = page.getByTestId('demo-segmented');
    const gesture = group.getByRole('radio', { name: 'Gesture' });
    const manual = group.getByRole('radio', { name: 'Manual' });
    await expect(group).toHaveAccessibleName('Control source');
    await expect(gesture).toHaveAttribute('aria-checked', 'true');

    await manual.click();
    await expect(manual).toHaveAttribute('aria-checked', 'true');
    await expect(gesture).toHaveAttribute('aria-checked', 'false');

    await page.keyboard.press('ArrowLeft');
    await expect(gesture).toHaveAttribute('aria-checked', 'true');
    await expect(gesture).toBeFocused();

    // Wraps around the end.
    await page.keyboard.press('ArrowLeft');
    await expect(manual).toHaveAttribute('aria-checked', 'true');
    await expect(manual).toBeFocused();
  });

  test('segmented control keeps a tab stop when its selection is disabled', async () => {
    const group = page.getByTestId('demo-segmented-disabled-selection');
    const video = group.getByRole('radio', { name: 'Video' });
    const audio = group.getByRole('radio', { name: 'Audio Only' });
    await expect(video).toHaveAttribute('aria-checked', 'true');
    await expect(video).toBeDisabled();

    // Tab from the group before it lands on the first enabled option.
    await page
      .getByRole('radiogroup', { name: 'Recording mode', exact: true })
      .getByRole('radio', { checked: true })
      .focus();
    await page.keyboard.press('Tab');
    await expect(audio).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(audio).toHaveAttribute('aria-checked', 'true');
  });

  test('select shows its placeholder until a device is chosen', async () => {
    const select = page.getByTestId('demo-select');
    await expect(select).toHaveValue('');
    await expect(select.locator('option:checked')).toHaveText('Choose a microphone…');

    await select.selectOption('scarlett');
    await expect(select).toHaveValue('scarlett');
    await expect(select.locator('option:checked')).toHaveText('Scarlett Solo USB');
  });

  test('meters and indicators update through their imperative handles', async () => {
    const driver = page.getByTestId('demo-meter-driver');
    const meter = page.getByTestId('demo-meter-horizontal');
    const indicator = page.getByTestId('demo-indicator');
    const cssVariable = (locator: Locator, name: string) =>
      locator.evaluate((element, property) => element.style.getPropertyValue(property), name);

    await expect(indicator).toContainText('64%');
    expect(await cssVariable(meter, '--meter-level')).toBe('0.640');
    // The picture is immediate; what screen readers are told is rate limited but must catch
    // up even when, as here, a single update is followed by silence.
    await expect(indicator).toHaveAttribute('aria-valuenow', '64');
    await expect(indicator).toHaveAttribute('aria-valuetext', '64%, Live');
    await expect(meter).toHaveAttribute('aria-valuenow', '64');

    await driver.focus();
    await page.keyboard.press('End');
    await expect(indicator).toContainText('100%');
    expect(await cssVariable(meter, '--meter-level')).toBe('1.000');
    expect(await cssVariable(indicator, '--indicator-value')).toBe('1.000');

    // The level drops at once; the peak marker holds where the signal was.
    await page.keyboard.press('Home');
    await expect(indicator).toContainText('0%');
    expect(await cssVariable(meter, '--meter-level')).toBe('0.000');
    expect(await cssVariable(meter, '--meter-peak')).toBe('1.000');
    await expect(indicator).toHaveAttribute('aria-valuenow', '0');
    await expect(indicator).toHaveAttribute('aria-valuetext', '0%, Live');
    await expect(meter).toHaveAttribute('aria-valuenow', '0');
  });

  test('an indicator with a dB readout keeps one line and the standard pill size', async () => {
    const decibels = page.getByTestId('demo-indicator-db');
    const percent = page.getByTestId('demo-indicator');
    await expect(decibels).toContainText('-12.0 dB');
    expect(await horizontalOverflow(decibels)).toEqual([]);
    const decibelsBox = await decibels.boundingBox();
    const percentBox = await percent.boundingBox();
    if (!decibelsBox || !percentBox) throw new Error('An indicator is not visible');
    expect(decibelsBox.width).toBe(percentBox.width);
    expect(decibelsBox.height).toBe(percentBox.height);
  });

  test('toasts appear, replace by id, run their action, and dismiss', async () => {
    await page.getByTestId('demo-toast-warning').click();
    await page.getByTestId('demo-toast-warning').click();
    await expect(toasts()).toHaveCount(1);
    await expect(toasts().first()).toContainText('Microphone disconnected');
    await expect(toasts().first()).toHaveAttribute('role', 'alert');

    // The action runs (it shows a follow-up toast) and the original toast goes away.
    await toasts().first().getByRole('button', { name: 'Settings' }).click();
    await expect(toasts()).toHaveCount(1);
    await expect(toasts().first()).toContainText('The app would open Settings here.');

    await page.getByTestId('demo-toast-error').click();
    const sticky = toasts().filter({ hasText: 'Hand tracking stopped' });
    await expect(sticky).toBeVisible();
    await sticky.getByRole('button', { name: 'Dismiss' }).click();
    await expect(sticky).toHaveCount(0);
  });

  test('a toast shown again while it is leaving stays on screen', async () => {
    // A long exit gives a wide, reliable window to re-show the toast in.
    const exitMs = 1500;
    await slowDownExits(exitMs);

    await page.getByTestId('demo-toast-warning').click();
    const toast = toasts().filter({ hasText: 'Microphone disconnected' });
    await expect(toast).toBeVisible();

    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toHaveClass(/leaving/);

    // The same problem is reported again before the old toast has finished leaving.
    await page.getByTestId('demo-toast-warning').click();
    await expect(toast).not.toHaveClass(/leaving/);

    // Well past the end of the old toast's exit, the new one is still there.
    await page.mouse.move(5, 300);
    await page.waitForTimeout(exitMs + 400);
    await expect(toast).toBeVisible();
    await expect(toasts()).toHaveCount(1);
  });

  test('a toast action may show a new toast under the same id', async () => {
    await page.getByTestId('demo-toast-retry').click();
    const failure = toasts().filter({ hasText: 'The video could not be saved' });
    await expect(failure).toBeVisible();

    // The retry fails at once and reports under the same id; that report must not be
    // swallowed by the dismissal of the toast whose button was pressed.
    await failure.getByRole('button', { name: 'Try again' }).click();
    const secondFailure = toasts().filter({ hasText: 'Still not saved (try 2)' });
    await expect(secondFailure).toBeVisible();
    await page.waitForTimeout(600);
    await expect(secondFailure).toBeVisible();
    await expect(secondFailure).not.toHaveClass(/leaving/);
    await expect(toasts()).toHaveCount(1);
  });

  test('a toast dismisses itself after its duration', async () => {
    await page.getByTestId('demo-toast-success').click();
    const saved = toasts().filter({ hasText: 'Video saved' });
    await expect(saved).toBeVisible();
    // Move the pointer away: hovering a toast pauses its timer.
    await page.mouse.move(5, 300);
    await expect(saved).toHaveCount(0, { timeout: 8000 });
  });

  test('settings sheet traps focus, closes with Escape, and restores focus', async () => {
    const trigger = page.getByTestId('demo-open-sheet');
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toHaveCount(0);

    await trigger.click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAccessibleName('Settings');

    const focusIsInside = () =>
      sheet.evaluate((element) => element.contains(document.activeElement));
    expect(await focusIsInside()).toBe(true);
    for (let presses = 0; presses < 30; presses += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside()).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await focusIsInside()).toBe(true);

    const monitoring = page.getByTestId('settings-monitoring-toggle');
    await monitoring.click();
    await expect(monitoring).toHaveAttribute('aria-checked', 'false');

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // A click on the dimmed area beside the sheet closes it as well.
    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(120, 400);
    await expect(sheet).toHaveCount(0);
  });

  test('focus trap holds when a layer ends or starts with a radio group', async () => {
    // A sheet without a footer whose last control is a radio group with its FIRST option
    // selected: the last focusable element in the DOM (the unselected radio) is then not a
    // tab stop. That is where focus used to walk out of the sheet.
    await page.getByTestId('demo-open-hand-sheet').click();
    const sheet = page.getByTestId('hand-sheet');
    await expect(sheet).toBeVisible();
    const focusedName = () =>
      page.evaluate(() => {
        const element = document.activeElement;
        const group = element?.closest('[role="radiogroup"]');
        const groupLabel = group?.getAttribute('aria-labelledby');
        const groupName = groupLabel ? document.getElementById(groupLabel)?.textContent : '';
        const own = element?.getAttribute('aria-label') ?? element?.textContent ?? '';
        return groupName ? `${groupName}: ${own}` : own;
      });
    const focusIsInside = () =>
      sheet.evaluate((element) => element.contains(document.activeElement));

    const visited: string[] = [];
    for (let presses = 0; presses < 9; presses += 1) {
      await page.keyboard.press('Tab');
      expect(await focusIsInside(), `after Tab press ${presses + 1}`).toBe(true);
      visited.push(await focusedName());
    }
    // One stop per radio group (its selected option), then round again.
    const cycle = ['Close', 'Autotune: Gesture', 'Vocal volume: Gesture', 'Echo: Gesture'];
    expect(visited).toEqual([...cycle, ...cycle, 'Close']);

    // Backwards from the first stop lands on the last real stop, not on the unselected radio.
    await page.keyboard.press('Shift+Tab');
    expect(await focusedName()).toBe('Echo: Gesture');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedName()).toBe('Vocal volume: Gesture');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // The mirror case: a dialog whose FIRST focusable element is an unselected radio.
    await page.getByTestId('demo-open-save-options').click();
    const dialog = page.getByTestId('save-options-dialog');
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Save' });
    const audioOnly = dialog.getByRole('radio', { name: 'Audio Only' });
    await expect(save).toBeFocused();
    await expect(audioOnly).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('Tab');
    await expect(audioOnly).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(audioOnly).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
  });

  test('toasts stay reachable by keyboard while a sheet is open', async () => {
    await page.getByTestId('demo-toast-error').click();
    const sticky = toasts().filter({ hasText: 'Hand tracking stopped' });
    await expect(sticky).toBeVisible();

    await page.getByTestId('demo-open-sheet').click();
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toBeVisible();

    // Tab through the sheet; the toast's button comes after the sheet's last control.
    const dismiss = sticky.getByRole('button', { name: 'Dismiss' });
    const isOnDismiss = () => dismiss.evaluate((button) => button === document.activeElement);
    let presses = 0;
    while (!(await isOnDismiss()) && presses < 40) {
      await page.keyboard.press('Tab');
      presses += 1;
      const isContained = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"], [data-testid="toast-viewport"]')),
      );
      expect(isContained, `after Tab press ${presses}`).toBe(true);
    }
    await expect(dismiss).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(sticky).toHaveCount(0);
    await expect(sheet).toBeVisible();

    // With the toast gone, Tab carries on inside the sheet.
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  });

  test('dialog focuses its safe action and closes with Escape or a choice', async () => {
    const dialog = page.getByTestId('discard-dialog');
    await page.getByTestId('demo-open-discard').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused();
    // A dialog blocks the window, including the drag strip it covers.
    expect(await appRegion(dialog.locator('xpath=..'))).toBe('no-drag');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByTestId('demo-open-saved').click();
    const saved = page.getByTestId('saved-dialog');
    await expect(saved).toBeVisible();
    await saved.getByRole('button', { name: 'Done' }).click();
    await expect(saved).toHaveCount(0);
  });

  test('exit animations follow the motion tokens and collapse for reduced motion', async () => {
    const trigger = page.getByTestId('demo-open-sheet');
    const sheet = page.getByTestId('settings-sheet');
    // Time from Escape to the sheet leaving the DOM, measured inside the page.
    const measureCloseMs = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolveElapsed) => {
            const panel = document.querySelector('[data-testid="settings-sheet"]');
            const startedAt = performance.now();
            const observer = new MutationObserver(() => {
              if (panel?.isConnected) return;
              observer.disconnect();
              resolveElapsed(performance.now() - startedAt);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          }),
      );
    const baseDuration = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim(),
      );
    const animationName = (locator: Locator, pseudo?: string) =>
      locator.evaluate(
        (element, pseudoElement) => getComputedStyle(element, pseudoElement).animationName,
        pseudo,
      );

    expect(await baseDuration()).toBe('200ms');
    await trigger.click();
    await expect(sheet).toBeVisible();
    const normalMs = await measureCloseMs();
    expect(normalMs).toBeGreaterThanOrEqual(190);
    expect(normalMs).toBeLessThan(450);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await baseDuration()).toBe('0.01ms');
    await trigger.click();
    await expect(sheet).toBeVisible();
    expect(await measureCloseMs()).toBeLessThan(100);

    // Looping motion is replaced by a gentle fade or removed.
    const spinner = page.getByTestId('status-chip-busy').locator('[class*="spinner"]');
    expect(await animationName(spinner)).toContain('breathe');
    expect(await animationName(page.getByTestId('record-recording'), '::after')).toBe('none');
    expect(await animationName(page.getByTestId('chip-recording').locator('[class*="dot"]'))).toBe(
      'none',
    );

    await page.emulateMedia({ reducedMotion: null });
    expect(await animationName(spinner)).toContain('spin');
  });

  test('stepper marks the current step for assistive technology', async () => {
    const stepper = page.getByTestId('demo-stepper');
    await expect(stepper.locator('[aria-current="step"]')).toHaveText(
      'Step 3 of 5: Your song (current step)',
    );
    await page.getByTestId('demo-stepper-next').click();
    await expect(stepper.locator('[aria-current="step"]')).toHaveText(
      'Step 4 of 5: Hand controls (current step)',
    );
    await expect(stepper.locator('[data-state="done"]')).toHaveCount(3);
  });

  test('file drop zone browses on click, accepts audio files and rejects others', async () => {
    const zone = page.getByTestId('demo-dropzone');
    const dispatchDrag = (eventNames: string[], fileName: string) =>
      zone.evaluate(
        (element, { names, name }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(['audio'], name));
          for (const eventName of names) {
            element.dispatchEvent(
              new DragEvent(eventName, { bubbles: true, cancelable: true, dataTransfer: transfer }),
            );
          }
        },
        { names: eventNames, name: fileName },
      );

    await expect(zone).toHaveAttribute('data-state', 'empty');
    await zone.getByRole('button', { name: 'Choose Backing track' }).click();
    await expect(toasts().filter({ hasText: 'open the file dialog' })).toBeVisible();

    // Hovering with a file highlights the zone; leaving clears the highlight.
    await dispatchDrag(['dragenter', 'dragover'], 'My Song.MP3');
    await expect(zone).toHaveAttribute('data-drag-over', 'true');
    await expect(zone).toContainText('Drop to use this file');
    await dispatchDrag(['dragleave'], 'My Song.MP3');
    await expect(zone).not.toHaveAttribute('data-drag-over');

    await dispatchDrag(['dragenter', 'dragover', 'drop'], 'notes.txt');
    await expect(zone).toHaveAttribute('data-state', 'empty');
    await expect(toasts().filter({ hasText: '“notes.txt” is not an audio file.' })).toBeVisible();

    await dispatchDrag(['dragenter', 'dragover', 'drop'], 'My Song.MP3');
    await expect(zone).toHaveAttribute('data-state', 'ready');
    await expect(zone).toContainText('My Song.MP3');
    await expect(zone).not.toHaveAttribute('data-drag-over');

    await zone.getByRole('button', { name: 'Remove Backing track' }).click();
    await expect(zone).toHaveAttribute('data-state', 'empty');
  });

  test('long file names wrap inside toasts, dialogs, banners and drop zones', async () => {
    const longName =
      'Artist_Name_-_A_Very_Long_Song_Title_(Official_Instrumental_Karaoke_Version)_final_mix_v2.txt';

    // The real path: a rejected drop reports the file name in a toast.
    const zone = page.getByTestId('demo-dropzone');
    await zone.evaluate((element, name) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['text'], name));
      for (const eventName of ['dragenter', 'dragover', 'drop']) {
        element.dispatchEvent(
          new DragEvent(eventName, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
    }, longName);
    const rejected = toasts().filter({ hasText: 'is not an audio file' });
    await expect(rejected).toBeVisible();
    expect(await horizontalOverflow(rejected)).toEqual([]);

    for (const testId of [
      'demo-toast-long-name',
      'demo-banner-long-name',
      'demo-dropzone-long-name',
    ]) {
      expect(await horizontalOverflow(page.getByTestId(testId)), testId).toEqual([]);
    }

    await page.getByTestId('demo-open-saved-long-name').click();
    const dialog = page.getByTestId('saved-dialog');
    await expect(dialog).toContainText('Official_Instrumental');
    expect(await horizontalOverflow(dialog)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('toasts step aside while a dialog is open', async () => {
    await page.getByTestId('demo-toast-success').click();
    await page.getByTestId('demo-toast-warning').click();
    await page.getByTestId('demo-toast-error').click();
    await expect(toasts()).toHaveCount(3);

    await page.getByTestId('demo-open-saved').click();
    const dialog = page.getByTestId('saved-dialog');
    await expect(dialog).toBeVisible();
    // Only the newest toast stays visible, and it does not cover the dialog.
    const visible = toasts().filter({ visible: true });
    await expect(visible).toHaveCount(1);
    await expect(visible).toContainText('Hand tracking stopped');
    const toastBox = await visible.boundingBox();
    const dialogBox = await dialog.boundingBox();
    if (!toastBox || !dialogBox) throw new Error('The toast or the dialog is not visible');
    expect(toastBox.y).toBeGreaterThanOrEqual(dialogBox.y + dialogBox.height);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(toasts().filter({ visible: true })).toHaveCount(3);
  });

  test('a dialog without dismiss keeps focus and swallows Escape', async () => {
    await page.evaluate(() => {
      const counts = { escape: 0 };
      (window as unknown as { escapeCounts: typeof counts }).escapeCounts = counts;
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') counts.escape += 1;
      });
    });
    await page.getByTestId('demo-open-exporting').click();
    const dialog = page.getByTestId('exporting-dialog');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { escapeCounts: { escape: number } }).escapeCounts.escape,
      ),
    ).toBe(0);

    // A click on the scrim neither closes the dialog nor takes focus out of it.
    await page.mouse.click(8, 300);
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();

    await cancel.click();
    await expect(dialog).toHaveCount(0);
  });

  test('saves screenshots of the gallery', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const hideHeader = '[data-testid="gallery-header"] { visibility: hidden; }';

    await page.screenshot({ path: screenshotPath('gallery-top.png'), animations: 'disabled' });
    await page.screenshot({
      path: screenshotPath('gallery-full.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // The sections are centred on the window, not on the scrollable area, so they do not
    // move when the capture hides the document scrollbar.
    const sectionsOffCentre = await page.getByTestId('section-foundations').evaluate((section) => {
      const box = section.getBoundingClientRect();
      return box.left + box.width / 2 - window.innerWidth / 2;
    });
    expect(Math.abs(sectionsOffCentre)).toBeLessThanOrEqual(1);

    const sections = await page.locator('[data-testid^="section-"]').all();
    expect(sections.length).toBeGreaterThanOrEqual(10);
    for (const section of sections) {
      const testId = await section.getAttribute('data-testid');
      await section.screenshot({
        path: screenshotPath(`sections/${testId?.replace('section-', '')}.png`),
        animations: 'disabled',
        // The sticky header would otherwise cover the top of tall sections.
        style: hideHeader,
      });
    }

    // Keyboard focus: on glass, on a ghost button (which has no shadow of its own), on the
    // record button mid-take, and on the slider thumb.
    await page.getByTestId('button-primary').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('button-secondary')).toBeFocused();
    await page.getByTestId('section-buttons').screenshot({
      path: screenshotPath('sections/focus-button.png'),
      style: hideHeader,
    });
    await page.getByTestId('button-ghost').focus();
    await page.getByTestId('section-buttons').screenshot({
      path: screenshotPath('sections/focus-ghost-button.png'),
      style: hideHeader,
    });
    await page.getByTestId('record-recording').focus();
    await page.getByTestId('section-buttons').screenshot({
      path: screenshotPath('sections/focus-record-button.png'),
      style: hideHeader,
    });
    // On pure white the pale ring depends on its dark rim.
    await page.getByTestId('button-on-white').focus();
    await page.getByTestId('section-buttons').screenshot({
      path: screenshotPath('sections/focus-on-white.png'),
      style: hideHeader,
    });
    await page.getByTestId('demo-slider').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.getByTestId('section-inputs').screenshot({
      path: screenshotPath('sections/focus-slider.png'),
      style: hideHeader,
    });

    // Transient layers: a tooltip, the toast stack, and a dialog.
    await page.getByTestId('demo-tooltip-target').hover();
    await page.waitForTimeout(700);
    await page.getByTestId('section-overlays').screenshot({
      path: screenshotPath('sections/tooltip.png'),
      style: hideHeader,
    });

    await page.getByTestId('demo-toast-success').click();
    await page.getByTestId('demo-toast-warning').click();
    await page.getByTestId('demo-toast-error').click();
    await expect(toasts()).toHaveCount(3);
    await page.screenshot({ path: screenshotPath('toasts.png'), animations: 'disabled' });

    await page.getByTestId('demo-open-discard').click();
    await expect(page.getByTestId('discard-dialog')).toBeVisible();
    await page.screenshot({ path: screenshotPath('dialog.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('discard-dialog')).toHaveCount(0);

    await page.getByTestId('demo-open-save-options').click();
    await expect(page.getByTestId('save-options-dialog')).toBeVisible();
    await page.screenshot({ path: screenshotPath('dialog-options.png'), animations: 'disabled' });
  });
});

test.describe('composed mocks', () => {
  test('studio mock: transport, hand control and settings sheet', async () => {
    await openView('studio');
    const record = page.getByTestId('studio-record-button');
    const autotune = page.getByTestId('studio-indicator-autotune');
    await expect(page.getByTestId('studio-transport')).toBeVisible();
    await expect(page.getByTestId('studio-indicator-echo')).toBeVisible();
    await expect(page.getByTestId('studio-indicator-volume')).toContainText('50%');
    await expect(record).toHaveAttribute('data-state', 'recording');
    await expect(record).toHaveAccessibleName('Stop recording');

    await page.screenshot({
      path: screenshotPath('studio.png'),
      style: '[data-testid="gallery-back"] { visibility: hidden; }',
    });

    // The top-centre chips sit on the same centre line as the transport below them.
    const centreX = async (testId: string) => {
      const box = await page.getByTestId(testId).boundingBox();
      if (!box) throw new Error(`${testId} is not visible`);
      return box.x + box.width / 2;
    };
    expect(
      Math.abs((await centreX('studio-top-center')) - (await centreX('studio-transport'))),
    ).toBeLessThanOrEqual(1);

    // Inside a Tooltip the bubble is the only hint: no native title on top of it.
    await expect(page.getByTestId('studio-hand-toggle')).not.toHaveAttribute('title');
    await expect(page.getByTestId('studio-settings-button')).toHaveAttribute('title', 'Settings');

    // Every control on the live screen shows a focus ring, including the ghost buttons of
    // the transport and the record button while a take is running.
    const rings = await scanFocusRings(page.getByTestId('studio-mock'));
    expect(rings.checked).toBeGreaterThanOrEqual(5);
    expect(rings.missing).toEqual([]);

    // Hand control off: gesture-driven indicators switch to their manual style.
    await expect(autotune).toHaveAttribute('data-status', 'gesture-live');
    await page.getByTestId('studio-hand-toggle').click();
    await expect(autotune).toHaveAttribute('data-status', 'manual');
    await expect(autotune).toHaveAttribute('aria-valuetext', /, Manual$/);
    await page.getByTestId('studio-hand-toggle').click();

    // Pause and resume, then stop and start a new take through the countdown.
    const pause = page.getByTestId('studio-pause-button');
    await pause.click();
    await expect(record).toHaveAttribute('data-state', 'paused');
    await expect(pause).toHaveAccessibleName('Resume');
    await pause.click();
    await expect(record).toHaveAttribute('data-state', 'recording');

    await record.click();
    await expect(record).toHaveAttribute('data-state', 'idle');
    await expect(record).toHaveAccessibleName('Start recording');
    await expect(pause).toBeDisabled();
    await page.mouse.move(5, 300);
    await page.screenshot({
      path: screenshotPath('studio-idle.png'),
      animations: 'disabled',
      style: '[data-testid="gallery-back"] { visibility: hidden; }',
    });

    await record.click();
    await expect(record).toHaveAttribute('data-state', 'countdown');
    await expect(record).toHaveText('3');
    await expect(record).toHaveAttribute('data-state', 'recording', { timeout: 6000 });

    await page.getByTestId('studio-settings-button').click();
    await expect(page.getByTestId('settings-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  });

  test('wizard mock', async () => {
    await openView('wizard');
    await expect(page.getByTestId('wizard-card')).toBeVisible();
    await expect(page.getByTestId('wizard-backing-zone')).toContainText(
      'Midnight City (Instrumental).mp3',
    );
    await expect(page.getByTestId('wizard-stepper').locator('[aria-current="step"]')).toHaveText(
      /Step 3 of 5/,
    );
    await page.screenshot({
      path: screenshotPath('wizard.png'),
      animations: 'disabled',
      style: '[data-testid="gallery-back"] { visibility: hidden; }',
    });
  });

  test('settings sheet over the studio', async () => {
    await openView('settings');
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Microphone' })).toHaveValue('scarlett');
    await page.screenshot({
      path: screenshotPath('settings-sheet.png'),
      animations: 'disabled',
      style: '[data-testid="gallery-back"] { visibility: hidden; }',
    });

    const rings = await scanFocusRings(sheet);
    expect(rings.checked).toBeGreaterThan(12);
    expect(rings.missing).toEqual([]);
    await sheet.getByRole('button', { name: 'Close' }).focus();
    await page.screenshot({
      path: screenshotPath('focus-sheet-close.png'),
      style: '[data-testid="gallery-back"] { visibility: hidden; }',
    });

    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('overlays are not dragged through where they cover the window drag strip', async () => {
    await openView('settings');
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toBeVisible();
    const topBar = page.getByTestId('studio-top-bar');
    const close = sheet.getByRole('button', { name: 'Close' });
    const box = async (locator: Locator) => {
      const rect = await locator.boundingBox();
      if (!rect) throw new Error('Element is not visible');
      return rect;
    };

    // The top bar moves the window, and the sheet's Close button lies inside its rectangle.
    expect(await appRegion(topBar)).toBe('drag');
    const barBox = await box(topBar);
    const closeBox = await box(close);
    expect(closeBox.y).toBeLessThan(barBox.y + barBox.height);
    expect(closeBox.x).toBeGreaterThan(barBox.x);

    // Chromium subtracts no-drag rectangles from the drag area whatever their stacking
    // order, so the sheet's full-window layer keeps the button clickable.
    const layer = sheet.locator('xpath=..');
    expect(await appRegion(layer)).toBe('no-drag');
    const layerBox = await box(layer);
    expect(layerBox.x).toBeLessThanOrEqual(closeBox.x);
    expect(layerBox.y).toBeLessThanOrEqual(closeBox.y);
    expect(layerBox.x + layerBox.width).toBeGreaterThanOrEqual(closeBox.x + closeBox.width);
    expect(layerBox.y + layerBox.height).toBeGreaterThanOrEqual(closeBox.y + closeBox.height);

    // Controls inside the strip itself are excluded as well.
    expect(await appRegion(page.getByTestId('studio-settings-button'))).toBe('no-drag');
    await close.click();
    await expect(sheet).toHaveCount(0);

    // Toasts appear right under the strip and can overlap it.
    await openView('components');
    await page.getByTestId('demo-toast-error').click();
    await expect(toasts().first()).toBeVisible();
    expect(await appRegion(toasts().first())).toBe('no-drag');
  });
});
