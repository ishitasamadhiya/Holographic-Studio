import { useCallback, useState } from 'react';
import type { MediaKind } from '@shared/ipc';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { permissionView, type PermissionView } from '../logic/permissionView';

export interface PermissionPrompt {
  view: PermissionView;
  /** True while the system prompt is open (or the status is being re-read). */
  asking: boolean;
  /** Asks the system, or re-reads the status when the singer has already answered. */
  ask(): void;
  openSettings(): void;
}

/** The same ask / blocked / allowed pattern for the microphone and the camera. */
export function usePermission(kind: MediaKind): PermissionPrompt {
  const actions = useStudioActions();
  const status = useStudioState((state) => state.permissions[kind]);
  const [asking, setAsking] = useState(false);

  const ask = useCallback(() => {
    setAsking(true);
    actions
      .requestPermission(kind)
      // The outcome arrives through app state; a failure simply leaves the status as it was.
      .catch(() => undefined)
      .finally(() => setAsking(false));
  }, [actions, kind]);

  const openSettings = useCallback(() => {
    actions.openPermissionSettings(kind);
  }, [actions, kind]);

  return { view: permissionView(status), asking, ask, openSettings };
}
