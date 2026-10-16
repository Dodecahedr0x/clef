// Validator plumbing for e2e specs: the same offline surfpool + snapshot the `local` Vitest project uses.
export { startSurfpool, type Surfpool } from '../test/surfpool/server';
export { fund, fundToken, rpcCall, timeTravel } from '../test/surfpool/cheats';
