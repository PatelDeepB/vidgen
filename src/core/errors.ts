/**
 * Typed domain error hierarchy for the vidgen pipeline.
 */

/** Base error class for all recoverable and fatal vidgen errors. */
export class VidgenError extends Error {
  public readonly code: string;
  public readonly isRecoverable: boolean;
  public readonly context: Record<string, unknown>;

  /** Create a structured VidgenError with optional context metadata. */
  public constructor(options: {
    message: string;
    code: string;
    isRecoverable?: boolean;
    context?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = new.target.name;
    this.code = options.code;
    this.isRecoverable = options.isRecoverable ?? false;
    this.context = options.context ?? {};
  }
}

/** Raised when user configuration or key setup is missing or invalid. */
export class ConfigurationError extends VidgenError {
  /** Create a configuration error. */
  public constructor(message: string, context?: Record<string, unknown>) {
    super({ message, code: "CONFIGURATION_ERROR", isRecoverable: false, context });
  }
}

/** Raised when a provider rejects credentials (HTTP 401/403). */
export class ProviderAuthError extends VidgenError {
  /** Create an authentication error tied to a provider identifier. */
  public constructor(providerId: string, statusCode: number) {
    super({
      message: `Authentication failed for provider "${providerId}" (HTTP ${statusCode})`,
      code: "PROVIDER_AUTH_ERROR",
      isRecoverable: true,
      context: { providerId, statusCode },
    });
  }
}

/** Raised when a provider returns HTTP 429 or hits quota limits. */
export class ProviderRateLimitError extends VidgenError {
  public readonly retryAfterMs: number;

  /** Create a rate-limit error with computed cooldown duration. */
  public constructor(providerId: string, retryAfterMs: number) {
    super({
      message: `Rate limit hit for provider "${providerId}", cooling down for ${retryAfterMs}ms`,
      code: "PROVIDER_RATE_LIMIT",
      isRecoverable: true,
      context: { providerId, retryAfterMs },
    });
    this.retryAfterMs = retryAfterMs;
  }
}

/** Raised when a provider returns malformed HTTP payloads or network errors. */
export class ProviderResponseError extends VidgenError {
  /** Create a provider response error. */
  public constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "PROVIDER_RESPONSE_ERROR",
      isRecoverable: true,
      context,
    });
  }
}

/** Raised when schema or storyboard density validation fails. */
export class ValidationError extends VidgenError {
  /** Create a validation error with detailed field issues. */
  public constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "VALIDATION_ERROR",
      isRecoverable: true,
      context,
    });
  }
}

/** Raised when every eligible model/key in the provider pool fails. */
export class AllProvidersExhaustedError extends VidgenError {
  /** Create an exhaustion error listing per-attempt failure summaries. */
  public constructor(attempts: ReadonlyArray<string>) {
    super({
      message: `All eligible providers failed (${attempts.length} attempts): ${attempts.join(" | ")}`,
      code: "ALL_PROVIDERS_EXHAUSTED",
      isRecoverable: false,
      context: { attempts },
    });
  }
}
