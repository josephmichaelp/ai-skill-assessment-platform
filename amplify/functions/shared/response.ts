/**
 * Response Formatting and Error Handling Utilities
 * Provides consistent API Gateway responses with CORS headers and a unified error handler.
 *
 * Requirements: 9.3, 9.4
 */

import type { APIGatewayProxyResult } from 'aws-lambda';
import { TokenLimitExceededError, BedrockInvocationError } from './bedrock-client';

// ─── CORS Headers ──────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ─── Error Classes ─────────────────────────────────────────────────────────────

export class AuthorizationError extends Error {
  public readonly statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = statusCode;
  }
}

export interface FieldError {
  field: string;
  message: string;
}

export class ValidationError extends Error {
  public readonly fieldErrors: FieldError[];

  constructor(message: string, fieldErrors: FieldError[]) {
    super(message);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

// ─── Response Formatters ───────────────────────────────────────────────────────

/**
 * Format a successful API Gateway response with CORS headers.
 */
export function formatResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Format an error API Gateway response with CORS headers.
 * Includes an optional suggestion for the client.
 */
export function formatError(
  statusCode: number,
  message: string,
  suggestion?: string
): APIGatewayProxyResult {
  const errorBody: { error: string; suggestion?: string } = { error: message };
  if (suggestion) {
    errorBody.suggestion = suggestion;
  }

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(errorBody),
  };
}

// ─── Unified Error Handler ─────────────────────────────────────────────────────

/**
 * Unified error handler that maps known error types to appropriate HTTP responses.
 * Unknown errors return a generic 500 response.
 *
 * Requirement 9.4: Return human-readable error with retry suggestion on failure.
 */
export function handleError(error: unknown): APIGatewayProxyResult {
  if (error instanceof TokenLimitExceededError) {
    return formatError(
      429,
      error.message,
      'Please wait until the next billing month or contact your administrator to increase the token limit.'
    );
  }

  if (error instanceof AuthorizationError) {
    return formatError(error.statusCode, error.message);
  }

  if (error instanceof ValidationError) {
    const body: { error: string; fieldErrors: FieldError[] } = {
      error: error.message,
      fieldErrors: error.fieldErrors,
    };
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    };
  }

  if (error instanceof BedrockInvocationError) {
    return formatError(
      503,
      error.message,
      'The AI service is temporarily unavailable. Please retry the operation in a few moments.'
    );
  }

  // Unknown error — extract message if available, otherwise generic 500
  const message = error instanceof Error ? error.message : 'Internal server error';
  return formatError(500, message);
}
