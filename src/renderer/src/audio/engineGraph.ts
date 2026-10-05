// The live audio graph (docs/ARCHITECTURE.md §4):
//
//   microphone ─► vocal chain ─┬─► monitor gain ─► master ─► soft clipper ─► output
//   backing ─► backing gain ───┼────────────────────┘
//                              └─► stem recorder (input 0: vocal, input 1: backing)
//
// Nothing in the monitoring path has look-ahead: the clipper is a static curve.
import type { ControlValues } from '@shared/controls';
import type { MixSettings } from './engineTypes';
import { GAIN_RAMP_TIME_CONSTANT_SEC } from './engineConstants';
import { backingGain, monitorGain } from './mixLevels';
import { STEM_RECORDER_PROCESSOR, VOCAL_CHAIN_PROCESSOR } from './protocol';
import { CLIP_INPUT_RANGE, createSoftClipCurve } from './softClipper';

export interface EngineGraph {
  /** Mono microphone in, processed stereo vocal out. */
  readonly vocal: AudioWorkletNode;
  readonly recorder: AudioWorkletNode;
  /** Own-voice level in the headphones; never reaches the recorder. */
  readonly monitor: GainNode;
  /** Backing level, heard and recorded. Backing sources connect here. */
  readonly backing: GainNode;
  /** Everything the singer hears. Sounds that must never be recorded go straight in here. */
  readonly master: GainNode;
  disconnect(): void;
}

export function buildEngineGraph(
  context: AudioContext,
  mix: MixSettings,
  controls: ControlValues,
): EngineGraph {
  const vocal = new AudioWorkletNode(context, VOCAL_CHAIN_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    // A stereo interface is folded down to mono before the chain.
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: { autotune: controls.autotune, echo: controls.echo, volume: controls.volume },
  });
  const recorder = new AudioWorkletNode(context, STEM_RECORDER_PROCESSOR, {
    numberOfInputs: 2,
    numberOfOutputs: 0,
    // A mono backing track is captured as identical left and right channels.
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const monitor = new GainNode(context, { gain: monitorGain(mix) });
  const backing = new GainNode(context, { gain: backingGain(mix) });
  const master = new GainNode(context);
  const clipInput = new GainNode(context, { gain: 1 / CLIP_INPUT_RANGE });
  const clipper = new WaveShaperNode(context, {
    curve: createSoftClipCurve(),
    oversample: 'none',
  });

  vocal.connect(monitor).connect(master);
  backing.connect(master);
  master.connect(clipInput).connect(clipper).connect(context.destination);
  vocal.connect(recorder, 0, 0);
  backing.connect(recorder, 0, 1);

  return {
    vocal,
    recorder,
    monitor,
    backing,
    master,
    disconnect: () => {
      for (const node of [vocal, recorder, monitor, backing, master, clipInput, clipper]) {
        node.disconnect();
      }
    },
  };
}

/** Glides a gain to its new value quickly enough to feel instant, slowly enough not to click. */
export function rampGain(param: AudioParam, value: number, context: BaseAudioContext): void {
  const now = context.currentTime;
  param.cancelAndHoldAtTime(now);
  param.setTargetAtTime(value, now, GAIN_RAMP_TIME_CONSTANT_SEC);
}
