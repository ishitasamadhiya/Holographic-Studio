// AudioWorkletProcessor around the vocal chain: mono microphone in, processed stereo vocal out.
import {
  DEFAULT_VOCAL_CHAIN_CONTROLS,
  VocalChain,
  type VocalChainControls,
  type VocalChainMeters,
} from '@dsp/vocalChain';
import { CONTROL_IDS } from '@shared/controls';
import {
  VOCAL_CHAIN_PROCESSOR,
  type VocalChainRequest,
  type VocalMetersMessage,
  type VocalReadyMessage,
} from '../protocol';
import { sungSongPosition, type SongClockState } from '../songClock';

const METER_REPORTS_PER_SECOND = 30;

/** AudioParamDescriptor, which the worklet typings do not declare. */
interface ControlParamDescriptor {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: 'a-rate' | 'k-rate';
}

class VocalChainProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  /** The three live controls are AudioParams, so moving them never needs a message. */
  static get parameterDescriptors(): ControlParamDescriptor[] {
    return CONTROL_IDS.map((name) => ({
      name,
      defaultValue: DEFAULT_VOCAL_CHAIN_CONTROLS[name],
      minValue: 0,
      maxValue: 1,
      automationRate: 'k-rate',
    }));
  }

  private readonly chain = new VocalChain({ sampleRate });
  /** Mirror of what the chain was last told; reused so that process() never allocates. */
  private readonly controls: VocalChainControls = { ...DEFAULT_VOCAL_CHAIN_CONTROLS };
  private readonly meters: VocalChainMeters = {
    inputPeak: 0,
    outputPeak: 0,
    detectedMidi: Number.NaN,
    targetMidi: Number.NaN,
    correctionCents: 0,
  };
  /** Reused for every report: posting clones it, so nothing is allocated on this side. */
  private readonly metersMessage: VocalMetersMessage = {
    type: 'meters',
    inputPeak: 0,
    outputPeak: 0,
    detectedMidi: Number.NaN,
    targetMidi: Number.NaN,
    correctionCents: 0,
  };
  private readonly meterIntervalFrames = Math.round(sampleRate / METER_REPORTS_PER_SECOND);
  private framesSinceMeterReport = 0;

  private readonly songClock: SongClockState = { startFrame: 0, stopFrame: 0, offsetSec: 0 };
  private hasSongClock = false;
  private roundTripLatencySec = 0;

  /** Stands in for the microphone while none is connected. */
  private silence = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<VocalChainRequest>) => {
      this.handleRequest(event.data);
    };
    const ready: VocalReadyMessage = { type: 'ready', latencySamples: this.chain.latencySamples };
    this.port.postMessage(ready);
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const left = outputs[0]?.[0];
    const right = outputs[0]?.[1];
    if (left === undefined || right === undefined) return true;
    const frameCount = left.length;

    this.applyControls(parameters);
    this.chain.setSongPosition(
      this.hasSongClock
        ? sungSongPosition(this.songClock, currentFrame, sampleRate, this.roundTripLatencySec)
        : null,
    );
    this.chain.process(inputs[0]?.[0] ?? this.silentBlock(frameCount), left, right);

    this.framesSinceMeterReport += frameCount;
    if (this.framesSinceMeterReport >= this.meterIntervalFrames) {
      this.framesSinceMeterReport = 0;
      this.reportMeters();
    }
    return true;
  }

  /** Forwards the k-rate control values to the chain, but only when one of them moved. */
  private applyControls(parameters: Record<string, Float32Array>): void {
    const controls = this.controls;
    const autotune = parameters.autotune?.[0] ?? controls.autotune;
    const echo = parameters.echo?.[0] ?? controls.echo;
    const volume = parameters.volume?.[0] ?? controls.volume;
    if (autotune === controls.autotune && echo === controls.echo && volume === controls.volume) {
      return;
    }
    controls.autotune = autotune;
    controls.echo = echo;
    controls.volume = volume;
    this.chain.setControls(controls);
  }

  private silentBlock(frameCount: number): Float32Array {
    // The render block size is fixed for the life of a context, so this allocates at most once.
    if (this.silence.length !== frameCount) this.silence = new Float32Array(frameCount);
    return this.silence;
  }

  private reportMeters(): void {
    const meters = this.meters;
    const message = this.metersMessage;
    this.chain.readMeters(meters);
    message.inputPeak = meters.inputPeak;
    message.outputPeak = meters.outputPeak;
    message.detectedMidi = meters.detectedMidi;
    message.targetMidi = meters.targetMidi;
    message.correctionCents = meters.correctionCents;
    this.port.postMessage(message);
  }

  private handleRequest(request: VocalChainRequest): void {
    switch (request.type) {
      case 'mix':
        this.controls.micGain = request.micGain;
        this.controls.reverbEnabled = request.reverbEnabled;
        this.chain.setControls(this.controls);
        return;
      case 'pitch-targets':
        this.chain.setPitchTargets(request.targets);
        return;
      case 'song-clock':
        this.hasSongClock = request.clock !== null;
        if (request.clock !== null) {
          this.songClock.startFrame = request.clock.startFrame;
          this.songClock.stopFrame = request.clock.stopFrame;
          this.songClock.offsetSec = request.clock.offsetSec;
        }
        this.roundTripLatencySec = request.roundTripLatencySec;
        return;
    }
  }
}

registerProcessor(VOCAL_CHAIN_PROCESSOR, VocalChainProcessor);
