import { pino, type Logger, type LoggerOptions } from 'pino';
import { currentCorrelation } from './correlation.js';
import { REDACT_PATHS } from './redaction.js';

export interface LoggerConfig {
  service: string;
  level?: LoggerOptions['level'];
  environment: string;
  /** Override destination (tests). */
  destination?: pino.DestinationStream;
}

/**
 * Structured JSON logger with mandatory redaction and automatic correlation fields.
 * One logger per process; child loggers for modules.
 */
export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: { service: config.service, env: config.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    mixin: () => ({ ...currentCorrelation() }),
  };
  return config.destination ? pino(options, config.destination) : pino(options);
}

export type { Logger };
