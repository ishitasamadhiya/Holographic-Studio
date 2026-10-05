import { useState } from 'react';
import { useStudioActions } from '@renderer/state/studioContext';
import { Button, HeadphonesIcon, PlayIcon } from '@renderer/ui';
import { type StepAction, StepFrame } from '../components/StepFrame';
import { useWizardNavigation } from '../components/wizardNavigation';
import styles from './steps.module.css';

type TestStage =
  /** The sound has not been played yet. */
  | 'ready'
  /** Played at least once; waiting for the singer's answer. */
  | 'played'
  /** The singer heard nothing; tips are showing. */
  | 'trouble';

const STAGE_PROMPTS: Record<TestStage, string> = {
  ready: 'You will hear a soft chime, about one second long.',
  played: 'Did you hear the chime in your headphones?',
  trouble: 'Let’s fix that. Try these, then play it again.',
};

export function HeadphoneTestStep() {
  const actions = useStudioActions();
  const { goNext, goTo } = useWizardNavigation();
  const [stage, setStage] = useState<TestStage>('ready');
  const [isPlaying, setIsPlaying] = useState(false);

  const playTestSound = () => {
    if (isPlaying) return;
    setIsPlaying(true);
    actions
      .playTestSound()
      // A failure to play is exactly what "I didn't hear anything" is there for.
      .catch(() => undefined)
      .finally(() => {
        setIsPlaying(false);
        setStage((current) => (current === 'ready' ? 'played' : current));
      });
  };

  const primary: StepAction =
    stage === 'ready'
      ? { label: 'Play test sound', onAction: playTestSound, busy: isPlaying }
      : { label: 'I heard it', onAction: goNext };
  const secondary: StepAction | undefined =
    stage === 'played'
      ? { label: 'I didn’t hear anything', onAction: () => setStage('trouble') }
      : undefined;

  return (
    <StepFrame
      title="Test your headphones"
      lead="Put your headphones on and play a short sound."
      primary={primary}
      secondary={secondary}
    >
      <div className={styles.testSound}>
        <span className={styles.testSoundIcon} aria-hidden="true">
          <HeadphonesIcon size={26} />
        </span>
        <p
          className={styles.testSoundPrompt}
          role="status"
          aria-live="polite"
          data-testid="wizard-test-sound-prompt"
        >
          {STAGE_PROMPTS[stage]}
        </p>

        {stage === 'trouble' && (
          <ul className={styles.tips} data-testid="wizard-test-sound-tips">
            <li>Turn up the volume on your computer and on your headphones.</li>
            <li>Make sure the right headphones are chosen.</li>
          </ul>
        )}

        {stage !== 'ready' && (
          <div className={styles.actions}>
            <Button
              iconStart={<PlayIcon />}
              loading={isPlaying}
              onClick={playTestSound}
              data-testid="wizard-play-again"
            >
              Play it again
            </Button>
            {stage === 'trouble' && (
              <Button onClick={() => goTo('headphones')} data-testid="wizard-change-headphones">
                Choose different headphones
              </Button>
            )}
          </div>
        )}
      </div>
    </StepFrame>
  );
}
