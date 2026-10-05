// The "can you hear this?" chime: two soft bell-like notes, a fifth apart.

const NOTES = [
  { frequencyHz: 659.26, delaySec: 0 },
  { frequencyHz: 987.77, delaySec: 0.14 },
] as const;

/** Each note is its fundamental plus a quiet octave for a little shimmer. */
const OCTAVE_LEVEL = 0.18;

const PEAK_LEVEL = 0.16;
const ATTACK_SEC = 0.012;
const DECAY_TIME_CONSTANT_SEC = 0.16;
const NOTE_SEC = 0.9;
const START_DELAY_SEC = 0.03;

/** Longest the chime takes, for callers that must not wait forever on a stalled context. */
export const CHIME_MAX_SEC = START_DELAY_SEC + 0.14 + NOTE_SEC + 0.5;

function playNote(
  context: BaseAudioContext,
  destination: AudioNode,
  frequencyHz: number,
  startAt: number,
): Promise<void> {
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, startAt);
  envelope.gain.linearRampToValueAtTime(PEAK_LEVEL, startAt + ATTACK_SEC);
  envelope.gain.setTargetAtTime(0, startAt + ATTACK_SEC, DECAY_TIME_CONSTANT_SEC);
  envelope.connect(destination);

  const fundamental = context.createOscillator();
  fundamental.frequency.value = frequencyHz;
  fundamental.connect(envelope);

  const octave = context.createOscillator();
  const octaveLevel = context.createGain();
  octave.frequency.value = frequencyHz * 2;
  octaveLevel.gain.value = OCTAVE_LEVEL;
  octave.connect(octaveLevel).connect(envelope);

  for (const oscillator of [fundamental, octave]) {
    oscillator.start(startAt);
    oscillator.stop(startAt + NOTE_SEC);
  }
  return new Promise<void>((resolve) => {
    fundamental.onended = () => {
      fundamental.disconnect();
      octave.disconnect();
      octaveLevel.disconnect();
      envelope.disconnect();
      resolve();
    };
  });
}

/** Plays the chime into `destination` and resolves when it has faded out. */
export async function playChime(context: BaseAudioContext, destination: AudioNode): Promise<void> {
  const startAt = context.currentTime + START_DELAY_SEC;
  await Promise.all(
    NOTES.map((note) => playNote(context, destination, note.frequencyHz, startAt + note.delaySec)),
  );
}
