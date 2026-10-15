import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlarmScheduler } from '../lib/alarm-scheduler';

describe('AlarmScheduler', () => {
  beforeEach(() => fakeBrowser.reset());

  it('creates one named alarm and fires the latest callback', async () => {
    const s = new AlarmScheduler(fakeBrowser.alarms);
    const first = vi.fn();
    const second = vi.fn();
    s.schedule(15, first);
    s.schedule(0.1, second);
    const alarms = await fakeBrowser.alarms.getAll();
    expect(alarms.map((a) => a.name)).toEqual(['clef-autolock']);
    await fakeBrowser.alarms.onAlarm.trigger({ name: 'clef-autolock', scheduledTime: Date.now(), persistAcrossSessions: false });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('ignores other alarms and stops after cancel', async () => {
    const s = new AlarmScheduler(fakeBrowser.alarms);
    const cb = vi.fn();
    s.schedule(1, cb);
    await fakeBrowser.alarms.onAlarm.trigger({ name: 'other', scheduledTime: Date.now(), persistAcrossSessions: false });
    s.cancel();
    await fakeBrowser.alarms.onAlarm.trigger({ name: 'clef-autolock', scheduledTime: Date.now(), persistAcrossSessions: false });
    expect(cb).not.toHaveBeenCalled();
  });
});
