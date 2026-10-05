// What the analysis worker does with a request. Kept free of worker globals so it can be
// unit-tested (and reused on another kind of thread) as a plain function.
import { estimateAlignment } from './alignment';
import { analyzeReference } from './analyzeReference';
import type { AnalysisRequest, AnalysisResponse } from './protocol';

/** Progress messages closer together than this are not worth a postMessage. */
const MIN_PROGRESS_STEP = 0.01;

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Runs one request to completion, reporting through `respond`. Never throws: any failure
 * becomes an 'error' response, so a bad file cannot take the worker down.
 */
export function handleAnalysisRequest(
  request: AnalysisRequest,
  respond: (response: AnalysisResponse) => void,
): void {
  const { requestId } = request;
  try {
    if (request.type === 'analyze') {
      let lastReported = -1;
      const analysis = analyzeReference(request.pcm, {
        onProgress: (fraction) => {
          if (fraction - lastReported < MIN_PROGRESS_STEP && fraction < 1) return;
          lastReported = fraction;
          respond({ type: 'progress', requestId, fraction });
        },
      });
      respond({ type: 'result', request: 'analyze', requestId, analysis });
    } else {
      const alignment = estimateAlignment(request.backing, request.reference);
      respond({ type: 'result', request: 'align', requestId, alignment });
    }
  } catch (error) {
    respond({ type: 'error', requestId, message: describeError(error) });
  }
}
