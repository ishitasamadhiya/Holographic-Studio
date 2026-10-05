// Decides, from the microphone level alone, when the wizard may say "We can hear you".
// Pure and clock-injected so it can be tested without audio.

export type MicCheckStatus =
  /** Nothing conclusive yet. */
  | 'listening'
  /** A voice was clearly picked up. Final: it never goes back. */
  | 'heard'
  /** Still nothing after a while; time for a gentle hint. */
  | 'silent';

export interface MicCheckOptions {
  /** Peak level (linear, 0..1) that counts as a voice rather than room noise. */
  voiceLevel: number;
  /** How long the level must be up, in total, before a voice counts as heard. */
  voiceMs: number;
  /** A pause longer than this starts the count again, so separate clicks never add up. */
  gapMs: number;
  /** How long to wait for a voice before reporting 'silent'. */
  silentAfterMs: number;
}

export const DEFAULT_MIC_CHECK: MicCheckOptions = {
  // About -28 dBFS: well above a quiet room, well below ordinary speech into a microphone.
  voiceLevel: 0.04,
  voiceMs: 300,
  gapMs: 600,
  silentAfterMs: 7000,
};

/** A stalled animation frame must not count as a long stretch of sound. */
const MAX_FRAME_MS = 100;

export class MicCheck {
  private status: MicCheckStatus = 'listening';
  private startedAtMs: number | null = null;
  private lastUpdateMs = 0;
  private lastLoudAtMs: number | null = null;
  private loudMs = 0;

  constructor(private readonly options: MicCheckOptions = DEFAULT_MIC_CHECK) {}

  /** Feed the current microphone level once per frame; returns the status so far. */
  update(level: number, nowMs: number): MicCheckStatus {
    if (this.status === 'heard') return this.status;

    if (this.startedAtMs === null) {
      this.startedAtMs = nowMs;
      this.lastUpdateMs = nowMs;
    }
    const frameMs = Math.min(MAX_FRAME_MS, Math.max(0, nowMs - this.lastUpdateMs));
    this.lastUpdateMs = nowMs;

    if (level >= this.options.voiceLevel) {
      const pausedMs = this.lastLoudAtMs === null ? 0 : nowMs - this.lastLoudAtMs;
      if (pausedMs > this.options.gapMs) this.loudMs = 0;
      this.loudMs += frameMs;
      this.lastLoudAtMs = nowMs;
      if (this.loudMs >= this.options.voiceMs) this.status = 'heard';
    } else if (nowMs - this.startedAtMs >= this.options.silentAfterMs) {
      this.status = 'silent';
    }
    return this.status;
  }
}
