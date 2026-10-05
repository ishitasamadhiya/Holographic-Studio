// Multi-band onset-strength envelopes (spectral flux), the feature used to align two
// recordings of the same song in time.
import { RealFft } from './fft';
import { hannWindow } from './frames';

/** Envelope frames per second. 5 ms steps; the alignment is refined below that afterwards. */
export const ENVELOPE_RATE_HZ = 200;
/**
 * Octave bands whose onsets are tracked separately. One broadband envelope only says WHEN
 * something starts, and in pop music that is nearly the same in every bar. Keeping the bands
 * apart also says WHAT started (kick, bass note, chord, hi-hat), which makes the correct offset
 * stand out from offsets that are merely a beat or a bar away.
 */
const BAND_EDGES_HZ = [60, 120, 240, 480, 960, 1920, 3840, 6400];

const WINDOW_SEC = 0.032;
/** Flux compares each frame with the one this far back: long enough to span a note attack. */
const FLUX_LAG_SEC = 0.015;
/**
 * Compression constant for log(1 + c * magnitude), with the signal scaled to unit RMS. Makes
 * quiet onsets count and keeps the result independent of the recording's level.
 */
const LOG_COMPRESSION = 100;
/** The envelope's slow trend (loud chorus vs quiet verse) is removed over this span. */
const TREND_WINDOW_SEC = 0.5;

export interface OnsetEnvelope {
  frameCount: number;
  /** One envelope per band, each `frameCount` long, with the local mean removed. */
  bands: Float32Array[];
}

function rootMeanSquare(signal: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < signal.length; index++) sum += signal[index]! * signal[index]!;
  return signal.length > 0 ? Math.sqrt(sum / signal.length) : 0;
}

function removeTrend(envelope: Float32Array, halfWindow: number): void {
  const prefix = new Float64Array(envelope.length + 1);
  for (let index = 0; index < envelope.length; index++) {
    prefix[index + 1] = prefix[index]! + envelope[index]!;
  }
  for (let index = 0; index < envelope.length; index++) {
    const from = Math.max(0, index - halfWindow);
    const to = Math.min(envelope.length, index + halfWindow + 1);
    envelope[index]! -= (prefix[to]! - prefix[from]!) / (to - from);
  }
}

/**
 * Onset-strength envelopes of a mono signal. Frame t is centred on time t / ENVELOPE_RATE_HZ.
 * `sampleRate / ENVELOPE_RATE_HZ` must be an integer (it is for the 16 kHz analysis rate).
 */
export function computeOnsetEnvelope(signal: Float32Array, sampleRate: number): OnsetEnvelope {
  const hop = sampleRate / ENVELOPE_RATE_HZ;
  if (!Number.isInteger(hop)) {
    throw new RangeError(`Sample rate ${sampleRate} is not a multiple of ${ENVELOPE_RATE_HZ} Hz`);
  }
  const windowSize = 2 ** Math.round(Math.log2(WINDOW_SEC * sampleRate));
  const fft = new RealFft(windowSize);
  const window = hannWindow(windowSize);
  const binHz = sampleRate / windowSize;
  const bandCount = BAND_EDGES_HZ.length - 1;
  const frameCount = Math.round(signal.length / hop);
  const bands = Array.from({ length: bandCount }, () => new Float32Array(frameCount));
  const level = rootMeanSquare(signal);
  if (level <= 0 || frameCount === 0) return { frameCount, bands };

  // First spectrum bin of each band (and the end of the last one).
  const bandStart = BAND_EDGES_HZ.map((edge) => Math.min(fft.binCount, Math.ceil(edge / binHz)));

  // Ring of the most recent compressed spectra, to difference against the one FLUX_LAG ago.
  const lagFrames = Math.max(1, Math.round(FLUX_LAG_SEC * ENVELOPE_RATE_HZ));
  const history = Array.from({ length: lagFrames }, () => new Float32Array(fft.binCount));
  const frame = new Float64Array(windowSize);
  const re = new Float64Array(fft.binCount);
  const im = new Float64Array(fft.binCount);
  const flux = new Float64Array(bandCount);
  // With this scale a steady sine at the signal's RMS level reads as a magnitude near 1.
  const scale = 4 / (windowSize * level);

  for (let index = 0; index < frameCount; index++) {
    const start = index * hop - windowSize / 2;
    for (let n = 0; n < windowSize; n++) {
      const position = start + n;
      frame[n] = position >= 0 && position < signal.length ? signal[position]! * window[n]! : 0;
    }
    fft.forward(frame, re, im);

    const previous = history[index % lagFrames]!;
    let commonFlux = 0;
    for (let band = 0; band < bandCount; band++) {
      const from = bandStart[band]!;
      const to = bandStart[band + 1]!;
      let rise = 0;
      for (let bin = from; bin < to; bin++) {
        const magnitude = Math.sqrt(re[bin]! * re[bin]! + im[bin]! * im[bin]!) * scale;
        const compressed = Math.log(1 + LOG_COMPRESSION * magnitude);
        if (compressed > previous[bin]!) rise += compressed - previous[bin]!;
        previous[bin] = compressed;
      }
      // Mean rise per bin, so that the wide upper bands do not outvote the narrow lower ones.
      flux[band] = to > from ? rise / (to - from) : 0;
      commonFlux += flux[band]! / bandCount;
    }
    // The first frames have nothing to be compared with yet.
    if (index < lagFrames) continue;
    // Removing what all bands have in common leaves the spectral SHAPE of each onset. The
    // common part is mostly the drum pattern, which looks the same in every bar and in every
    // other song at the same tempo.
    for (let band = 0; band < bandCount; band++) {
      bands[band]![index] = flux[band]! - commonFlux;
    }
  }

  const halfWindow = Math.round((TREND_WINDOW_SEC * ENVELOPE_RATE_HZ) / 2);
  for (const band of bands) removeTrend(band, halfWindow);
  return { frameCount, bands };
}
