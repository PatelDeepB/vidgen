/**
 * Structured logger that avoids raw console.log and masks sensitive tokens.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /nvapi-[A-Za-z0-9_-]{12,}/g,
  /AIza[A-Za-z0-9_-]{16,}/g,
  /gsk_[A-Za-z0-9_-]{16,}/g,
  /sk-or-v1-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /hf_[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9_-]{16,}/g,
  /github_pat_[A-Za-z0-9_-]{16,}/g,
];

/** Redact known API key formats from arbitrary log text. */
export function redactSecrets(rawText: string): string {
  let sanitized = rawText;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "***REDACTED***");
  }
  return sanitized;
}

/** Format a structured log line with ISO timestamp and severity level. */
function formatLogLine(level: LogLevel, message: string, metadata?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const safeMessage = redactSecrets(message);
  if (!metadata || Object.keys(metadata).length === 0) {
    return `[${timestamp}] [${level.toUpperCase()}] ${safeMessage}\n`;
  }
  const safeMeta = redactSecrets(JSON.stringify(metadata));
  return `[${timestamp}] [${level.toUpperCase()}] ${safeMessage} ${safeMeta}\n`;
}

/** Structured application logger writing cleanly to stdout/stderr. */
export class Logger {
  private readonly isDebugEnabled: boolean;

  /** Initialize logger with optional debug verbosity flag. */
  public constructor(isDebugEnabled = false) {
    this.isDebugEnabled = isDebugEnabled;
  }

  /** Write a debug-level log line when debug mode is active. */
  public debug(message: string, metadata?: Record<string, unknown>): void {
    if (!this.isDebugEnabled) {
      return;
    }
    process.stdout.write(formatLogLine("debug", message, metadata));
  }

  /** Write an informational log line to stdout. */
  public info(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(formatLogLine("info", message, metadata));
  }

  /** Write a warning log line to stderr. */
  public warn(message: string, metadata?: Record<string, unknown>): void {
    process.stderr.write(formatLogLine("warn", message, metadata));
  }

  /** Write an error log line to stderr. */
  public error(message: string, metadata?: Record<string, unknown>): void {
    process.stderr.write(formatLogLine("error", message, metadata));
  }
}

/** Write plain user-facing CLI output to stdout without timestamp noise. */
export function writeCliOutput(line: string): void {
  process.stdout.write(`${redactSecrets(line)}\n`);
}
