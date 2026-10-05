// Web Worker entry for reference-song analysis (module worker; see analysisClient.ts).
import type { AnalysisRequest } from './protocol';
import { handleAnalysisRequest } from './requestHandler';

// This file is type-checked together with DOM code, where `self` is typed as a Window.
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  // Requests arrive with their audio buffers transferred (zero-copy) and are processed one at
  // a time in arrival order. Results are small plain objects, so nothing is transferred back.
  handleAnalysisRequest(event.data, (response) => workerScope.postMessage(response));
};
