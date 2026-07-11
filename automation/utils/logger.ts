import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '../reports/logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class TestLogger {
  private logFile: string;
  private buffer: string[] = [];

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(LOG_DIR, `test-run-${timestamp}.log`);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta !== undefined ? { meta } : {}),
    });
    this.buffer.push(entry);
    if (this.buffer.length >= 50) this.flush();

    if (level === 'error') {
      console.error(`[${level.toUpperCase()}] ${message}`, meta ?? '');
    } else if (process.env.DEBUG) {
      console.log(`[${level.toUpperCase()}] ${message}`, meta ?? '');
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    fs.appendFileSync(this.logFile, this.buffer.join('\n') + '\n', 'utf8');
    this.buffer = [];
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  request(method: string, url: string, status: number, durationMs: number): void {
    this.write('info', `${method} ${url} → ${status} (${durationMs}ms)`);
  }
}

export const logger = new TestLogger();

process.on('exit', () => logger.flush());
process.on('SIGINT', () => { logger.flush(); process.exit(0); });
