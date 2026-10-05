import { describe, expect, it } from 'vitest';
import { DEFAULT_MIC_CHECK, MicCheck, type MicCheckStatus } from './micCheck';

const FRAME_MS = 16;
const QUIET = 0.004;
const VOICE = 0.3;

/** Feeds a constant level for `durationMs`, one animation frame at a time. */
function feed(check: MicCheck, level: number, fromMs: number, durationMs: number): MicCheckStatus {
  let status: MicCheckStatus = 'listening';
  for (let elapsed = 0; elapsed <= durationMs; elapsed += FRAME_MS) {
    status = check.update(level, fromMs + elapsed);
  }
  return status;
}

describe('MicCheck', () => {
  it('keeps listening while the room is quiet', () => {
    expect(feed(new MicCheck(), QUIET, 0, 3000)).toBe('listening');
  });

  it('hears a voice once the level has clearly been up for a moment', () => {
    const check = new MicCheck();
    feed(check, QUIET, 0, 500);
    expect(feed(check, VOICE, 500, DEFAULT_MIC_CHECK.voiceMs - 100)).toBe('listening');
    expect(feed(check, VOICE, 500 + DEFAULT_MIC_CHECK.voiceMs - 100, 150)).toBe('heard');
  });

  it('adds up syllables separated by short pauses', () => {
    const check = new MicCheck();
    feed(check, VOICE, 0, 160);
    feed(check, QUIET, 160, 200);
    expect(feed(check, VOICE, 360, 200)).toBe('heard');
  });

  it('does not add up separate clicks and bumps', () => {
    const check = new MicCheck();
    let status: MicCheckStatus = 'listening';
    for (let click = 0; click < 5; click += 1) {
      const startMs = click * 1000;
      feed(check, VOICE, startMs, 100);
      status = feed(check, QUIET, startMs + 100, 900);
    }
    expect(status).toBe('listening');
  });

  it('ignores levels below the voice threshold however long they last', () => {
    const justBelow = DEFAULT_MIC_CHECK.voiceLevel * 0.9;
    expect(feed(new MicCheck(), justBelow, 0, 5000)).toBe('listening');
  });

  it('reports silence after a while, and still hears a voice afterwards', () => {
    const check = new MicCheck();
    expect(feed(check, QUIET, 0, DEFAULT_MIC_CHECK.silentAfterMs - 100)).toBe('listening');
    expect(feed(check, QUIET, DEFAULT_MIC_CHECK.silentAfterMs - 100, 200)).toBe('silent');
    expect(feed(check, VOICE, DEFAULT_MIC_CHECK.silentAfterMs + 200, 400)).toBe('heard');
  });

  it('stays heard once a voice was heard', () => {
    const check = new MicCheck();
    feed(check, VOICE, 0, 400);
    expect(feed(check, 0, 400, 20_000)).toBe('heard');
  });

  it('does not count a stalled frame as a long stretch of sound', () => {
    const check = new MicCheck();
    check.update(VOICE, 0);
    // The window was hidden for two seconds between two loud frames.
    expect(check.update(VOICE, 2000)).toBe('listening');
  });

  it('treats a broken reading as silence', () => {
    expect(feed(new MicCheck(), Number.NaN, 0, 1000)).toBe('listening');
  });

  it('honours custom thresholds', () => {
    const check = new MicCheck({ voiceLevel: 0.5, voiceMs: 50, gapMs: 100, silentAfterMs: 500 });
    expect(feed(check, VOICE, 0, 400)).toBe('listening');
    expect(feed(check, VOICE, 400, 200)).toBe('silent');
    expect(feed(check, 0.8, 600, 80)).toBe('heard');
  });
});
