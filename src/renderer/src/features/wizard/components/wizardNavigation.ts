import { createContext, useContext } from 'react';
import type { WizardStepId } from '../logic/wizardSteps';

/** How a step moves the wizard. Provided by WizardScreen. */
export interface WizardNavigation {
  stepId: WizardStepId;
  /** Unique id for the step heading, which names the wizard card. */
  headingId: string;
  /** Where a step shows its keyboard shortcut, below the card. Null until it is mounted. */
  shortcutSlot: HTMLElement | null;
  /** False on the first step. */
  canGoBack: boolean;
  goBack(): void;
  /** Moves to the next step that applies. Does nothing on the last step. */
  goNext(): void;
  /** Jumps straight to a step, e.g. back to the headphones choice from its test. */
  goTo(step: WizardStepId): void;
}

export const WizardNavigationContext = createContext<WizardNavigation | null>(null);

export function useWizardNavigation(): WizardNavigation {
  const navigation = useContext(WizardNavigationContext);
  if (!navigation) throw new Error('Wizard steps must be rendered inside WizardScreen');
  return navigation;
}
