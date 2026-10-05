import { describe, expect, it } from 'vitest';
import { REFERENCE_ANALYSIS_SCHEMA_VERSION, type ReferenceAnalysis } from '@shared/music';
import { createAnalysisClient, type AnalysisWorkerLike } from './analysisClient';
import type { AnalysisRequest, AnalysisResponse } from './protocol';
import type { StereoPcm } from './types';

/** Stand-in for the Web Worker: records what it is sent and lets the test answer. */
class FakeWorker implements AnalysisWorkerLike {
  onmessage: ((event: MessageEvent<AnalysisResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  readonly sent: { request: AnalysisRequest; transfer: Transferable[] }[] = [];

  postMessage(request: AnalysisRequest, transfer: Transferable[]): void {
    this.sent.push({ request, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: AnalysisResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<AnalysisResponse>);
  }

  crash(message: string): void {
    this.onerror?.({ message, preventDefault: () => undefined } as ErrorEvent);
  }

  garble(): void {
    this.onmessageerror?.({ data: null } as MessageEvent);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createAnalysisClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

function pcmOf(...samples: number[]): StereoPcm {
  return {
    left: Float32Array.from(samples),
    right: Float32Array.from(samples),
    sampleRate: 48_000,
  };
}

const analysis: ReferenceAnalysis = {
  schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
  durationSec: 1,
  contour: { hopSec: 0.01, f0Hz: [], confidence: [] },
  notes: [],
  key: { tonic: 0, mode: 'major', confidence: 0 },
  tuningCents: 0,
  quality: 'poor',
  stats: { voicedRatio: 0, meanConfidence: 0, noteCount: 0 },
};

describe('createAnalysisClient', () => {
  it('starts the worker only when it is first needed, and only once', () => {
    const { client, workers } = setup();
    expect(workers.length).toBe(0);
    void client.analyze(pcmOf(1, 2));
    void client.align(pcmOf(1), pcmOf(2));
    expect(workers.length).toBe(1);
    expect(workers[0]!.sent.map((message) => message.request.type)).toEqual(['analyze', 'align']);
  });

  it('sends a copy of the audio and transfers the copy, leaving the caller’s arrays usable', () => {
    const { client, workers } = setup();
    const pcm = pcmOf(0.1, 0.2, 0.3);
    void client.analyze(pcm);
    const { request, transfer } = workers[0]!.sent[0]!;
    if (request.type !== 'analyze') throw new Error('expected an analyze request');
    expect(Array.from(request.pcm.left)).toEqual(Array.from(pcm.left));
    expect(request.pcm.sampleRate).toBe(48_000);
    expect(request.pcm.left.buffer).not.toBe(pcm.left.buffer);
    expect(request.pcm.right!.buffer).not.toBe(pcm.right!.buffer);
    expect(transfer).toEqual([request.pcm.left.buffer, request.pcm.right!.buffer]);
    expect(pcm.left.length).toBe(3);
  });

  it('copies only the viewed part of a larger buffer', () => {
    const { client, workers } = setup();
    const whole = Float32Array.from([9, 9, 1, 2, 3, 9]);
    void client.analyze({ left: whole.subarray(2, 5), right: null, sampleRate: 44_100 });
    const { request, transfer } = workers[0]!.sent[0]!;
    if (request.type !== 'analyze') throw new Error('expected an analyze request');
    expect(Array.from(request.pcm.left)).toEqual([1, 2, 3]);
    expect(request.pcm.left.buffer.byteLength).toBe(12);
    expect(request.pcm.right).toBeNull();
    expect(transfer.length).toBe(1);
  });

  it('routes progress and results to the request they belong to', async () => {
    const { client, workers } = setup();
    const firstProgress: number[] = [];
    const secondProgress: number[] = [];
    const first = client.analyze(pcmOf(1), (fraction) => firstProgress.push(fraction));
    const second = client.analyze(pcmOf(2), (fraction) => secondProgress.push(fraction));
    const worker = workers[0]!;
    const [firstId, secondId] = worker.sent.map((message) => message.request.requestId);
    expect(firstId).not.toBe(secondId);

    worker.reply({ type: 'progress', requestId: secondId!, fraction: 0.25 });
    worker.reply({ type: 'progress', requestId: firstId!, fraction: 0.5 });
    worker.reply({
      type: 'result',
      request: 'analyze',
      requestId: secondId!,
      analysis: { ...analysis, durationSec: 2 },
    });
    worker.reply({ type: 'result', request: 'analyze', requestId: firstId!, analysis });

    expect((await first).durationSec).toBe(1);
    expect((await second).durationSec).toBe(2);
    expect(firstProgress).toEqual([0.5]);
    expect(secondProgress).toEqual([0.25]);
  });

  it('resolves align requests with the alignment', async () => {
    const { client, workers } = setup();
    const promise = client.align(pcmOf(1, 2), pcmOf(3, 4));
    const { request, transfer } = workers[0]!.sent[0]!;
    expect(request.type).toBe('align');
    expect(transfer.length).toBe(4);
    workers[0]!.reply({
      type: 'result',
      request: 'align',
      requestId: request.requestId,
      alignment: { offsetSec: 1.25, confidence: 0.9 },
    });
    await expect(promise).resolves.toEqual({ offsetSec: 1.25, confidence: 0.9 });
  });

  it('rejects with the worker’s error message and keeps serving later requests', async () => {
    const { client, workers } = setup();
    const failing = client.analyze(pcmOf(1));
    workers[0]!.reply({
      type: 'error',
      requestId: workers[0]!.sent[0]!.request.requestId,
      message: 'RangeError: bad',
    });
    await expect(failing).rejects.toThrow('RangeError: bad');

    const next = client.analyze(pcmOf(1));
    workers[0]!.reply({
      type: 'result',
      request: 'analyze',
      requestId: workers[0]!.sent[1]!.request.requestId,
      analysis,
    });
    await expect(next).resolves.toEqual(analysis);
    expect(workers.length).toBe(1);
  });

  it('ignores responses for requests it does not know', () => {
    const { client, workers } = setup();
    void client.analyze(pcmOf(1));
    expect(() =>
      workers[0]!.reply({ type: 'progress', requestId: 999, fraction: 0.5 }),
    ).not.toThrow();
  });

  it('fails everything in flight when the worker crashes and starts a fresh one afterwards', async () => {
    const { client, workers } = setup();
    const first = client.analyze(pcmOf(1));
    const second = client.align(pcmOf(1), pcmOf(2));
    workers[0]!.crash('out of memory');
    await expect(first).rejects.toThrow('out of memory');
    await expect(second).rejects.toThrow('out of memory');
    expect(workers[0]!.terminated).toBe(true);

    void client.analyze(pcmOf(1));
    expect(workers.length).toBe(2);
    expect(workers[1]!.sent.length).toBe(1);
  });

  it('fails the requests in flight when a response cannot be deserialised', async () => {
    const { client, workers } = setup();
    const pending = client.analyze(pcmOf(1));
    workers[0]!.garble();
    await expect(pending).rejects.toThrow('could not be read');
    expect(workers[0]!.terminated).toBe(true);

    void client.align(pcmOf(1), pcmOf(2));
    expect(workers.length).toBe(2);
  });

  it('rejects when the worker cannot be started', async () => {
    const client = createAnalysisClient(() => {
      throw new Error('no workers here');
    });
    await expect(client.analyze(pcmOf(1))).rejects.toThrow('no workers here');
  });

  it('stops the worker on dispose and rejects pending and later requests', async () => {
    const { client, workers } = setup();
    const pending = client.analyze(pcmOf(1));
    client.dispose();
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
    await expect(pending).rejects.toThrow('disposed');
    await expect(client.align(pcmOf(1), pcmOf(2))).rejects.toThrow('disposed');
    expect(workers.length).toBe(1);
  });
});
