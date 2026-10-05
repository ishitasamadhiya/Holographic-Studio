// Rate limiting for values that change far more often than their consumer wants to hear
// about them (a 60 fps meter level versus a screen reader).

export interface LatestValueThrottle<Value> {
  /**
   * Delivers `value` now when the consumer has been left alone for a full interval;
   * otherwise remembers it (replacing any earlier one) and delivers it when the interval
   * ends. The last value pushed is therefore always delivered, even if pushes stop.
   */
  push(value: Value): void;
  /** Delivers `value` immediately, whatever the timing, and drops any remembered value. */
  flush(value: Value): void;
  /** Drops any remembered value and pending delivery. The throttle can be used again. */
  cancel(): void;
}

export function createLatestValueThrottle<Value>(
  intervalMs: number,
  deliver: (value: Value) => void,
): LatestValueThrottle<Value> {
  // The timer runs while the consumer is "resting" after a delivery.
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  // A flag next to the value (rather than a wrapper object) so a push allocates nothing.
  let hasWaiting = false;
  let waiting: Value | undefined;

  const deliverAndRest = (value: Value) => {
    hasWaiting = false;
    waiting = undefined;
    deliver(value);
    restTimer = setTimeout(() => {
      restTimer = undefined;
      if (hasWaiting) deliverAndRest(waiting as Value);
    }, intervalMs);
  };

  const cancel = () => {
    clearTimeout(restTimer);
    restTimer = undefined;
    hasWaiting = false;
    waiting = undefined;
  };

  return {
    push(value) {
      if (restTimer === undefined) {
        deliverAndRest(value);
      } else {
        hasWaiting = true;
        waiting = value;
      }
    },
    flush(value) {
      cancel();
      deliverAndRest(value);
    },
    cancel,
  };
}
