import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, ChevronLeftIcon, Kbd } from '@renderer/ui';
import { useWizardNavigation } from './wizardNavigation';
import styles from './StepFrame.module.css';

export interface StepAction {
  label: string;
  onAction: () => void;
  /** Shows a spinner and ignores presses while something is in progress. */
  busy?: boolean;
}

export interface StepFrameProps {
  title: string;
  /** The step's one instruction. */
  lead: ReactNode;
  children?: ReactNode;
  /** The big button, also triggered by Enter. Defaults to Continue. */
  primary?: StepAction;
  /** A quiet alternative beside it, e.g. "Skip". */
  secondary?: StepAction;
}

/** Controls that already do something of their own when Enter is pressed on them. */
const ENTER_TARGETS = 'button, a[href], select, input, textarea, [contenteditable="true"]';

function handlesEnterItself(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ENTER_TARGETS) !== null;
}

/**
 * The layout every step shares: heading, one instruction, the step's own content, and the
 * Back / primary buttons. It also owns the step's keyboard behaviour: focus lands on the
 * heading when the step appears, and Enter presses the primary button.
 */
export function StepFrame({ title, lead, children, primary, secondary }: StepFrameProps) {
  const navigation = useWizardNavigation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const primaryAction: StepAction = primary ?? { label: 'Continue', onAction: navigation.goNext };

  // Each step is mounted afresh, so this runs once per step: screen readers announce the
  // new heading and Tab starts from the top of the step.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const latestPrimary = useRef(primaryAction);
  useEffect(() => {
    latestPrimary.current = primaryAction;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (handlesEnterItself(event.target)) return;
      event.preventDefault();
      if (!latestPrimary.current.busy) latestPrimary.current.onAction();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={styles.step} data-testid="wizard-step" data-step={navigation.stepId}>
      <div className={styles.intro}>
        <h1 ref={headingRef} id={navigation.headingId} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <p className={styles.lead}>{lead}</p>
      </div>

      <div className={styles.body} data-testid="wizard-step-body">
        {children}
      </div>

      <footer className={styles.footer}>
        {navigation.canGoBack && (
          <Button
            variant="ghost"
            size="lg"
            iconStart={<ChevronLeftIcon />}
            className={styles.back}
            onClick={navigation.goBack}
            data-testid="wizard-back"
          >
            Back
          </Button>
        )}
        <div className={styles.forward}>
          {secondary && (
            <Button
              variant="ghost"
              size="lg"
              loading={secondary.busy}
              onClick={secondary.onAction}
              data-testid="wizard-secondary"
            >
              {secondary.label}
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            loading={primaryAction.busy}
            onClick={primaryAction.onAction}
            data-testid="wizard-primary"
          >
            {primaryAction.label}
          </Button>
        </div>
      </footer>

      {navigation.shortcutSlot &&
        createPortal(
          <>
            <Kbd>⏎</Kbd> {primaryAction.label}
          </>,
          navigation.shortcutSlot,
        )}
    </div>
  );
}
