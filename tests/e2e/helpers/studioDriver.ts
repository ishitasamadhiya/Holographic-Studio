// Driving the real app (index.html) end to end: launching it with a synthesized voice as the
// microphone, reading the running Studio (window.__holoTest), stubbing the native dialogs,
// and finding the temporary takes it keeps on disk.
//
// Chromium's fake microphone cannot play a WAV while the audio service is sandboxed (it only
// beeps), so the voice is a tone generated in the page and handed to the app as the stream
// getUserMedia returns for audio. The app opens the microphone as soon as it starts (the
// wizard's first step, or the studio on a returning profile), so the replacement is installed
// for every new document and the page is loaded again before the app's first line runs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels';
import { MANIFEST_FILE } from '../../../src/main/takes/takeFiles';
import type {
  LiveReadouts,
  Studio,
  StudioState,
} from '../../../src/renderer/src/state/studioTypes';
import type { MediaKind, PermissionStatus } from '../../../src/shared/ipc';
import type { TakeManifest } from '../../../src/shared/take';
import { launchApp, type LaunchedApp, type LaunchOptions } from './app';
import { MIC_HZ } from './coreFixtures';

interface TestWindow {
  __holoTest?: Studio;
  /** While true, the synthesized microphone refuses like a microphone the system blocks. */
  __holoMicrophoneBlocked?: boolean;
  /** While true, there is no microphone to open, as after unplugging the only one. */
  __holoMicrophoneUnplugged?: boolean;
  /** Every synthesized microphone track handed out, oldest first. */
  __holoMicrophoneTracks?: MediaStreamTrack[];
}

export interface StudioLaunchOptions extends LaunchOptions {
  /** Start with every microphone request refused as "not allowed" (see allowMicrophone). */
  microphoneBlocked?: boolean;
}

/** Replaces getUserMedia's microphone with a steady tone at `hz` with a slow tremolo. */
function installSyntheticVoice({ hz, blocked }: { hz: number; blocked: boolean }): void {
  const testWindow = window as TestWindow;
  testWindow.__holoMicrophoneBlocked = blocked;
  const tracks: MediaStreamTrack[] = [];
  testWindow.__holoMicrophoneTracks = tracks;
  const devices = navigator.mediaDevices;
  const nativeGetUserMedia = devices.getUserMedia.bind(devices);
  let context: AudioContext | null = null;
  devices.getUserMedia = async (constraints) => {
    if (!constraints?.audio) return nativeGetUserMedia(constraints);
    if (testWindow.__holoMicrophoneBlocked) {
      throw new DOMException('Permission denied by system', 'NotAllowedError');
    }
    if (testWindow.__holoMicrophoneUnplugged) {
      throw new DOMException('Requested device not found', 'NotFoundError');
    }
    context ??= new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const tone = new OscillatorNode(context, { frequency: hz });
    const level = new GainNode(context, { gain: 0.22 });
    const tremolo = new OscillatorNode(context, { frequency: 1.5 });
    const depth = new GainNode(context, { gain: 0.12 });
    const destination = new MediaStreamAudioDestinationNode(context, { channelCount: 1 });
    tremolo.connect(depth).connect(level.gain);
    tone.connect(level).connect(destination);
    tone.start();
    tremolo.start();
    tracks.push(...destination.stream.getAudioTracks());
    return destination.stream;
  };
}

/** Launches the real app with the synthesized voice in place and the Studio exposed. */
export async function launchStudioApp(options: StudioLaunchOptions = {}): Promise<LaunchedApp> {
  const launched = await launchApp(options);
  try {
    await launched.app
      .context()
      .addInitScript(installSyntheticVoice, { hz: MIC_HZ, blocked: !!options.microphoneBlocked });
    await reloadApp(launched.page);
    return launched;
  } catch (error) {
    await launched.close();
    throw error;
  }
}

/** Loads the app again (the init scripts run first) and waits for the Studio. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await waitForStudio(page);
}

/** Waits until the Studio is exposed and has chosen between the wizard and the studio. */
export async function waitForStudio(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const studio = (window as TestWindow).__holoTest;
    return studio !== undefined && studio.store.getState().phase !== 'loading';
  });
}

