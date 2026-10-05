// Converts audio levels into the 0..1 scale a LevelMeter displays. Meters are drawn linear
// in decibels because that is how loudness is perceived: each 6 dB is the same distance.

export const DEFAULT_METER_FLOOR_DB = -60;

/** Maps `floorDb`..0 dBFS onto 0..1. Anything quieter than the floor is 0; above 0 dBFS is 1. */
export function decibelsToMeterLevel(decibels: number, floorDb = DEFAULT_METER_FLOOR_DB): number {
  if (Number.isNaN(decibels)) return 0;
  return Math.min(1, Math.max(0, 1 - decibels / floorDb));
}

/** Maps a linear amplitude (1 = full scale) onto 0..1 via decibels. */
export function amplitudeToMeterLevel(amplitude: number, floorDb = DEFAULT_METER_FLOOR_DB): number {
  if (!(amplitude > 0)) return 0;
  return decibelsToMeterLevel(20 * Math.log10(amplitude), floorDb);
}
