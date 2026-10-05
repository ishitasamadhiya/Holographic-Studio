import { VIDEO_RESOLUTIONS, type VideoResolution } from '@shared/settings';
import { useStudioActions, useStudioState } from '@renderer/state/studioContext';
import { FormRow, FormSection, SegmentedControl } from '@renderer/ui';

const RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
] as const satisfies readonly { value: VideoResolution; label: string }[];

export function VideoSection({ locked }: { locked: boolean }) {
  const resolution = useStudioState((state) => state.settings.video.resolution);
  const camera = useStudioState((state) => state.camera);
  const actions = useStudioActions();

  // A camera that cannot deliver the chosen size silently sends another one; say so.
  const delivers =
    camera.status === 'running' &&
    camera.height > 0 &&
    camera.height !== VIDEO_RESOLUTIONS[resolution].height
      ? `Your camera is sending ${camera.width} × ${camera.height}.`
      : 'Sharper at 1080p, lighter on the computer at 720p.';

  return (
    <FormSection title="Video" data-testid="settings-video">
      <FormRow label="Resolution" hint={delivers}>
        <SegmentedControl
          size="sm"
          options={RESOLUTION_OPTIONS}
          value={resolution}
          disabled={locked}
          onChange={(next) => actions.updateSettings({ video: { resolution: next } })}
          data-testid="settings-resolution"
        />
      </FormRow>
    </FormSection>
  );
}
