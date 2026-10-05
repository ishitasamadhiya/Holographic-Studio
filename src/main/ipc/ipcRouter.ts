import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { IpcChannel } from './channels';

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type MessageListener = (event: IpcMainEvent, ...args: unknown[]) => void;

/**
 * Registers IPC handlers that only answer the app's own UI. Arguments are typed `unknown`
 * on purpose: every handler has to validate what it was sent.
 */
export class IpcRouter {
  constructor(
    private readonly ipc: IpcMain,
    private readonly isTrustedFrameUrl: (url: string) => boolean,
  ) {}

  /** Request/response (ipcRenderer.invoke). */
  handle(channel: IpcChannel, handler: InvokeHandler): void {
    this.ipc.handle(channel, (event, ...args: unknown[]) => {
      if (!this.isTrusted(event)) {
        throw new Error(`Blocked a call to ${channel} from an untrusted frame`);
      }
      return handler(event, ...args);
    });
  }

  /** One-way messages (ipcRenderer.send). Messages from untrusted frames are dropped. */
  on(channel: IpcChannel, listener: MessageListener): void {
    this.ipc.on(channel, (event, ...args: unknown[]) => {
      if (this.isTrusted(event)) listener(event, ...args);
    });
  }

  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const frameUrl = event.senderFrame?.url;
    return frameUrl !== undefined && this.isTrustedFrameUrl(frameUrl);
  }
}
