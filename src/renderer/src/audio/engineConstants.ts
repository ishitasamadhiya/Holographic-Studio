/** The rate the engine asks for; `AudioEngine.sampleRate` reports what the context really runs at. */
export const ENGINE_SAMPLE_RATE = 48000;

/** Web Audio renders, and AudioWorklets process, in blocks of this many frames. */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * Microphone capture delay assumed when the track does not report one. Chromium hands
 * capture audio to the graph in 10 ms packets, so this is the usual reported value too.
 */
export const DEFAULT_INPUT_LATENCY_SEC = 0.01;

/** Time constant of every mix-gain change (monitor, backing): inaudible as a step, fast to the ear. */
export const GAIN_RAMP_TIME_CONSTANT_SEC = 0.01;

/** How often the audio-clock ↔ performance.now() mapping is refreshed while running. */
export const OUTPUT_CLOCK_SAMPLE_INTERVAL_MS = 200;
