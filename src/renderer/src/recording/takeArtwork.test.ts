import { describe, expect, it } from 'vitest';
import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  formatArtworkDate,
  paintTakeArtwork,
  planTakeArtwork,
  titleFromFileName,
  type ArtworkContext,
} from './takeArtwork';

describe('take artwork', () => {
  it('turns a file name into a readable title', () => {
    expect(titleFromFileName('My_Song (Karaoke).mp3')).toBe('My Song (Karaoke)');
    const long = titleFromFileName(`${'a'.repeat(80)}.wav`);
    expect(long).toHaveLength(48);
    expect(long.endsWith('…')).toBe(true);
  });

  it('shows the wordmark, the song and the date', () => {
    const date = new Date(2026, 9, 5, 14, 30);
    expect(formatArtworkDate(date)).toBe('October 5, 2026');
    const plan = planTakeArtwork({ backingTrackName: 'Halo.m4a', date });
    expect(plan.lines.map((line) => line.text)).toEqual([
      'Holographic Studio',
      'Halo',
      'October 5, 2026',
    ]);
    const aCappella = planTakeArtwork({ backingTrackName: null, date });
    expect(aCappella.lines.map((line) => line.text)).toEqual([
      'Holographic Studio',
      'October 5, 2026',
    ]);
  });

  it('keeps the glow soft: a dark background and faint, wide colour washes', () => {
    const plan = planTakeArtwork({ backingTrackName: null, date: new Date(2026, 0, 1) });
    expect(plan.background).toBe('#08080b');
    expect(plan.glows).toHaveLength(3);
    for (const glow of plan.glows) {
      expect(glow.opacity).toBeLessThanOrEqual(0.2);
      expect(glow.radius).toBeGreaterThan(500);
    }
  });

  it('paints the full 1920x1080 frame, then each line centred', () => {
    const painted: string[] = [];
    const context = {
      fillStyle: '',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      letterSpacing: '0px',
      fillRect: (x: number, y: number, width: number, height: number) =>
        painted.push(`rect ${x},${y},${width},${height}`),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      fillText: (text: string, x: number) => painted.push(`text ${text} @${x}`),
    } as unknown as ArtworkContext;
    paintTakeArtwork(
      context,
      planTakeArtwork({ backingTrackName: 'Song.mp3', date: new Date(2026, 9, 5) }),
    );
    expect(painted[0]).toBe(`rect 0,0,${ARTWORK_WIDTH},${ARTWORK_HEIGHT}`);
    expect(painted.filter((step) => step.startsWith('text'))).toEqual([
      'text Holographic Studio @960',
      'text Song @960',
      'text October 5, 2026 @960',
    ]);
  });
});
