import { describe, expect, it } from 'vitest';
import { createInitialLiveReadouts } from '@renderer/state/staticStudio';
import { animateLive, parseFixtureHash, STUDIO_FIXTURE_IDS, studioFixture } from './studioFixtures';

describe('parseFixtureHash', () => {
  it('reads the state from the hash', () => {
    expect(parseFixtureHash('#state=recording')).toBe('recording');
    expect(parseFixtureHash('state=review-error&x=1')).toBe('review-error');
  });

  it('falls back to the idle studio for anything unknown', () => {
    expect(parseFixtureHash('')).toBe('idle');
    expect(parseFixtureHash('#state=nonsense')).toBe('idle');
  });
});

describe('studioFixture', () => {
  it('builds every fixture on top of a running studio', () => {
    for (const id of STUDIO_FIXTURE_IDS) {
      const fixture = studioFixture(id);
      expect(fixture.id).toBe(id);
      expect(fixture.state.phase).toBe('studio');
      expect(fixture.state.permissions?.microphone).toBeDefined();
    }
  });

  it('keeps the base state where a fixture changes only part of an object', () => {
    const denied = studioFixture('camera-denied').state;
    expect(denied.permissions).toEqual({ microphone: 'granted', camera: 'denied' });
    expect(denied.camera?.status).toBe('error');
    expect(denied.engine?.status).toBe('running');
  });

  it('opens the panels the screen should start with', () => {
    expect(studioFixture('controls').overlay).toBe('controls');
    expect(studioFixture('settings').overlay).toBe('settings');
    expect(studioFixture('idle').overlay).toBeNull();
  });
});

describe('animateLive', () => {
  it('runs the take clock only while recording', () => {
    const live = createInitialLiveReadouts();
    animateLive(live, 1, 0.5, false);
    expect(live.recordingElapsedSec).toBe(0);
    animateLive(live, 1.5, 0.5, true);
    expect(live.recordingElapsedSec).toBe(0.5);
  });

  it('keeps every control and level within 0..1', () => {
    const live = createInitialLiveReadouts();
    for (let time = 0; time < 30; time += 0.37) {
      animateLive(live, time, 0.37, false);
      for (const value of [...Object.values(live.controls), live.inputLevel, live.outputLevel]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('moves tracked hands and leaves missing ones alone', () => {
    const tracked = { ...createInitialLiveReadouts(), ...studioFixture('landmarks').live };
    animateLive(tracked, 2, 0.016, false);
    expect(tracked.gesture?.right.landmarks).toHaveLength(21);
    expect(tracked.gesture?.left.status).toBe('tracking');

    const untracked = createInitialLiveReadouts();
    animateLive(untracked, 2, 0.016, false);
    expect(untracked.gesture).toBeNull();
  });
});
