export default async function globalTeardown(): Promise<void> {
  const repl = (globalThis as any).__IT_MONGO__;
  if (repl) await repl.stop();
}
