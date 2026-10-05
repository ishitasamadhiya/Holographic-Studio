// Messages between the renderer and the analysis worker.
import type { ReferenceAnalysis } from '@shared/music';
import type { AlignmentEstimate, StereoPcm } from './types';

export interface AnalyzeRequest {
  type: 'analyze';
  /** Echoed in every response to this request. */
  requestId: number;
  pcm: StereoPcm;
}

export interface AlignRequest {
  type: 'align';
  requestId: number;
  backing: StereoPcm;
  reference: StereoPcm;
}

export type AnalysisRequest = AnalyzeRequest | AlignRequest;

export interface ProgressResponse {
  type: 'progress';
  requestId: number;
  /** 0..1 */
  fraction: number;
}

export interface AnalyzeResultResponse {
  type: 'result';
  request: 'analyze';
  requestId: number;
  analysis: ReferenceAnalysis;
}

export interface AlignResultResponse {
  type: 'result';
  request: 'align';
  requestId: number;
  alignment: AlignmentEstimate;
}

export interface ErrorResponse {
  type: 'error';
  requestId: number;
  /** Technical detail for logs; the UI shows its own friendly 'analysis-failed' message. */
  message: string;
}

export type AnalysisResponse =
  ProgressResponse | AnalyzeResultResponse | AlignResultResponse | ErrorResponse;

/**
 * A copy of the audio in buffers of its own, safe to hand over to another thread.
 *
 * The caller's arrays usually belong to an AudioBuffer that is still needed (the backing track
 * is about to be played), so they must not be transferred themselves. Copying explicitly also
 * avoids cloning the whole underlying buffer when an array is only a view into a larger one.
 */
export function copyPcmForTransfer(pcm: StereoPcm): StereoPcm {
  return {
    left: pcm.left.slice(),
    right: pcm.right ? pcm.right.slice() : null,
    sampleRate: pcm.sampleRate,
  };
}

/** The buffers of a request's audio, for the transfer list of postMessage. */
export function transferablesOf(request: AnalysisRequest): ArrayBuffer[] {
  const audio = request.type === 'analyze' ? [request.pcm] : [request.backing, request.reference];
  const buffers = new Set<ArrayBuffer>();
  for (const pcm of audio) {
    for (const channel of [pcm.left, pcm.right]) {
      // SharedArrayBuffers cannot be (and need not be) transferred.
      if (channel && channel.buffer instanceof ArrayBuffer) buffers.add(channel.buffer);
    }
  }
  return [...buffers];
}
