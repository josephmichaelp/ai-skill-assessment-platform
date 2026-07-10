/**
 * Bedrock Integration Layer
 * Shared utility for invoking Amazon Bedrock models with token tracking and retry logic.
 *
 * Models:
 * - amazon.nova-lite-v1:0 — text generation (quiz, roleplay, review, summary, promotion, gap analysis)
 * - cohere.embed-multilingual-v3 — text embeddings (1024 dims)
 *
 * Region: ap-southeast-3 (Jakarta)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { TokenUsageRecord } from './types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const REGION = 'ap-southeast-3';
const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';
const COHERE_EMBED_MODEL_ID = 'cohere.embed-multilingual-v3';
const MONTHLY_TOKEN_LIMIT = 500_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TABLE_NAME = process.env.TABLE_NAME || 'platform-data';

// ─── Feature Token Limits ──────────────────────────────────────────────────────

export const FEATURE_TOKEN_LIMITS: Record<string, { maxInput: number; maxOutput: number }> = {
  quizGeneration: { maxInput: 800, maxOutput: 1000 },
  roleplayTurn: { maxInput: 2000, maxOutput: 500 },
  assignmentReview: { maxInput: 4000, maxOutput: 2000 },
  performanceSummary: { maxInput: 3000, maxOutput: 1500 },
  gapAnalysis: { maxInput: 600, maxOutput: 800 },
  promotionInsights: { maxInput: 1500, maxOutput: 1000 },
};

// ─── Clients ───────────────────────────────────────────────────────────────────

const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface InvokeModelParams {
  /** System persona description */
  systemPrompt: string;
  /** User content / conversation context */
  userContent: string;
  /** Language for the response */
  language: 'id' | 'en';
  /** Feature name for token tracking */
  feature: string;
  /** Organization ID for token tracking */
  orgId: string;
  /** Maximum output tokens (defaults to feature limit) */
  maxOutputTokens?: number;
}

export interface InvokeModelResult {
  /** Generated text content */
  content: string;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Total tokens consumed */
  totalTokens: number;
}

export interface EmbeddingParams {
  /** Text(s) to embed */
  texts: string[];
  /** Organization ID for token tracking */
  orgId: string;
  /** Feature name for token tracking */
  feature: string;
}

export interface TokenUsageIncrement {
  /** Model used */
  model: typeof NOVA_LITE_MODEL_ID | typeof COHERE_EMBED_MODEL_ID;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Feature that consumed the tokens */
  feature: string;
}

// ─── Errors ────────────────────────────────────────────────────────────────────

export class TokenLimitExceededError extends Error {
  public readonly orgId: string;
  public readonly currentUsage: number;
  public readonly limit: number;
  public readonly estimatedTokens: number;

  constructor(orgId: string, currentUsage: number, limit: number, estimatedTokens: number) {
    super(
      `Token limit exceeded for organization ${orgId}. ` +
      `Current usage: ${currentUsage}/${limit}. ` +
      `Requested: ${estimatedTokens}. ` +
      `Please wait until the next billing month or contact your administrator.`
    );
    this.name = 'TokenLimitExceededError';
    this.orgId = orgId;
    this.currentUsage = currentUsage;
    this.limit = limit;
    this.estimatedTokens = estimatedTokens;
  }
}

export class BedrockInvocationError extends Error {
  public readonly retryable: boolean;
  public readonly attempts: number;

  constructor(message: string, retryable: boolean, attempts: number) {
    super(
      `${message} (after ${attempts} attempt(s)). ` +
      (retryable
        ? 'This may be a transient issue. Please retry the operation in a few moments.'
        : 'Please verify your input and try again. If the issue persists, contact support.')
    );
    this.name = 'BedrockInvocationError';
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

// ─── Token Limit Management ────────────────────────────────────────────────────

/**
 * Check if the organization has sufficient token budget for the estimated usage.
 * Throws TokenLimitExceededError if the organization is at or over the monthly limit.
 *
 * Requirement 9.2: Reject AI requests when token limit is reached.
 */
export async function checkTokenLimit(orgId: string, estimatedTokens: number): Promise<void> {
  const month = getCurrentMonth();
  const pk = `ORG#${orgId}`;
  const sk = `TOKENUSAGE#${month}`;

  const result = await dynamoClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: 'totalTokensUsed, monthlyTokenLimit',
    })
  );

  const record = result.Item as Pick<TokenUsageRecord, 'totalTokensUsed' | 'monthlyTokenLimit'> | undefined;
  const currentUsage = record?.totalTokensUsed ?? 0;
  const limit = record?.monthlyTokenLimit ?? MONTHLY_TOKEN_LIMIT;

  if (currentUsage + estimatedTokens > limit) {
    throw new TokenLimitExceededError(orgId, currentUsage, limit, estimatedTokens);
  }
}

/**
 * Atomically increment the token usage for an organization.
 * Updates total usage, per-model breakdown, per-feature breakdown, and daily usage.
 *
 * Requirement 9.1: Track tokens consumed per org per month.
 */
