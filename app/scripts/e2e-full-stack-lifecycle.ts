import { createServer } from 'node:net';
import type { ChildProcess } from 'node:child_process';

export function healthBelongsToRun(value: unknown, runId: string): boolean {
  return typeof value === 'object' && value !== null
    && (value as { status?: unknown }).status === 'ok'
    && (value as { runId?: unknown }).runId === runId;
}

export function signalExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

export function parseWallTimeout(value: string | undefined): number {
  const timeout = Number(value ?? 30 * 60_000);
  if (!Number.isInteger(timeout) || timeout < 1_000) {
    throw new Error('E2E_TIMEOUT_MS must be an integer of at least 1000 milliseconds');
  }
  return timeout;
}

export async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use; refusing to test against an unowned Worker`)
        : error);
    });
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export async function waitForOwnedHealth(
  child: ChildProcess,
  url: string,
  runId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const stopped = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Wrangler failed to start: ${error.message}`)));
    child.once('exit', (code, signal) => reject(new Error(
      `Wrangler exited before readiness (code ${code ?? 'none'}, signal ${signal ?? 'none'})`,
    )));
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await Promise.race([
      fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) })
        .then(async (response) => response.ok && healthBelongsToRun(await response.json(), runId))
        .catch(() => false),
      stopped,
    ]);
    if (ready) return;
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, intervalMs)),
      stopped,
    ]);
  }
  throw new Error(`Wrangler failed to start within ${timeoutMs / 1000}s`);
}
