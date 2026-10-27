type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

/** Structured JSON lines on stdout/stderr. `silent` is for tests. */
export function createLogger({ silent = false }: { silent?: boolean } = {}): Logger {
  const write = (level: Level, msg: string, fields: Fields = {}) => {
    if (silent) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
