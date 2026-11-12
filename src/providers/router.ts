import {
  AllProvidersExhaustedError,
  ConfigurationError,
  ProviderAuthError,
  ProviderRateLimitError,
} from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { executeCandidateCompletion, type FetchImplementation } from "./clients.js";
import type {
  CodingTier,
  CompletionRequest,
  CompletionResponse,
  RoutedCandidate,
} from "./types.js";

const CODING_TIER_RANK: Record<CodingTier, number> = {
  fast: 1,
  medium: 2,
  high: 3,
};

/** Options configuring a ProviderRouter instance. */
export interface ProviderRouterOptions {
  readonly candidates: ReadonlyArray<RoutedCandidate>;
  readonly logger?: Logger;
  readonly fetchImpl?: FetchImplementation;
  readonly nowMs?: () => number;
}

/**
 * Capability-aware multi-provider router with automatic 429 cooldown failover.
 */
export class ProviderRouter {
  private readonly candidates: ReadonlyArray<RoutedCandidate>;
  private readonly logger: Logger | undefined;
  private readonly fetchImpl: FetchImplementation | undefined;
  private readonly nowMs: () => number;
  private readonly cooldowns = new Map<string, number>();

  /** Construct a router over pre-resolved candidate endpoints and keys. */
  public constructor(options: ProviderRouterOptions) {
    this.candidates = options.candidates;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  /** Return all registered candidates without mutating router state. */
  public listCandidates(): ReadonlyArray<RoutedCandidate> {
    return [...this.candidates];
  }

  /** Route a completion request through eligible models, failing over cleanly on 429 or errors. */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const eligible = this.selectEligibleCandidates(request);
    if (eligible.length === 0) {
      throw new ConfigurationError(
        "No configured API keys match the requested capabilities. Run `vidgen keys add` first.",
        { role: request.role, requireVision: Boolean(request.requireVision) },
      );
    }

    const active = this.filterNonCoolingCandidates(eligible);
    const ordered = active.length > 0 ? active : eligible;
    const failureSummaries: string[] = [];

    for (const candidate of ordered) {
      try {
        const result = await executeCandidateCompletion({
          candidate,
          request,
          fetchImpl: this.fetchImpl,
        });
        this.cooldowns.delete(candidate.candidateKey);
        return result;
      } catch (err) {
        const summary = this.handleCandidateFailure(candidate, err);
        failureSummaries.push(summary);
      }
    }

    throw new AllProvidersExhaustedError(failureSummaries);
  }

  /** Filter candidates by role, vision support, minimum coding tier, and preferred provider. */
  private selectEligibleCandidates(request: CompletionRequest): ReadonlyArray<RoutedCandidate> {
    const minRank = request.minCodingTier ? CODING_TIER_RANK[request.minCodingTier] : 0;

    const matching = this.candidates.filter((candidate) => {
      const { model } = candidate;
      if (request.requireVision && !model.supportsVision) {
        return false;
      }
      if (!model.roles.includes(request.role) && !request.requireVision) {
        return false;
      }
      if (CODING_TIER_RANK[model.codingTier] < minRank) {
        return false;
      }
      return true;
    });

    if (!request.preferredProviderId) {
      return matching;
    }
    return [...matching].sort((left, right) => {
      const leftPreferred = left.model.providerId === request.preferredProviderId ? 0 : 1;
      const rightPreferred = right.model.providerId === request.preferredProviderId ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      return left.model.priority - right.model.priority;
    });
  }

  /** Exclude candidates currently inside a rate-limit or auth cooldown window. */
  private filterNonCoolingCandidates(
    candidates: ReadonlyArray<RoutedCandidate>,
  ): ReadonlyArray<RoutedCandidate> {
    const currentMs = this.nowMs();
    return candidates.filter((candidate) => {
      const until = this.cooldowns.get(candidate.candidateKey) ?? 0;
      return until <= currentMs;
    });
  }

  /** Record cooldown windows on 429/401/403 and return a concise diagnostic summary. */
  private handleCandidateFailure(candidate: RoutedCandidate, err: unknown): string {
    const currentMs = this.nowMs();
    if (err instanceof ProviderRateLimitError) {
      this.cooldowns.set(candidate.candidateKey, currentMs + err.retryAfterMs);
      this.logger?.warn("Rate limit hit, failing over to next candidate", {
        candidate: candidate.candidateKey,
        cooldownMs: err.retryAfterMs,
      });
      return `${candidate.candidateKey}: 429 cooldown ${err.retryAfterMs}ms`;
    }
    if (err instanceof ProviderAuthError) {
      this.cooldowns.set(candidate.candidateKey, currentMs + 300_000);
      this.logger?.warn("Authentication error, skipping key", {
        candidate: candidate.candidateKey,
      });
      return `${candidate.candidateKey}: auth failed`;
    }
    const reason = err instanceof Error ? err.message : String(err);
    this.logger?.warn("Candidate failed, trying next", {
      candidate: candidate.candidateKey,
      reason,
    });
    return `${candidate.candidateKey}: ${reason}`;
  }
}
