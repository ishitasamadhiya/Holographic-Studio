import { describe, expect, it } from 'vitest';
import { isReferenceAnalysis } from '@shared/music';
import { transferablesOf, copyPcmForTransfer, type AnalysisResponse } from './protocol';
import { handleAnalysisRequest } from './requestHandler';
import { makeSong, offsetBy } from './testing/signals';

function collect(run: (respond: (response: AnalysisResponse) => void) => void): AnalysisResponse[] {
  const responses: AnalysisResponse[] = [];
  run((response) => responses.push(response));
  return responses;
}

const song = makeSong({ seed: 70, durationSec: 20 }, { sampleRate: 22_050 });

describe('handleAnalysisRequest', () => {
  it('answers an analyze request with throttled progress and then the analysis', () => {
    const responses = collect((respond) =>
      handleAnalysisRequest({ type: 'analyze', requestId: 7, pcm: song.mix }, respond),
    );
    expect(responses.every((response) => response.requestId === 7)).toBe(true);

    const last = responses[responses.length - 1]!;
    expect(last.type).toBe('result');
    if (last.type !== 'result' || last.request !== 'analyze')
      throw new Error('expected an analysis');
    expect(isReferenceAnalysis(last.analysis)).toBe(true);
    expect(last.analysis.durationSec).toBeCloseTo(20, 3);
    expect(last.analysis.notes.length).toBeGreaterThan(5);

    const progress = responses.slice(0, -1).map((response) => {
      if (response.type !== 'progress') throw new Error(`unexpected ${response.type} response`);
      return response.fraction;
    });
    expect(progress.length).toBeGreaterThan(10);
    expect(progress.length).toBeLessThanOrEqual(102);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index]!).toBeGreaterThan(progress[index - 1]!);
    }
  });

  it('answers an align request with the alignment', () => {
    const responses = collect((respond) =>
      handleAnalysisRequest(
        {
          type: 'align',
          requestId: 3,
          backing: offsetBy(song.instrumental, 0.5),
          reference: song.mix,
        },
        respond,
      ),
    );
    expect(responses.length).toBe(1);
    const [response] = responses;
    if (response?.type !== 'result' || response.request !== 'align')
      throw new Error('expected an alignment');
    expect(response.requestId).toBe(3);
    expect(response.alignment.offsetSec).toBeCloseTo(0.5, 2);
    expect(response.alignment.confidence).toBeGreaterThan(0.8);
  });

  it('turns a failure into an error response instead of throwing', () => {
    const broken = { left: new Float32Array(100), right: null, sampleRate: 0 };
    const analyzeResponses = collect((respond) =>
      handleAnalysisRequest({ type: 'analyze', requestId: 1, pcm: broken }, respond),
    );
    const analyzeError = analyzeResponses[analyzeResponses.length - 1]!;
    expect(analyzeError).toEqual({
      type: 'error',
      requestId: 1,
      message: 'RangeError: Invalid sample rate: 0',
    });

    const alignResponses = collect((respond) =>
      handleAnalysisRequest(
        { type: 'align', requestId: 2, backing: broken, reference: song.mix },
        respond,
      ),
    );
    expect(alignResponses).toEqual([
      { type: 'error', requestId: 2, message: 'RangeError: Invalid sample rate: 0' },
    ]);
  });
});

describe('protocol helpers', () => {
  it('lists each audio buffer of a request once', () => {
    const left = new Float32Array(8);
    const shared = { left, right: left, sampleRate: 48_000 };
    expect(transferablesOf({ type: 'analyze', requestId: 1, pcm: shared })).toEqual([left.buffer]);

    const backing = { left: new Float32Array(4), right: new Float32Array(4), sampleRate: 48_000 };
    const reference = { left: new Float32Array(4), right: null, sampleRate: 44_100 };
    const buffers = transferablesOf({ type: 'align', requestId: 2, backing, reference });
    expect(buffers).toEqual([backing.left.buffer, backing.right.buffer, reference.left.buffer]);
  });

  it('copies audio into buffers of its own', () => {
    const original = { left: Float32Array.from([1, 2]), right: null, sampleRate: 16_000 };
    const copy = copyPcmForTransfer(original);
    expect(copy).toEqual(original);
    expect(copy.left).not.toBe(original.left);
  });
});
