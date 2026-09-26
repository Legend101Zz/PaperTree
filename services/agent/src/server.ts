/**
 * `pnpm --filter @papertree/agent start` (contracts.md §3.1): `node --experimental-strip-types
 * src/server.ts`. Binds 127.0.0.1:${PAPERTREE_AGENT_PORT:-8200}.
 *
 * Order matters: the configuration (and the key) is read first, then the process environment is put
 * in the §3.1 state (PI_OFFLINE, PI_TELEMETRY, an empty PI_CODING_AGENT_DIR, no MINIMAX_API_KEY, the
 * key removed from process.env), and only then is any Pi code loaded.
 */
import { ConfigError, preparePiEnvironment, readConfig } from './config.ts';
import { createLogger, parseLevel } from './log.ts';

async function main(): Promise<void> {
  let log = createLogger();
  let config;
  try {
    log = createLogger({ level: parseLevel(process.env['PAPERTREE_AGENT_LOG_LEVEL']) });
    config = readConfig(process.env);
  } catch (error) {
    const reason =
      error instanceof ConfigError || error instanceof Error ? error.message : String(error);
    log.error('agent.boot.refused', { reason });
    process.exitCode = 1;
    return;
  }
  preparePiEnvironment(process.env);
  const { BootError, createAgentApp } = await import('./app.ts');
  let app;
  try {
    app = await createAgentApp({ config, log });
  } catch (error) {
    if (error instanceof BootError)
      log.error('agent.boot.refused', { reason: error.message, problems: error.problems });
    else
      log.error('agent.boot.failed', {
        error_type: error instanceof Error ? error.name : typeof error,
      });
    process.exitCode = 1;
    return;
  }
  const port = await app.listen(config.port);
  const health = app.health();
  log.info('agent.boot', {
    host: '127.0.0.1',
    port,
    sdk: health.sdk,
    pi_ai: health.pi_ai,
    model: health.model,
    faux: health.faux,
    key_present: health.key_present,
    wiring_ok: health.wiring_ok,
  });
  const shutdown = (signal: string): void => {
    log.info('agent.shutdown', { signal });
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

void main();
