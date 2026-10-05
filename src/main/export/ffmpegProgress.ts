/**
 * Parses the machine-readable `key=value` lines FFmpeg writes with `-progress`, and reports
 * how many seconds of output have been encoded so far. Input may be split anywhere, so
 * partial lines are buffered until their line break arrives.
 */
export function createProgressParser(
  onOutputSeconds: (seconds: number) => void,
): (chunk: string) => void {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const seconds = parseOutputSeconds(line);
      if (seconds !== null) onOutputSeconds(seconds);
    }
  };
}

function parseOutputSeconds(line: string): number | null {
  const separator = line.indexOf('=');
  if (separator < 0) return null;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();

  // Despite its name, out_time_ms has always been in microseconds, like out_time_us.
  // Reading only one key avoids reporting every update twice.
  if (key !== 'out_time_us' || value === '') return null;
  const microseconds = Number(value);
  // FFmpeg prints "N/A" (and occasionally a negative start) before the first frame is out.
  return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : null;
}
