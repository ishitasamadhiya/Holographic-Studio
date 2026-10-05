import { describe, expect, it } from 'vitest';
import { catalogDevices, isSelectionMissing } from './deviceCatalog';
import { MAX_NOTICES, withNotice, withoutNotice } from './notices';

describe('device catalog', () => {
  it('keeps real devices once each, names unnamed ones, and drops the aliases', () => {
    const catalog = catalogDevices([
      { deviceId: 'default', kind: 'audioinput', label: 'Default - Mic' },
      { deviceId: 'communications', kind: 'audioinput', label: 'Communications - Mic' },
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Mic' },
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Mic' },
      { deviceId: 'mic-2', kind: 'audioinput', label: '' },
      { deviceId: 'out-1', kind: 'audiooutput', label: 'Headphones' },
    ]);
    expect(catalog.microphones).toEqual([
      { id: 'mic-1', label: 'Mic' },
      { id: 'mic-2', label: 'Microphone 2' },
    ]);
    expect(catalog.outputs).toEqual([{ id: 'out-1', label: 'Headphones' }]);
    expect(catalog.cameras).toEqual([]);
    expect(catalog.complete).toEqual({ microphones: true, cameras: false, outputs: true });
  });

  it('only calls a selection missing when the list is known to be complete', () => {
    const before = catalogDevices([{ deviceId: '', kind: 'videoinput', label: '' }]);
    expect(isSelectionMissing('cam-1', before, 'cameras')).toBe(false);
    const after = catalogDevices([{ deviceId: 'cam-2', kind: 'videoinput', label: 'Camera' }]);
    expect(isSelectionMissing('cam-1', after, 'cameras')).toBe(true);
    expect(isSelectionMissing('cam-2', after, 'cameras')).toBe(false);
    expect(isSelectionMissing(null, after, 'cameras')).toBe(false);
  });
});

describe('notices', () => {
  it('does not repeat the newest message, keeps a short queue, and removes by id', () => {
    const first = withNotice([], { id: 'a', kind: 'info', message: 'Saved' });
    expect(withNotice(first, { id: 'b', kind: 'info', message: 'Saved' })).toEqual(first);
    let queue = first;
    for (let index = 0; index < MAX_NOTICES + 2; index++) {
      queue = withNotice(queue, { id: `n${index}`, kind: 'warning', message: `Message ${index}` });
    }
    expect(queue).toHaveLength(MAX_NOTICES);
    expect(queue.at(-1)?.id).toBe(`n${MAX_NOTICES + 1}`);
    expect(withoutNotice(queue, `n${MAX_NOTICES + 1}`)).toHaveLength(MAX_NOTICES - 1);
  });
});
