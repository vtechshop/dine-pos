const isProd = process.env.NODE_ENV === 'production';

type Meta = Record<string, unknown>;

const ts = () => new Date().toISOString();

const emit = (level: string, msg: string, meta?: Meta) => {
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
