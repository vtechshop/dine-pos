/**
 * One in-memory MongoDB replica set for the whole Jest run.
 * Starting one per test file in parallel workers timed out under load.
 * Each integration test file connects with its own database name (harness.ts).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export default async function globalSetup(): Promise<void> {
  const repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  (globalThis as any).__IT_MONGO__ = repl;
  // Env changes made here are inherited by the test workers.
  process.env.IT_MONGO_URI = repl.getUri();
}
