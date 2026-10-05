// Vite bundles each worklet (with everything it imports) into its own file and hands back
// its URL: a hashed asset under app://studio in the packaged app, a dev-server URL in dev.
import stemRecorderWorkletUrl from './worklets/stemRecorder.worklet.ts?worker&url';
import vocalChainWorkletUrl from './worklets/vocalChain.worklet.ts?worker&url';

export async function loadWorkletModules(context: BaseAudioContext): Promise<void> {
  await Promise.all([
    context.audioWorklet.addModule(vocalChainWorkletUrl),
    context.audioWorklet.addModule(stemRecorderWorkletUrl),
  ]);
}
