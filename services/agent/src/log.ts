/**
 * contracts.md §8: one JSON line per event on stdout, `service: "agent"`.
 *
 * Keys, secrets and run tokens are never logged. Callers do not pass them, and as a second layer
 * every registered secret value is scrubbed from each line before it is written, so a provider
 * message that echoed one would still not reach the log. A raw provider `errorMessage` is written
 * only at `debug`, which is off unless `PAPERTREE_AGENT_LOG_LEVEL=debug` (§3.3).
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Register a value that must never appear in a log line (a key, a secret, a run token). */
  redact(value: string): void;
  forget(value: string): void;
}

export interface LoggerOptions {
  readonly level?: Level;
  readonly write?: (line: string) => void;
}

export function parseLevel(raw: string | undefined): Level {
  if (raw === undefined || raw === '') return 'info';
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  throw new Error(`PAPERTREE_AGENT_LOG_LEVEL=${raw} is not one of debug, info, warn, error`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = RANK[options.level ?? 'info'];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const secrets = new Set<string>();

  const emit = (level: Level, event: string, fields: LogFields = {}): void => {
    if (RANK[level] < threshold) return;
    let line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'agent',
      event,
      ...fields,
    });
    for (const secret of secrets) {
      // The raw value and its JSON-escaped form (a value with a quote or backslash is escaped in the line).
      for (const form of [secret, JSON.stringify(secret).slice(1, -1)]) {
        if (line.includes(form)) line = line.split(form).join('[redacted]');
      }
    }
    write(line);
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    redact: (value) => {
      if (value.length >= 8) secrets.add(value);
    },
    forget: (value) => {
      secrets.delete(value);
    },
  };
}
