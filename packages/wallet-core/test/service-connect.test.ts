import { describe, expect, it } from 'vitest';
import { ERR } from '../src';
import { A, ORIGIN, setup } from './fixture';

const req = (method: string, params: unknown = {}) => ({ id: 'r', method, params });
const approveA = () => ({ approved: true as const, accounts: [A] });

describe('WalletService connect', () => {
  it('silent connect returns nothing for unknown origins and does not prompt', async () => {
    const { service, approvals } = await setup();
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toEqual({ id: 'r', ok: true, result: { accounts: [] } });
    expect(approvals).toEqual([]);
  });

  it('interactive connect asks, grants, emits and returns the chosen accounts', async () => {
    const { service, approvals, events } = await setup(approveA);
    expect(await service.handle(ORIGIN, req('connect'))).toEqual({ id: 'r', ok: true, result: { accounts: [A] } });
    expect(approvals).toEqual([{ kind: 'connect', origin: ORIGIN, phishing: null }]);
    expect(events).toEqual([{ origin: ORIGIN, accounts: [A] }]);
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [A] } });
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ result: { accounts: [A] } });
    expect(approvals).toHaveLength(1);
  });

  it('rejection maps to 4001', async () => {
    const { service } = await setup(() => ({ approved: false }));
    expect(await service.handle(ORIGIN, req('connect'))).toEqual({ id: 'r', ok: false, error: { code: ERR.USER_REJECTED, message: 'User rejected the request' } });
  });

  it('cannot grant accounts the wallet does not hold, or none at all', async () => {
    for (const accounts of [['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'], [], undefined]) {
      const { service, permissions } = await setup(() => ({ approved: true, accounts }));
      expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ ok: false });
      expect(await permissions.get(ORIGIN)).toBeNull();
    }
  });

  it('disconnect revokes and emits an empty account list', async () => {
    const { service, events } = await setup(approveA);
    await service.handle(ORIGIN, req('connect'));
    expect(await service.handle(ORIGIN, req('disconnect'))).toEqual({ id: 'r', ok: true, result: {} });
    expect(events.at(-1)).toEqual({ origin: ORIGIN, accounts: [] });
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ result: { accounts: [] } });
  });

  it('limits concurrent pending requests per origin, independently per origin', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { service } = await setup(() => gate.then(() => ({ approved: false })));
    const pending = [1, 2, 3].map(() => service.handle(ORIGIN, req('connect')));
    expect(await service.handle(ORIGIN, req('connect'))).toMatchObject({ ok: false, error: { code: ERR.BUSY } });
    const other = service.handle('https://other.example', req('connect'));
    release();
    await Promise.all([...pending, other]);
    expect(await other).toMatchObject({ error: { code: ERR.USER_REJECTED } });
    // the slots are released afterwards
    expect(await service.handle(ORIGIN, req('connect', { silent: true }))).toMatchObject({ ok: true });
  });

  it('rejects malformed requests without throwing and records activity for valid ones', async () => {
    const { service, activityCount } = await setup();
    expect(await service.handle(ORIGIN, { id: 'x', method: 'nope' })).toMatchObject({ id: 'x', ok: false, error: { code: ERR.INVALID_PARAMS } });
    expect(await service.handle(ORIGIN, 'garbage')).toMatchObject({ id: '', ok: false });
    expect(activityCount()).toBe(0);
    await service.handle(ORIGIN, req('connect', { silent: true }));
    expect(activityCount()).toBe(1);
  });
});
