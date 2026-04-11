// Check if we're in Edge Runtime (middleware)
const isEdgeRuntime = typeof globalThis.EdgeRuntime !== 'undefined';

// Check if we're in browser
const isBrowser = typeof window !== 'undefined';

// Conditionally import based on runtime
const pino = !isEdgeRuntime && !isBrowser ? require('pino') : null;
type Logger = any;

// Sensitive field patterns to redact
const REDACTED_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'sessionId',
  'session_id',
  'creditCard',
  'credit_card',
  'ssn',
  'socialSecurity',
  'social_security',
  'bankAccount',
  'bank_account',
  'privateKey',
  'private_key',
  'clientSecret',
  'client_secret',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'idToken',
  'id_token'
];

// Get log level from environment variable
const getLogLevel = (): string => {
  const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
  const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  return validLevels.includes(level) ? level : 'info';
};

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production';

// Create a browser/edge-safe mock logger
const createMockLogger = () => {
  const noop = () => {};
  const mockLog = (level: string) => (...args: unknown[]) => {
    if (isBrowser && !isProduction) {
      // eslint-disable-next-line no-console
      (console as any)[level === 'fatal' ? 'error' : level]?.(...args) || console.log(...args);
    }
  };
  return {
    info: mockLog('info'),
    error: mockLog('error'),
    warn: mockLog('warn'),
    debug: mockLog('debug'),
    trace: noop,
    fatal: mockLog('fatal'),
    child: () => createMockLogger(),
  };
};

// Create the base logger with simplified config
const baseLogger = pino ? pino({
  level: getLogLevel(),

  // Format for better readability (both dev and prod for now)
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
    bindings: (bindings: { pid: number; hostname: string }) => {
      return {
        pid: bindings.pid,
        host: bindings.hostname,
        env: process.env.NODE_ENV || 'development'
      };
    }
  },

  // Redaction configuration
  redact: {
    paths: REDACTED_FIELDS.flatMap(field => [
      field,
      `*.${field}`,
      `*.*.${field}`,
      `req.headers.${field}`,
      `res.headers.${field}`,
      `error.${field}`,
      `err.${field}`
    ]),
    censor: '[REDACTED]'
  },

  // Timestamp configuration
  timestamp: pino.stdTimeFunctions.isoTime,

  // Message key
  messageKey: 'msg',

  // Error key
  errorKey: 'error',

  // Pretty print in development for better readability (server-side only)
  ...((!isProduction && typeof process !== 'undefined' && process.stdout?.isTTY) ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: false
      }
    }
  } : {})
}) : createMockLogger();

// Create child loggers for different modules
export const createLogger = (module: string): Logger => {
  return baseLogger.child({ module });
};

// Export different logger instances for different parts of the application
export const logger = baseLogger;
export const apiLogger = createLogger('api');
export const dbLogger = createLogger('database');
export const authLogger = createLogger('auth');
export const sowLogger = createLogger('sow');
export const scriptLogger = createLogger('script');
export const migrationLogger = createLogger('migration');
export const analyticsLogger = createLogger('analytics');
export const procurementLogger = createLogger('procurement');
export const fieldOpsLogger = createLogger('field-ops');

// Helper function to log API requests
export const logApiRequest = (req: any, res: any, responseTime: number, error?: any) => {
  const logData = {
    req,
    res,
    responseTime,
    ...(error && { error })
  };
  
  if (error) {
    apiLogger.error(logData, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
  } else if (res.statusCode >= 400) {
    apiLogger.warn(logData, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
  } else {
    apiLogger.info(logData, `${req.method} ${req.url} - ${res.statusCode} - ${responseTime}ms`);
  }
};

// Helper function to safely log objects
export const safeLog = (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) => {
  try {
    // Remove circular references
    const safeData = data ? JSON.parse(JSON.stringify(data)) : undefined;
    logger[level](safeData, message);
  } catch (err) {
    logger.error({ originalMessage: message, error: err }, 'Failed to log message');
  }
};

// Export log levels for configuration
export const LOG_LEVELS = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
  SILENT: 'silent'
} as const;

export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

// Utility to check if a log level is enabled
export const isLogLevelEnabled = (level: LogLevel): boolean => {
  return logger.isLevelEnabled(level);
};

// Add simplified log export for compatibility
export const log = {
  info: (...args: any[]) => logger.info(...args),
  error: (...args: any[]) => logger.error(...args),
  warn: (...args: any[]) => logger.warn(...args),
  debug: (...args: any[]) => logger.debug(...args)
};

export default logger;