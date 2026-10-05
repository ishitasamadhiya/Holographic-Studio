// The short recap shown on the wizard's last step.
import type { StudioState } from '@renderer/state/studioTypes';
import { chosenDeviceLabel } from './deviceChoices';

export interface SummaryRow {
  id: 'microphone' | 'recording' | 'camera' | 'headphones' | 'backing' | 'reference';
  label: string;
  value: string;
}

type SummaryState = Pick<StudioState, 'settings' | 'devices' | 'backing' | 'reference'>;

function referenceSummary(reference: StudioState['reference']): string {
  const name = reference.file?.name;
  switch (reference.status) {
    case 'none':
      return 'None';
    case 'loading':
    case 'analyzing':
      return name ? `${name} · still learning the melody` : 'Still learning the melody';
    case 'ready':
      return name ?? 'Added';
    case 'failed':
      return 'Could not be used';
  }
}

function backingSummary(backing: StudioState['backing']): string {
  const name = backing.file?.name;
  switch (backing.status) {
    case 'none':
    case 'failed':
      return 'None · singing a cappella';
    case 'loading':
      return name ? `${name} · opening` : 'Opening';
    case 'ready':
      return name ?? 'Added';
  }
}

export function setupSummary(state: SummaryState): SummaryRow[] {
  const { settings, devices, backing, reference } = state;
  const isVideo = settings.mode === 'video';
  const rows: SummaryRow[] = [
    {
      id: 'microphone',
      label: 'Microphone',
      value: chosenDeviceLabel(devices.microphones, settings.devices.microphoneId),
    },
    {
      id: 'recording',
      label: 'Recording',
      value: isVideo ? 'Video with hand gestures' : 'Audio only with sliders',
    },
  ];
  if (isVideo) {
    rows.push({
      id: 'camera',
      label: 'Camera',
      value: chosenDeviceLabel(devices.cameras, settings.devices.cameraId),
    });
  }
  rows.push(
    {
      id: 'headphones',
      label: 'Headphones',
      value: devices.outputSelectionSupported
        ? chosenDeviceLabel(devices.outputs, settings.devices.outputId)
        : "Your computer's current output",
    },
    { id: 'backing', label: 'Backing track', value: backingSummary(backing) },
    { id: 'reference', label: 'Original song', value: referenceSummary(reference) },
  );
  return rows;
}