export async function incrementTokenUsage(orgId: string, tokens: TokenUsageIncrement): Promise<void> {
  const month = getCurrentMonth();
  const today = getCurrentDate();
  const pk = `ORG#${orgId}`;
  const sk = `TOKENUSAGE#${month}`;
  const totalTokens = tokens.inputTokens + tokens.outputTokens;

  const isNovaLite = tokens.model === NOVA_LITE_MODEL_ID;
  const modelKey = tokens.model;

  await dynamoClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: `
        SET orgId = if_not_exists(orgId, :orgId),
            #month = if_not_exists(#month, :month),
            monthlyTokenLimit = if_not_exists(monthlyTokenLimit, :limit),
            lastUpdatedAt = :now
        ADD totalTokensUsed :totalTokens,
            ${isNovaLite ? 'novaLiteTokensUsed' : 'cohereEmbedTokensUsed'} :totalTokens,
            ${isNovaLite ? 'novaLiteInputTokens' : 'cohereEmbedTokensUsed'} :inputTokens,
            ${isNovaLite ? 'novaLiteOutputTokens' : 'cohereEmbedTokensUsed'} :outputTokens,
            breakdownByFeature.#feature :totalTokens,
            breakdownByModel.#modelKey.input :inputTokens,
            breakdownByModel.#modelKey.output :outputTokens,
            breakdownByModel.#modelKey.total :totalTokens,
            dailyUsage.#today :totalTokens
      `,
      ExpressionAttributeNames: {
        '#month': 'month',
        '#feature': tokens.feature,
        '#modelKey': modelKey,
        '#today': today,
      },
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':month': month,
        ':limit': MONTHLY_TOKEN_LIMIT,
        ':now': new Date().toISOString(),
        ':totalTokens': totalTokens,
        ':inputTokens': tokens.inputTokens,
        ':outputTokens': tokens.outputTokens,
      },
    })
  );
}

// ─── Bedrock Invocation ────────────────────────────────────────────────────────

/**
 * Invoke Amazon Bedrock Nova Lite model for text generation (non-streaming).
 * Includes prompt construction with system persona, language instruction, and user content.
 * Enforces token limits before invocation and tracks usage after.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export async function invokeModel(params: InvokeModelParams): Promise<InvokeModelResult> {
  const { systemPrompt, userContent, language, feature, orgId, maxOutputTokens } = params;
  const featureLimits = FEATURE_TOKEN_LIMITS[feature];
  const maxOutput = maxOutputTokens ?? featureLimits?.maxOutput ?? 1000;

  // Estimate tokens for limit check (rough estimate: input chars / 4 + max output)
  const estimatedInput = Math.ceil(
    (systemPrompt.length + userContent.length) / 4
  );
  const estimatedTokens = estimatedInput + maxOutput;

  // Check token limit before invocation (Requirement 9.2)
  await checkTokenLimit(orgId, estimatedTokens);

  // Construct prompt with language instruction (Requirement 9.5)
  const languageInstruction = language === 'id'
    ? 'Respond in Bahasa Indonesia.'
    : 'Respond in English.';

  const fullSystemPrompt = `${systemPrompt}\n\n${languageInstruction}`;

  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: userContent }],
      },
    ],
    system: [{ text: fullSystemPrompt }],
    inferenceConfig: {
      maxTokens: maxOutput,
      temperature: 0.7,
      topP: 0.9,
    },
  };

  // Invoke with retry logic (Requirement 9.3)
  const response = await invokeWithRetry(
    NOVA_LITE_MODEL_ID,
    JSON.stringify(requestBody)
  );

  // Parse response
  const responseBody = JSON.parse(new TextDecoder().decode(response));
  const content = responseBody.output?.message?.content?.[0]?.text ?? '';
  const usage = responseBody.usage ?? {};
  const inputTokens = usage.inputTokens ?? estimatedInput;
  const outputTokens = usage.outputTokens ?? Math.ceil(content.length / 4);
  const totalTokens = inputTokens + outputTokens;

  // Increment token usage after successful invocation (Requirement 9.1)
  await incrementTokenUsage(orgId, {
    model: NOVA_LITE_MODEL_ID,
    inputTokens,
    outputTokens,
    feature,
  });

  return { content, inputTokens, outputTokens, totalTokens };
}

/**
 * Invoke Amazon Bedrock Nova Lite model with streaming for roleplay.
 * Yields text chunks as they arrive.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5
 */
