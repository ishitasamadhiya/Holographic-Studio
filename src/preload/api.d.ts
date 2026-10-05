import type { HoloApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Bridge to the main process; see src/shared/ipc.ts. */
    holo: HoloApi;
  }
}

export {};
