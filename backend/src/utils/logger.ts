import { Logtail } from '@logtail/node';

const isProd = process.env.NODE_ENV === 'production';

// When LOGTAIL_SOURCE_TOKEN is set, forward logs to Logtail (Better Stack).
// In production without the token, JSON goes to stdout for Render's log drain.
const logtail = process.env.LOGTAIL_SOURCE_TOKEN
  ? new Logtail(process.env.LOGTAIL_SOURCE_TOKEN)
  : null;

type Meta = Record<string, unknown>;

const ts = () => new Date().toISOString();

const emit = (level: string, msg: string, meta?: Meta) => {
  if (logtail) {
    if (level === 'error') logtail.error(msg, meta);
    else if (level === 'warn')  logtail.warn(msg, meta);
    else                        logtail.info(msg, meta);
  }

  if (isProd) {
    process.stdout.write(JSON.stringify({ level, msg, ts: ts(), ...meta }) + '\n');
  } else {
    const tag = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
    console.log(`${tag} ${msg}`, meta ? meta : '');
  }
};

export const logger = {
  info:  (msg: string, meta?: Meta) => emit('info',  msg, meta),
  warn:  (msg: string, meta?: Meta) => emit('warn',  msg, meta),
  error: (msg: string, meta?: Meta) => emit('error', msg, meta),
};
