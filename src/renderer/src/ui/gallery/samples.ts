// Sample content shared by several gallery sections.
import { vocalVolumeToDb } from '@shared/controls';

/** A real-world worst case: a long file name with no spaces to wrap at. */
export const LONG_FILE_NAME =
  'Artist_Name_-_A_Very_Long_Song_Title_(Official_Instrumental_Karaoke_Version)_final_mix_v2.mp3';

/** The vocal volume control (0..1) as signed decibels, e.g. "+2.0 dB" or "-12.0 dB". */
export function formatDecibels(normalized: number): string {
  const decibels = vocalVolumeToDb(normalized);
  return `${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`;
}
