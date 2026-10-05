// Sheets, dialogs and other modal layers register here while they are open so that only the
// top-most one reacts to Escape and traps focus when several are stacked.

export interface OverlayRegistration {
  isTopMost(): boolean;
  release(): void;
}

export interface OverlayStack {
  register(): OverlayRegistration;
  readonly size: number;
}

export function createOverlayStack(): OverlayStack {
  const open: symbol[] = [];

  return {
    register() {
      const token = Symbol('overlay');
      open.push(token);
      return {
        isTopMost: () => open[open.length - 1] === token,
        release: () => {
          const index = open.indexOf(token);
          if (index >= 0) open.splice(index, 1);
        },
      };
    },
    get size() {
      return open.length;
    },
  };
}

export const overlayStack = createOverlayStack();
