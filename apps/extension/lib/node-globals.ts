// Some dependencies (the Keystone UR stack's Node `util`/`assert` polyfills) read Node's `process` and `global`
// while their modules load. Extension pages and the service worker have neither, so every entry point imports
// this module first. It defines only what those libraries touch; it never loads Node code.
const g = globalThis as unknown as { process?: unknown; global?: unknown };

if (g.global === undefined) g.global = globalThis;

if (g.process === undefined) {
  const noop = () => {};
  g.process = {
    browser: true,
    env: {},
    version: '',
    versions: {},
    pid: 0,
    noDeprecation: false,
    throwDeprecation: false,
    traceDeprecation: false,
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
    emitWarning: noop,
    emit: noop,
    stdout: { write: noop },
    stderr: { write: noop },
  };
}

export {};
