import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { settle } from '../components/settle';
import { SongDropZone } from '../components/SongDropZone';
import { type StepAction, StepFrame } from '../components/StepFrame';
import { useWizardNavigation } from '../components/wizardNavigation';
import { backingFileView } from '../logic/songFileView';

export function BackingStep() {
  const actions = useStudioActions();
  const { goNext } = useWizardNavigation();
  const backing = useStudioState((state) => state.backing);
  const view = backingFileView(backing);

  const chooseFile = () => settle(actions.chooseBackingTrack());
  const skip: StepAction = {
    label: 'Skip: sing a cappella',
    onAction: () => {
      // A file that failed must not follow the singer into the studio as an error.
      if (backing.status === 'failed') actions.clearBackingTrack();
      goNext();
    },
  };
  const choose: StepAction = {
    label: backing.status === 'failed' ? 'Choose another file' : 'Choose a file',
    onAction: chooseFile,
  };

  return (
    <StepFrame
      title="Add a backing track"
      lead="This is the instrumental you sing over. It plays in your headphones and is part of your video."
      primary={view.hasFile ? undefined : choose}
      secondary={view.hasFile ? undefined : skip}
    >
      <SongDropZone
        label="Backing track"
        view={view}
        onChoose={chooseFile}
        onLoadPath={(path) => settle(actions.loadBackingTrack(path))}
        onClear={() => actions.clearBackingTrack()}
        data-testid="wizard-backing-zone"
      />
    </StepFrame>
  );
}
