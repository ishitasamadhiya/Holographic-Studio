import { describe, expect, it } from 'vitest';
import { createProgressParser } from './ffmpegProgress';

function collect(chunks: string[]): number[] {
  const seconds: number[] = [];
  const feed = createProgressParser((value) => seconds.push(value));
  for (const chunk of chunks) feed(chunk);
  return seconds;
}

const REPORT = [
  'frame=90',
  'fps=0.00',
  'stream_0_0_q=-0.0',
  'bitrate=2118.2kbits/s',
  'total_size=790801',
  'out_time_us=2986667',
  'out_time_ms=2986667',
  'out_time=00:00:02.986667',
  'dup_frames=0',
  'drop_frames=0',
  'speed=11.5x',
  'progress=continue',
  '',
].join('\n');

describe('createProgressParser', () => {
  it('reports the encoded time of each progress report, once', () => {
    expect(collect([REPORT])).toEqual([2.986667]);
  });

  it('handles reports arriving in arbitrary pieces', () => {
    const twoReports = REPORT + REPORT.replace(/2986667/g, '5000000');
    const pieces = twoReports.match(/[\s\S]{1,7}/g) ?? [];
    expect(collect(pieces)).toEqual([2.986667, 5]);
  });

  it('waits for the end of a line before using it', () => {
    expect(collect(['out_time_us=1500'])).toEqual([]);
    expect(collect(['out_time_us=1500', '000\n'])).toEqual([1.5]);
  });

  it('handles Windows line endings', () => {
    expect(collect(['out_time_us=250000\r\nprogress=continue\r\n'])).toEqual([0.25]);
  });

  it('ignores "N/A", negative and malformed values', () => {
    expect(
      collect([
        'out_time_us=N/A\n',
        'out_time_us=-23220\n',
        'out_time_us=\n',
        'garbage line\n',
        '=5\n',
        'out_time_us=1000000\n',
      ]),
    ).toEqual([1]);
  });
});
