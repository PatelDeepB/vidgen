import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ConfigurationError } from "../core/errors.js";
import { BUILT_IN_MODELS, BUILT_IN_PROVIDERS, findBuiltInProvider } from "./catalog.js";
import {
  type CustomProviderConfig,
  CustomProviderConfigSchema,
  type KeyStoreFile,
  KeyStoreFileSchema,
  type ModelDefinition,
  type RoutedCandidate,
} from "./types.js";

/** Return the default user-global path for stored API keys (~/.vidgen/keys.json). */
export function getDefaultKeyStorePath(): string {
  return join(homedir(), ".vidgen", "keys.json");
}

/** Mask an API key safely for display in CLI tables and logs. */
export function maskApiKey(secretKey: string): string {
  const trimmed = secretKey.trim();
  if (trimmed.length <= 8) {
    return "****";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/** Read and validate the persisted key store file, returning an empty store if missing. */
export async function loadKeyStore(storePath = getDefaultKeyStorePath()): Promise<KeyStoreFile> {
  try {
    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return KeyStoreFileSchema.parse(parsed);
  } catch (err) {
    if (isFileMissingError(err)) {
      return KeyStoreFileSchema.parse({});
    }
    throw new ConfigurationError("Failed to read vidgen key store", {
      storePath,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Persist the key store cleanly with owner-only file permissions where supported. */
export async function saveKeyStore(
  store: KeyStoreFile,
  storePath = getDefaultKeyStorePath(),
): Promise<void> {
  const validated = KeyStoreFileSchema.parse(store);
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/** Add an API key for a built-in provider (supports multiple keys per provider). */
export async function addBuiltInApiKey(options: {
  providerId: string;
  apiKey: string;
  storePath?: string;
}): Promise<KeyStoreFile> {
  const spec = findBuiltInProvider(options.providerId);
  if (!spec) {
    throw new ConfigurationError(`Unknown built-in provider "${options.providerId}"`, {
      supported: BUILT_IN_PROVIDERS.map((provider) => provider.providerId),
    });
  }
  const cleanKey = options.apiKey.trim();
  if (!cleanKey) {
    throw new ConfigurationError("API key cannot be empty");
  }

  const targetPath = options.storePath ?? getDefaultKeyStorePath();
  const current = await loadKeyStore(targetPath);
  const existing = current.builtInKeys[options.providerId] ?? [];
  const deduplicated = existing.includes(cleanKey) ? existing : [...existing, cleanKey];

  const updated: KeyStoreFile = {
    ...current,
    builtInKeys: {
      ...current.builtInKeys,
      [options.providerId]: deduplicated,
    },
  };
  await saveKeyStore(updated, targetPath);
  return updated;
}

/** Register or update a custom user-supplied API provider/endpoint. */
export async function upsertCustomProvider(options: {
  provider: CustomProviderConfig;
  storePath?: string;
}): Promise<KeyStoreFile> {
  const validated = CustomProviderConfigSchema.parse(options.provider);
  const targetPath = options.storePath ?? getDefaultKeyStorePath();
  const current = await loadKeyStore(targetPath);
  const remaining = current.customProviders.filter((entry) => entry.id !== validated.id);
  const updated: KeyStoreFile = {
    ...current,
    customProviders: [...remaining, validated],
  };
  await saveKeyStore(updated, targetPath);
  return updated;
}

/** Gather all active keys per provider from environment variables and key store. */
export function resolveKeysByProvider(
  store: KeyStoreFile,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, ReadonlyArray<string>> {
  const resolved = new Map<string, string[]>();

  for (const spec of BUILT_IN_PROVIDERS) {
    const collected: string[] = [];
    const envRaw = env[spec.envVarName];
    if (envRaw) {
      for (const piece of envRaw.split(",")) {
        const clean = piece.trim();
        if (clean && !collected.includes(clean)) {
          collected.push(clean);
        }
      }
    }
    for (const stored of store.builtInKeys[spec.providerId] ?? []) {
      const clean = stored.trim();
      if (clean && !collected.includes(clean)) {
        collected.push(clean);
      }
    }
    if (collected.length > 0) {
      resolved.set(spec.providerId, collected);
    }
  }

  return resolved;
}

/** Expand built-in catalog models and custom providers into executable candidates. */
export function buildRoutedCandidates(
  store: KeyStoreFile,
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<RoutedCandidate> {
  const keysByProvider = resolveKeysByProvider(store, env);
  const candidates: RoutedCandidate[] = [];

  for (const model of BUILT_IN_MODELS) {
    const providerKeys = keysByProvider.get(model.providerId) ?? [];
    providerKeys.forEach((apiKey, index) => {
      candidates.push({
        candidateKey: `${model.providerId}:${model.id}:key#${index + 1}`,
        model,
        apiKey,
        isCustom: false,
      });
    });
  }

  for (const custom of store.customProviders) {
    candidates.push({
      candidateKey: `custom:${custom.id}:${custom.modelId}`,
      model: toModelDefinition(custom),
      apiKey: custom.apiKey,
      isCustom: true,
    });
  }

  return candidates.sort((left, right) => left.model.priority - right.model.priority);
}

/** Convert a CustomProviderConfig entry into a standard ModelDefinition. */
function toModelDefinition(custom: CustomProviderConfig): ModelDefinition {
  return {
    id: custom.modelId,
    displayName: `${custom.displayName} (Custom)`,
    providerId: custom.id,
    dialect: custom.dialect,
    baseUrl: custom.baseUrl,
    roles: custom.roles,
    supportsVision: custom.supportsVision,
    supportsJsonMode: custom.supportsJsonMode,
    codingTier: custom.codingTier,
    priority: custom.priority,
    enableThinkingPayload: custom.enableThinkingPayload,
    defaultHeaders: custom.headers,
  };
}

/** Check whether an unknown thrown error represents ENOENT. */
function isFileMissingError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
