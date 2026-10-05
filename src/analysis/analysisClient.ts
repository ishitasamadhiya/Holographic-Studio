// Renderer-side handle on the analysis worker: promises in, promises out.
import type { ReferenceAnalysis } from '@shared/music';
import {
  copyPcmForTransfer,
  transferablesOf,
  type AnalysisRequest,
  type AnalysisResponse,
} from './protocol';
import type { AlignmentEstimate, StereoPcm } from './types';

/** The part of the Worker interface the client relies on (lets tests substitute a fake). */
export interface AnalysisWorkerLike {
  postMessage(message: AnalysisRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export interface AnalysisClient {
  /**
   * Analyses the reference song off the UI thread. The audio is copied before it is handed
   * over, so `pcm` stays usable. `onProgress` receives fractions from 0 to 1.
   */
  analyze(pcm: StereoPcm, onProgress?: (fraction: number) => void): Promise<ReferenceAnalysis>;
  /** Estimates the offset between backing track and reference song (see estimateAlignment). */
  align(backing: StereoPcm, reference: StereoPcm): Promise<AlignmentEstimate>;
  /** Stops the worker. Requests still running are rejected. */
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: ReferenceAnalysis | AlignmentEstimate) => void;
  reject: (reason: Error) => void;
  onProgress?: (fraction: number) => void;
}

function createAnalysisWorker(): AnalysisWorkerLike {
  return new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * Creates the client. The worker is started on first use and processes requests one at a time
 * in the order they were made.
 */
export function createAnalysisClient(
  createWorker: () => AnalysisWorkerLike = createAnalysisWorker,
): AnalysisClient {
  const pending = new Map<number, PendingRequest>();
  let worker: AnalysisWorkerLike | null = null;
  let nextRequestId = 1;
  let disposed = false;

  const rejectAll = (reason: Error) => {
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };

  const handleResponse = (response: AnalysisResponse) => {
    const request = pending.get(response.requestId);
    if (!request) return;
    if (response.type === 'progress') {
      request.onProgress?.(response.fraction);
      return;
    }
    pending.delete(response.requestId);
    if (response.type === 'error') request.reject(new Error(response.message));
    else request.resolve(response.request === 'analyze' ? response.analysis : response.alignment);
  };

  const ensureWorker = (): AnalysisWorkerLike => {
    if (worker) return worker;
    const created = createWorker();
    // After a failure the worker cannot be trusted any more: fail everything in flight and
    // start a fresh one for the next request.
    const fail = (message: string) => {
      rejectAll(new Error(`Analysis worker failed: ${message}`));
      created.terminate();
      if (worker === created) worker = null;
    };
    created.onmessage = (event) => handleResponse(event.data);
    created.onerror = (event) => {
      // Script error or out of memory inside the worker.
      event.preventDefault();
      fail(event.message || 'unknown error');
    };
    // A response that could not be deserialised: its request would otherwise never settle.
    created.onmessageerror = () => fail('a response could not be read');
    worker = created;
    return created;
  };

  const send = <T extends ReferenceAnalysis | AlignmentEstimate>(
    buildRequest: (requestId: number) => AnalysisRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<T> => {
    if (disposed) return Promise.reject(new Error('Analysis client was disposed'));
    return new Promise<T>((resolve, reject) => {
      const requestId = nextRequestId++;
      pending.set(requestId, {
        resolve: resolve as PendingRequest['resolve'],
        reject,
        onProgress,
      });
      try {
        const request = buildRequest(requestId);
        ensureWorker().postMessage(request, transferablesOf(request));
      } catch (error) {
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    analyze: (pcm, onProgress) =>
      send<ReferenceAnalysis>(
        (requestId) => ({ type: 'analyze', requestId, pcm: copyPcmForTransfer(pcm) }),
        onProgress,
      ),
    align: (backing, reference) =>
      send<AlignmentEstimate>((requestId) => ({
        type: 'align',
        requestId,
        backing: copyPcmForTransfer(backing),
        reference: copyPcmForTransfer(reference),
      })),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      worker?.terminate();
      worker = null;
      rejectAll(new Error('Analysis client was disposed'));
    },
  };
}