export function readState(page: Page): Promise<StudioState> {
  return page.evaluate(() => (window as TestWindow).__holoTest!.store.getState());
}

export function readLive(page: Page): Promise<LiveReadouts> {
  return page.evaluate(() => (window as TestWindow).__holoTest!.live);
}

/** Lets the synthesized microphone open again after `microphoneBlocked`. */
export async function allowMicrophone(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as TestWindow).__holoMicrophoneBlocked = false;
  });
}

/**
 * Takes the synthesized microphone away the way unplugging a device does: its tracks end and
 * fire 'ended' (a track the app stops itself never does). With `stayUnplugged`, no microphone
 * can be opened until plugMicrophoneIn.
 */
export async function unplugMicrophone(page: Page, stayUnplugged = false): Promise<void> {
  await page.evaluate((unplugged) => {
    const testWindow = window as TestWindow;
    testWindow.__holoMicrophoneUnplugged = unplugged;
    for (const track of testWindow.__holoMicrophoneTracks ?? []) {
      if (track.readyState === 'ended') continue;
      track.stop();
      track.dispatchEvent(new Event('ended'));
    }
  }, stayUnplugged);
}

/** Makes a microphone available again and announces it, as plugging one in does. */
export async function plugMicrophoneIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as TestWindow).__holoMicrophoneUnplugged = false;
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
}

/** How many synthesized microphone tracks were handed out, and how many are still live. */
export function microphoneTracks(page: Page): Promise<{ opened: number; live: number }> {
  return page.evaluate(() => {
    const tracks = (window as TestWindow).__holoMicrophoneTracks ?? [];
    return {
      opened: tracks.length,
      live: tracks.filter((track) => track.readyState === 'live').length,
    };
  });
}

/**
 * Makes the main process report this operating-system permission status, as macOS does when
 * the singer has refused access. (The real service always answers "granted" under test.)
 */
export async function reportPermission(
  app: ElectronApplication,
  kind: MediaKind,
  status: PermissionStatus,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channels, mediaKind, reported }) => {
      const overrides = ((globalThis as Record<string, unknown>).__holoPermissionOverrides ??=
        {}) as Record<string, string>;
      overrides[mediaKind] = reported;
      for (const channel of channels) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, kind: unknown) =>
          typeof kind === 'string' ? (overrides[kind] ?? 'granted') : 'unknown',
        );
      }
    },
    {
      channels: [IPC_CHANNELS.permissionsGetStatus, IPC_CHANNELS.permissionsRequest],
      mediaKind: kind,
      reported: status,
    },
  );
}

export async function stubSaveDialog(
  app: ElectronApplication,
  filePath: string | null,
): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({ canceled: chosenPath === null, filePath: chosenPath ?? '' });
    dialog.showSaveDialog = stub as typeof dialog.showSaveDialog;
  }, filePath);
}

export async function stubOpenDialog(
  app: ElectronApplication,
  filePath: string | null,
): Promise<void> {
  await app.evaluate(({ dialog }, chosenPath) => {
    const stub = async () => ({
      canceled: chosenPath === null,
      filePaths: chosenPath === null ? [] : [chosenPath],
    });
    dialog.showOpenDialog = stub as typeof dialog.showOpenDialog;
  }, filePath);
}

/** Folders of temporary takes the app still keeps. */
export function takeFolders(userDataDir: string): string[] {
  const takesDir = join(userDataDir, 'takes');
  return existsSync(takesDir) ? readdirSync(takesDir) : [];
}

/** The manifest of the one temporary take the app keeps. */
export function readTakeManifest(userDataDir: string): TakeManifest {
  const [takeId] = takeFolders(userDataDir);
  if (!takeId) throw new Error('There is no take folder');
  const path = join(userDataDir, 'takes', takeId, MANIFEST_FILE);
  return JSON.parse(readFileSync(path, 'utf8')) as TakeManifest;
}
