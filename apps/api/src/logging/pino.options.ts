import type { Options } from 'pino-http';
import type { Env } from '../config/env.js';

/**
 * pino options with explicit redaction (PLAN §14): cookies, auth headers, and
 * PII fields never reach the logs. Prompts/messages are only logged when
 * LOG_PROMPTS=true (default false).
 */
export function pinoOptions(env: Env): Options {
  const options: Options = {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'password',
        '*.password',
        'email',
        '*.email',
        'address',
        '*.address',
        'token',
        '*.token',
        'secret',
        '*.secret',
        'prompt',
        '*.prompt',
        'messages',
        '*.messages',
      ],
      censor: '[REDACTED]',
    },
  };

  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };
  }

  return options;
}
