// Small signal builders shared by the analysis tests.
import { midiToHz } from '@shared/music';
import type { StereoPcm } from '../types';
import { SeededRandom } from './random';
import { renderSong, type RenderOptions, type RenderedSong } from './renderSong';
import { composeSong, type SongSpec } from './songScore';

const DEFAULT_SPEC: SongSpec = {
  seed: 1,
  durationSec: 24,
  tempoBpm: 108,
  tonic: 0,
  mode: 'major',
  vocalRange: 'female',
};

/** Composes and renders a synthetic song; unspecified choices fall back to sensible defaults. */
export function makeSong(
  spec: Partial<SongSpec>,
  render: Partial<RenderOptions> = {},
): RenderedSong {
  return renderSong(composeSong({ ...DEFAULT_SPEC, ...spec }), {
    sampleRate: 44_100,
    vocalGainDb: 0,
    ...render,
  });
}

/** White noise; the two channels are independent unless `mono` is set. */
export function whiteNoise(
  durationSec: number,
  sampleRate: number,
  seed: number,
  mono = false,
): StereoPcm {
  const random = new SeededRandom(seed);
  const length = Math.round(durationSec * sampleRate);
  const left = Float32Array.from({ length }, () => 0.3 * random.noise());
  const right = mono ? null : Float32Array.from({ length }, () => 0.3 * random.noise());
  return { left, right, sampleRate };
}

export function silence(durationSec: number, sampleRate: number): StereoPcm {
  const length = Math.round(durationSec * sampleRate);
  return { left: new Float32Array(length), right: new Float32Array(length), sampleRate };
}

/** A mono sequence of plain harmonic tones (six partials), one per entry of `midiNotes`. */
export function toneSequence(
  midiNotes: readonly number[],
  noteSec: number,
  sampleRate: number,
): StereoPcm {
  const noteLength = Math.round(noteSec * sampleRate);
  const left = new Float32Array(noteLength * midiNotes.length);
  midiNotes.forEach((midi, noteIndex) => {
    const frequency = midiToHz(midi);
    for (let n = 0; n < noteLength; n++) {
      const time = n / sampleRate;
      const envelope = Math.min(1, time / 0.01, (noteSec - time) / 0.02);
      let sample = 0;
      for (let harmonic = 1; harmonic <= 6; harmonic++) {
        sample += Math.sin(2 * Math.PI * harmonic * frequency * time) / harmonic;
      }
      left[noteIndex * noteLength + n] = 0.2 * envelope * sample;
    }
  });
  return { left, right: null, sampleRate };
}

/**
 * The "backing track" for a reference recording, cut or padded so that
 * referenceTime = backingTime + offsetSec.
 */
export function offsetBy(pcm: StereoPcm, offsetSec: number): StereoPcm {
  const shift = Math.round(offsetSec * pcm.sampleRate);
  const move = (channel: Float32Array): Float32Array => {
    if (shift >= 0) return channel.slice(shift);
    const padded = new Float32Array(channel.length - shift);
    padded.set(channel, -shift);
    return padded;
  };
  return {
    left: move(pcm.left),
    right: pcm.right ? move(pcm.right) : null,
    sampleRate: pcm.sampleRate,
  };
}

export function toMono(pcm: StereoPcm): StereoPcm {
  if (pcm.right === null) return pcm;
  const right = pcm.right;
  return {
    left: pcm.left.map((sample, index) => 0.5 * (sample + right[index]!)),
    right: null,
    sampleRate: pcm.sampleRate,
  };
}
