import { type ComponentType, useId, useMemo, useState } from 'react';
import { useStudioState } from '@renderer/state/studioContext';
import { AppMark, cx, GlassPanel, Stepper, type StepperStep } from '@renderer/ui';
import { type WizardNavigation, WizardNavigationContext } from './components/wizardNavigation';
import {
  applicableSteps,
  nextStep,
  previousStep,
  resolveStep,
  stepProgress,
  type WizardContext,
  type WizardStepId,
} from './logic/wizardSteps';
import { BackingStep } from './steps/BackingStep';
import { HandsStep } from './steps/HandsStep';
import { HeadphonesStep } from './steps/HeadphonesStep';
import { HeadphoneTestStep } from './steps/HeadphoneTestStep';
import { MelodyStep } from './steps/MelodyStep';
import { MicrophoneStep } from './steps/MicrophoneStep';
import { MicTestStep } from './steps/MicTestStep';
import { ModeStep } from './steps/ModeStep';
import { MonitoringStep } from './steps/MonitoringStep';
import { ReadyStep } from './steps/ReadyStep';
import { ReferenceStep } from './steps/ReferenceStep';
import styles from './WizardScreen.module.css';

const STEPS: Record<WizardStepId, { label: string; Component: ComponentType }> = {
  microphone: { label: 'Choose your microphone', Component: MicrophoneStep },
  mode: { label: 'Camera or Audio Only', Component: ModeStep },
  headphones: { label: 'Choose your headphones', Component: HeadphonesStep },
  'mic-test': { label: 'Test your microphone', Component: MicTestStep },
  'headphone-test': { label: 'Test your headphones', Component: HeadphoneTestStep },
  monitoring: { label: 'Hear yourself', Component: MonitoringStep },
  hands: { label: 'Try your hands', Component: HandsStep },
  backing: { label: 'Add a backing track', Component: BackingStep },
  reference: { label: 'Add the original song', Component: ReferenceStep },
  melody: { label: 'Learning the melody', Component: MelodyStep },
  ready: { label: 'You’re ready', Component: ReadyStep },
};

export interface WizardScreenProps {
  /** Where to open the wizard. Only developer previews start anywhere but the beginning. */
  initialStep?: WizardStepId;
}

/**
 * The first-run setup: one small decision per step, from choosing a microphone to entering
 * the studio. Steps that do not apply (hand control in Audio Only mode, melody analysis
 * without a reference song) are left out of the sequence.
 */
export function WizardScreen({ initialStep = 'microphone' }: WizardScreenProps) {
  const mode = useStudioState((state) => state.settings.mode);
  const hasReference = useStudioState((state) => state.reference.status !== 'none');
  const context = useMemo<WizardContext>(() => ({ mode, hasReference }), [mode, hasReference]);

  const [requestedStep, setRequestedStep] = useState<WizardStepId>(initialStep);
  const [shortcutSlot, setShortcutSlot] = useState<HTMLElement | null>(null);
  const headingId = useId();

  // The step asked for may have stopped applying (the app fell back to Audio Only while
  // the singer was trying their hands); the wizard then shows the next one that does.
  const stepId = resolveStep(requestedStep, context);
  const steps = applicableSteps(context);
  const progress = stepProgress(stepId, context);

  const navigation = useMemo<WizardNavigation>(() => {
    const back = previousStep(stepId, context);
    const forward = nextStep(stepId, context);
    return {
      stepId,
      headingId,
      shortcutSlot,
      canGoBack: back !== null,
      goBack: () => {
        if (back) setRequestedStep(back);
      },
      goNext: () => {
        if (forward) setRequestedStep(forward);
      },
      goTo: setRequestedStep,
    };
  }, [stepId, context, headingId, shortcutSlot]);

  const stepperSteps: StepperStep[] = steps.map((id) => ({ id, label: STEPS[id].label }));
  const { Component: StepComponent } = STEPS[stepId];

  return (
    <main className={styles.screen} data-testid="wizard-screen">
      <div className={styles.aurora} aria-hidden="true" />
      {/* The window has no title bar of its own: this strip is what moves it. */}
      <div className={cx(styles.dragStrip, 'app-drag')} />

      <GlassPanel
        as="section"
        variant="strong"
        elevation="floating"
        radius="xl"
        padding="none"
        className={cx(styles.card, 'app-no-drag')}
        aria-labelledby={headingId}
        data-testid="wizard-card"
      >
        <header className={styles.header}>
          <AppMark size={24} />
          <span className={styles.appName}>Holographic Studio</span>
          <Stepper
            steps={stepperSteps}
            currentIndex={progress.index}
            className={styles.stepper}
            data-testid="wizard-stepper"
          />
          <span className={styles.stepCount} aria-hidden="true" data-testid="wizard-step-count">
            Step {progress.index + 1} of {progress.count}
          </span>
        </header>

        <WizardNavigationContext.Provider value={navigation}>
          <StepComponent key={stepId} />
        </WizardNavigationContext.Provider>
      </GlassPanel>

      <p ref={setShortcutSlot} className={styles.shortcut} data-testid="wizard-shortcut" />
    </main>
  );
}
