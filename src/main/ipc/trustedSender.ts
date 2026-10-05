/** "app://studio/index.html" -> "app://studio". Null for anything that is not a URL. */
export function originOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return host ? `${protocol}//${host}` : null;
  } catch {
    return null;
  }
}

/**
 * Builds the check applied to every incoming IPC message: only frames showing the app's own
 * UI (the app:// origin, or the dev server while developing) may call into the main process.
 */
export function createSenderCheck(trustedUrls: readonly string[]): (frameUrl: string) => boolean {
  const trustedOrigins = new Set(
    trustedUrls.map(originOf).filter((origin): origin is string => origin !== null),
  );
  return (frameUrl) => {
    const origin = originOf(frameUrl);
    return origin !== null && trustedOrigins.has(origin);
  };
}