export async function* invokeModelStreaming(
  params: InvokeModelParams
): AsyncGenerator<string, void, undefined> {
  const { systemPrompt, userContent, language, feature, orgId, maxOutputTokens } = params;
  const featureLimits = FEATURE_TOKEN_LIMITS[feature];
  const maxOutput = maxOutputTokens ?? featureLimits?.maxOutput ?? 500;

  // Estimate tokens for limit check
  const estimatedInput = Math.ceil(
    (systemPrompt.length + userContent.length) / 4
  );
  const estimatedTokens = estimatedInput + maxOutput;

  // Check token limit before invocation (Requirement 9.2)
  await checkTokenLimit(orgId, estimatedTokens);

  // Construct prompt with language instruction (Requirement 9.5)
  const languageInstruction = language === 'id'
    ? 'Respond in Bahasa Indonesia.'
    : 'Respond in English.';

  const fullSystemPrompt = `${systemPrompt}\n\n${languageInstruction}`;

  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: userContent }],
      },
    ],
    system: [{ text: fullSystemPrompt }],
    inferenceConfig: {
      maxTokens: maxOutput,
      temperature: 0.7,
      topP: 0.9,
    },
  };

  // Invoke streaming with retry logic (Requirement 9.3)
  const response = await invokeStreamingWithRetry(
    NOVA_LITE_MODEL_ID,
    JSON.stringify(requestBody)
  );

  let totalOutput = '';
  let inputTokens = estimatedInput;
  let outputTokens = 0;

  if (response.body) {
    for await (const event of response.body) {
      if (event.chunk?.bytes) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

        // Handle content block delta
        if (chunk.contentBlockDelta?.delta?.text) {
          const text = chunk.contentBlockDelta.delta.text;
          totalOutput += text;
          yield text;
        }

        // Capture usage metadata from the final message
        if (chunk.metadata?.usage) {
          inputTokens = chunk.metadata.usage.inputTokens ?? inputTokens;
          outputTokens = chunk.metadata.usage.outputTokens ?? Math.ceil(totalOutput.length / 4);
        }
      }
    }
  }

  // If we didn't get usage from metadata, estimate output tokens
  if (outputTokens === 0) {
    outputTokens = Math.ceil(totalOutput.length / 4);
  }

  // Increment token usage after successful streaming (Requirement 9.1)
  await incrementTokenUsage(orgId, {
    model: NOVA_LITE_MODEL_ID,
    inputTokens,
    outputTokens,
    feature,
  });
}

/**
 * Invoke Cohere Embed Multilingual v3 for text embeddings.
 * Returns a 1024-dimension vector for each input text.
 *
 * Requirements: 9.1, 9.2
 */
export async function invokeEmbedding(params: EmbeddingParams): Promise<number[]> {
  const { texts, orgId, feature } = params;

  // Estimate tokens (Cohere embedding uses ~1 token per word)
  const estimatedTokens = texts.reduce(
    (sum, text) => sum + Math.ceil(text.split(/\s+/).length * 1.3),
    0
  );

  // Check token limit before invocation (Requirement 9.2)
  await checkTokenLimit(orgId, estimatedTokens);

  const requestBody = {
    texts,
    input_type: 'search_document',
    truncate: 'END',
  };

  // Invoke with retry logic (Requirement 9.3)
  const response = await invokeWithRetry(
    COHERE_EMBED_MODEL_ID,
    JSON.stringify(requestBody)
  );

  // Parse response
  const responseBody = JSON.parse(new TextDecoder().decode(response));
  const embeddings: number[][] = responseBody.embeddings ?? [];

  // Track token usage (Requirement 9.1)
  const actualTokens = responseBody.meta?.billed_units?.input_tokens ?? estimatedTokens;
  await incrementTokenUsage(orgId, {
    model: COHERE_EMBED_MODEL_ID,
    inputTokens: actualTokens,
    outputTokens: 0,
    feature,
  });

  // Return first embedding (most common use case: single text)
  return embeddings[0] ?? [];
}

// ─── Retry Logic ───────────────────────────────────────────────────────────────

/**
 * Invoke Bedrock with retry logic: 3 attempts, exponential backoff.
 * Requirement 9.3: Retry up to 3 times with exponential backoff.
 * Requirement 9.4: Return human-readable error with retry suggestion on failure.
 */
async function invokeWithRetry(modelId: string, body: string): Promise<Uint8Array> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: new TextEncoder().encode(body),
      });

      const response = await bedrockClient.send(command);
      return response.body!;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw new BedrockInvocationError(
    lastError?.message ?? 'Unknown Bedrock invocation error',
    isRetryableError(lastError),
    MAX_RETRIES
  );
}

/**
 * Invoke Bedrock streaming with retry logic.
 * Requirement 9.3: Retry up to 3 times with exponential backoff.
 */
async function invokeStreamingWithRetry(
  modelId: string,
  body: string
): Promise<{ body: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const command = new InvokeModelWithResponseStreamCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: new TextEncoder().encode(body),
      });

      const response = await bedrockClient.send(command);
      return { body: response.body as AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw new BedrockInvocationError(
    lastError?.message ?? 'Unknown Bedrock streaming error',
    isRetryableError(lastError),
    MAX_RETRIES
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Determine if an error is retryable (throttling, timeout, service errors). */
function isRetryableError(error: unknown): boolean {
  if (!error || !(error instanceof Error)) return false;

  const retryableNames = [
    'ThrottlingException',
    'TooManyRequestsException',
    'ServiceUnavailableException',
    'InternalServerException',
    'ModelTimeoutException',
  ];

  const errorName = (error as { name?: string }).name ?? '';
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

  return (
    retryableNames.includes(errorName) ||
    statusCode === 429 ||
    statusCode === 503 ||
    statusCode === 500
  );
}

/** Get the current month in YYYY-MM format. */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Get the current date in YYYY-MM-DD format. */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/** Sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
