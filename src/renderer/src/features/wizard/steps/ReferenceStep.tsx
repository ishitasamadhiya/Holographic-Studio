import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { WaveformIcon } from '@renderer/ui';
import { settle } from '../components/settle';
import { SongDropZone } from '../components/SongDropZone';
import { type StepAction, StepFrame } from '../components/StepFrame';
import { useWizardNavigation } from '../components/wizardNavigation';
import { referenceFileView } from '../logic/songFileView';

export function ReferenceStep() {
  const actions = useStudioActions();
  const { goNext } = useWizardNavigation();
  const reference = useStudioState((state) => state.reference);
  const view = referenceFileView(reference);

  const chooseFile = () => settle(actions.chooseReferenceSong());
  const skip: StepAction = {
    label: 'Skip',
    onAction: () => {
      // A song that failed is dropped, so the wizard does not go on to "learn" from it.
      if (reference.status === 'failed') actions.clearReferenceSong();
      goNext();
    },
  };
  const choose: StepAction = {
    label: reference.status === 'failed' ? 'Choose another file' : 'Choose a file',
    onAction: chooseFile,
  };

  return (
    <StepFrame
      title="Add the original song"
      lead="It is used only to learn the melody, so autotune can follow it. It is never part of your recording."
      primary={view.hasFile ? undefined : choose}
      secondary={view.hasFile ? undefined : skip}
    >
      <SongDropZone
        label="Original song"
        icon={<WaveformIcon />}
        view={view}
        onChoose={chooseFile}
        onLoadPath={(path) => settle(actions.loadReferenceSong(path))}
        onClear={() => actions.clearReferenceSong()}
        data-testid="wizard-reference-zone"
      />
    </StepFrame>
  );
}
