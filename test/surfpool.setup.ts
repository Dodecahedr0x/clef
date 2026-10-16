import type { TestProject } from 'vitest/node';
import { startSurfpool } from './surfpool/server';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const surfpool = await startSurfpool();
  project.provide('surfpoolRpcUrl', surfpool.url);
  return surfpool.stop;
}
