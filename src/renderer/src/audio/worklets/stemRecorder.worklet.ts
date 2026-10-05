// AudioWorkletProcessor around StemCapture. Input 0 is the processed vocal, input 1 the
// backing track after its gain; both are captured from the same render blocks, so frame N of
// one stem always lines up with frame N of the other.
import { RENDER_QUANTUM_FRAMES } from '../engineConstants';
import { STEM_RECORDER_PROCESSOR, type RecorderEvent, type RecorderRequest } from '../protocol';
import { StemCapture } from '../stemCapture';

class StemRecorderProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  private readonly capture = new StemCapture(
    { sampleRate },
    {
      onChunk: (vocal, backing) => {
        this.post({ type: 'chunk', vocal: vocal.buffer, backing: backing.buffer }, [
          vocal.buffer,
          backing.buffer,
        ]);
      },
      onStopped: (frames) => {
        this.post({ type: 'stopped', frames });
      },
    },
  );

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<RecorderRequest>) => {
      const { id, command, frame } = event.data;
      this.post({ type: 'scheduled', id, frame: this.capture.schedule(command, frame) });
    };
  }

  process(inputs: Float32Array[][]): boolean {
    // An input with nothing playing into it arrives without channels: that is silence.
    const vocal = inputs[0];
    const backing = inputs[1];
    const frameCount = vocal?.[0]?.length ?? backing?.[0]?.length ?? RENDER_QUANTUM_FRAMES;
    this.capture.process(
      currentFrame,
      frameCount,
      vocal?.[0],
      vocal?.[1],
      backing?.[0],
      backing?.[1],
    );
    return true;
  }

  private post(event: RecorderEvent, transfer: Transferable[] = []): void {
    this.port.postMessage(event, transfer);
  }
}

registerProcessor(STEM_RECORDER_PROCESSOR, StemRecorderProcessor);
