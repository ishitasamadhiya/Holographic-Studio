import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://studio`;
const rendererRoot = join(__dirname, '../renderer');

/**
 * A privileged custom scheme gives the renderer a secure origin in production, which
 * getUserMedia, WebAssembly streaming, workers and AudioWorklets all require.
 * Must be called before the app is ready.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Serves the built UI from the renderer folder, and nothing outside it. */
export function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const relativePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = normalize(join(rendererRoot, relativePath));
    if (!filePath.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

/** The dev server while developing, the app:// origin otherwise. */
export function rendererBaseUrl(): string {
  return process.env.ELECTRON_RENDERER_URL ?? APP_ORIGIN;
}

export function rendererUrl(page: string): string {
  return `${rendererBaseUrl()}/${page}`;
}
