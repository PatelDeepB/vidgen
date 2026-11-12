import { z } from "zod";

/** Supported wire protocols for LLM API communication. */
export type ApiDialect = "openai-compatible" | "gemini";

/** Task specializations used by the capability router. */
export type TaskRole = "architect" | "coder" | "vision" | "repair";

/** Relative coding strength tier for scene/SVG authoring routing. */
export type CodingTier = "high" | "medium" | "fast";

/** Metadata describing a model available inside a provider endpoint. */
export interface ModelDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly dialect: ApiDialect;
  readonly baseUrl: string;
  readonly roles: ReadonlyArray<TaskRole>;
  readonly supportsVision: boolean;
  readonly supportsJsonMode: boolean;
  readonly codingTier: CodingTier;
  readonly priority: number;
  readonly enableThinkingPayload?: boolean;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

/** Built-in provider descriptor mapping env vars to catalog models. */
export interface BuiltInProviderSpec {
  readonly providerId: string;
  readonly displayName: string;
  readonly envVarName: string;
  readonly dialect: ApiDialect;
  readonly baseUrl: string;
  readonly freeTierNotes: string;
}

/** Zod schema validating user-supplied custom OpenAI or Gemini endpoints. */
export const CustomProviderConfigSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().min(2).max(80),
  dialect: z.enum(["openai-compatible", "gemini"]).default("openai-compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
  roles: z.array(z.enum(["architect", "coder", "vision", "repair"])).min(1).default(["architect", "coder", "repair"]),
  supportsVision: z.boolean().default(false),
  supportsJsonMode: z.boolean().default(true),
  codingTier: z.enum(["high", "medium", "fast"]).default("high"),
  priority: z.number().int().min(1).max(1000).default(50),
  enableThinkingPayload: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;

/** Zod schema for the persisted key store (~/.vidgen/keys.json). */
export const KeyStoreFileSchema = z.object({
  version: z.literal(1).default(1),
  builtInKeys: z.record(z.string(), z.array(z.string().min(1))).default({}),
  customProviders: z.array(CustomProviderConfigSchema).default([]),
});

export type KeyStoreFile = z.infer<typeof KeyStoreFileSchema>;

/** Multimodal or text chat message passed to providers. */
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly imageBase64Png?: string;
}

/** Request parameters accepted by the ProviderRouter. */
export interface CompletionRequest {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly role: TaskRole;
  readonly requireVision?: boolean;
  readonly minCodingTier?: CodingTier;
  readonly preferJsonMode?: boolean;
  readonly preferredProviderId?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly disableThinking?: boolean;
}

/** Normalized completion payload returned by any provider client. */
export interface CompletionResponse {
  readonly rawContent: string;
  readonly cleanContent: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Resolved executable candidate combining a model definition and API key. */
export interface RoutedCandidate {
  readonly candidateKey: string;
  readonly model: ModelDefinition;
  readonly apiKey: string;
  readonly isCustom: boolean;
}
