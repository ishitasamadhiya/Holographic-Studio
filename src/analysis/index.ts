// Public API of the reference-song analysis.
//
// Everything except the worker client is pure TypeScript on typed arrays and can be imported
// anywhere. `createAnalysisClient` needs a browser-like environment (it starts a Web Worker);
// code running in Node should import the pure modules it needs directly.
export type { AlignmentEstimate, StereoPcm } from './types';
export { analyzeReference, type AnalyzeOptions } from './analyzeReference';
export { DEFAULT_MAX_OFFSET_SEC, estimateAlignment, type AlignmentOptions } from './alignment';
export {
  MIN_ALIGNMENT_CONFIDENCE,
  MIN_KEY_CONFIDENCE,
  buildPitchTargets,
  type PitchTargetOptions,
} from './pitchTargets';
export {
  createAnalysisClient,
  type AnalysisClient,
  type AnalysisWorkerLike,
} from './analysisClient';
export type {
  AlignRequest,
  AlignResultResponse,
  AnalysisRequest,
  AnalysisResponse,
  AnalyzeRequest,
  AnalyzeResultResponse,
  ErrorResponse,
  ProgressResponse,
} from './protocol';
