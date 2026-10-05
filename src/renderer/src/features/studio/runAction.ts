/**
 * Fires a studio action from an event handler. Expected failures already land in app state
 * (as an AppError or a notice); anything else is logged here so that no click or key press
 * can leave an unhandled promise rejection behind.
 */
export function runAction(result: Promise<unknown> | void): void {
  if (result instanceof Promise) {
    result.catch((error: unknown) => {
      console.error('A studio action failed unexpectedly', error);
    });
  }
}
