/**
 * User Handler Lambda
 * Handles user profile, user management (Admin), position management (Admin),
 * and token usage monitoring (Admin) endpoints.
 *
 * Routes:
 * - POST /auth/profile               → getProfile (any authenticated user)
 * - GET  /users                      → listUsers (Admin only)
 * - POST /users                      → createUser (Admin only)
 * - PUT  /users/{userId}             → updateUser (Admin only)
 * - GET  /positions                  → listPositions (any authenticated user)
 * - POST /positions                  → createPosition (Admin only)
 * - PUT  /positions/{positionId}     → updatePosition (Admin only)
 * - GET  /admin/token-usage          → getTokenUsage (Admin only)
 * - GET  /admin/token-usage/daily    → getTokenUsageDaily (Admin only)
 * - GET  /admin/token-usage/forecast → getTokenUsageForecast (Admin only)
 *
 * Requirements: 1.4, 10.1, 10.2, 10.3, 10.4, 9.1, 9.2
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { extractClaims, assertRole } from '../shared/auth';
import { validateRequest } from '../shared/validation';
import {
  userCreationSchema,
  userUpdateSchema,
  positionCreationSchema,
  positionUpdateSchema,
} from '../shared/validation';
import { putItem, queryByPK, queryGSI1, getItem, updateItem } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import { writeAuditLog } from '../shared/audit';
import type { UserRecord, PositionRecord, TokenUsageRecord } from '../shared/types';

// ─── Main Handler (Router) ─────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;

    // POST /auth/profile
    if (method === 'POST' && path === '/auth/profile') {
      return await getProfile(event);
    }

    // GET /users
    if (method === 'GET' && path === '/users') {
      return await listUsers(event);
    }

    // POST /users
    if (method === 'POST' && path === '/users') {
      return await createUser(event);
    }

    // PUT /users/{userId}
    if (method === 'PUT' && path.match(/^\/users\/[^/]+$/)) {
      return await updateUser(event);
    }

    // GET /positions
    if (method === 'GET' && path === '/positions') {
      return await listPositions(event);
    }

    // POST /positions
    if (method === 'POST' && path === '/positions') {
      return await createPosition(event);
    }

    // PUT /positions/{positionId}
    if (method === 'PUT' && path.match(/^\/positions\/[^/]+$/)) {
      return await updatePosition(event);
    }

    // GET /admin/token-usage/daily (must come before /admin/token-usage to avoid prefix match)
    if (method === 'GET' && path === '/admin/token-usage/daily') {
      return await getTokenUsageDaily(event);
    }

    // GET /admin/token-usage/forecast
    if (method === 'GET' && path === '/admin/token-usage/forecast') {
      return await getTokenUsageForecast(event);
    }

    // GET /admin/token-usage
    if (method === 'GET' && path === '/admin/token-usage') {
      return await getTokenUsage(event);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── POST /auth/profile ────────────────────────────────────────────────────────

/**
 * Get the authenticated user's profile from DynamoDB using JWT claims.
 * Any authenticated user can call this endpoint.
 */
async function getProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);

  const pk = `ORG#${claims.orgId}`;
  const sk = `USER#${claims.userId}`;

  const user = await getItem<UserRecord>(pk, sk);

  if (!user) {
    return formatResponse(404, { error: 'User profile not found' });
  }

  return formatResponse(200, {
    userId: user.userId,
    orgId: user.orgId,
    email: user.email,
    name: user.name,
    role: user.role,
    targetPositionId: user.targetPositionId,
    languagePreference: user.languagePreference,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
}

// ─── GET /users ────────────────────────────────────────────────────────────────

/**
 * List all users in the Admin's organization. Paginated via GSI1.
 * Admin only.
 */
async function listUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const limit = event.queryStringParameters?.limit
    ? parseInt(event.queryStringParameters.limit, 10)
    : 50;

  const lastKey = event.queryStringParameters?.nextToken
    ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString())
    : undefined;

  const result = await queryGSI1<UserRecord>(claims.orgId, {
    gsi1skPrefix: 'USER#',
    limit,
    lastEvaluatedKey: lastKey,
  });

  const nextToken = result.lastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
    : undefined;

  return formatResponse(200, {
    users: result.items.map((user) => ({
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      targetPositionId: user.targetPositionId,
      languagePreference: user.languagePreference,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
    nextToken,
  });
}

// ─── POST /users ───────────────────────────────────────────────────────────────

/**
 * Create a new user in the Admin's organization.
 * Sets orgId from Admin's JWT claims (never trust client-provided orgId).
 * Admin only.
 *
 * TODO: Integrate Cognito AdminCreateUser API to provision the Cognito user.
 *       For now, only the DynamoDB record is created.
 */
async function createUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const data = validateRequest(event, userCreationSchema);

  const userId = randomUUID();
  const now = new Date().toISOString();

  const userRecord: UserRecord = {
    PK: `ORG#${claims.orgId}`,
    SK: `USER#${userId}`,
    GSI1PK: claims.orgId,
    GSI1SK: `USER#${userId}`,
    userId,
    orgId: claims.orgId,
    email: data.email,
    name: data.name,
    role: data.role,
    targetPositionId: data.targetPositionId,
    languagePreference: 'id', // default
    createdAt: now,
    updatedAt: now,
  };

  // TODO: Call Cognito AdminCreateUser API here to create the actual Cognito user
  // with custom attributes (custom:orgId, custom:role) before storing in DynamoDB.
  // For MVP, we only create the DynamoDB record.

  await putItem(userRecord as unknown as Record<string, unknown>);

  // Audit log: user created (fire-and-forget)
  void writeAuditLog({
    orgId: claims.orgId,
    userId: claims.userId,
    action: 'WRITE',
    resource: `users/${userId}`,
    details: `Created user: ${data.name} (${data.email}), role: ${data.role}`,
  });

  return formatResponse(201, {
    userId,
    email: data.email,
    name: data.name,
    role: data.role,
    orgId: claims.orgId,
    targetPositionId: data.targetPositionId,
    createdAt: now,
  });
}

// ─── PUT /users/{userId} ───────────────────────────────────────────────────────

/**
 * Update a user's role or target position (Admin only).
 * The target user must belong to the same organization.
 */
async function updateUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const targetUserId = event.pathParameters?.userId || event.path.split('/').pop();

  if (!targetUserId) {
    return formatResponse(400, { error: 'userId path parameter is required' });
  }

  const data = validateRequest(event, userUpdateSchema);

  // Verify target user exists and belongs to the same org
  const pk = `ORG#${claims.orgId}`;
  const sk = `USER#${targetUserId}`;

  const existingUser = await getItem<UserRecord>(pk, sk);
  if (!existingUser) {
    return formatResponse(404, { error: 'User not found in your organization' });
  }

  const updates: Record<string, unknown> = {};

  if (data.role !== undefined) {
    updates.role = data.role;
  }

  if (data.targetPositionId !== undefined) {
    updates.targetPositionId = data.targetPositionId;
  }

  if (Object.keys(updates).length === 0) {
    return formatResponse(400, { error: 'No valid fields to update' });
  }

  await updateItem(pk, sk, updates);

  // Audit log: user updated (fire-and-forget)
  void writeAuditLog({
    orgId: claims.orgId,
    userId: claims.userId,
    action: 'WRITE',
    resource: `users/${targetUserId}`,
    details: `Updated user fields: ${Object.keys(updates).join(', ')}`,
  });

  return formatResponse(200, {
    userId: targetUserId,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}

// ─── GET /positions ────────────────────────────────────────────────────────────

/**
 * List all positions in the authenticated user's organization.
 * Any authenticated user can call this endpoint.
 */
async function listPositions(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);

  const pk = `ORG#${claims.orgId}`;

  const result = await queryByPK<PositionRecord>(pk, {
    skPrefix: 'POSITION#',
  });

  return formatResponse(200, {
    positions: result.items.map((position) => ({
      positionId: position.positionId,
      title: position.title,
      competencyRequirements: position.competencyRequirements,
      createdAt: position.createdAt,
      updatedAt: position.updatedAt,
    })),
  });
}

// ─── POST /positions ───────────────────────────────────────────────────────────

/**
 * Create a new position in the Admin's organization.
 * Validates that competency weights sum to 1.0 (tolerance: 0.01).
 * Admin only.
 */
async function createPosition(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const data = validateRequest(event, positionCreationSchema);

  // Validate competency weights sum to 1.0 (with 0.01 tolerance)
  const weightSum = data.competencyRequirements.reduce((sum, req) => sum + req.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    return formatResponse(400, {
      error: 'Competency requirement weights must sum to 1.0',
      detail: `Current sum: ${weightSum.toFixed(4)}`,
    });
  }

  const positionId = randomUUID();
  const now = new Date().toISOString();

  const positionRecord: PositionRecord = {
    PK: `ORG#${claims.orgId}`,
    SK: `POSITION#${positionId}`,
    positionId,
    orgId: claims.orgId,
    title: data.title,
    competencyRequirements: data.competencyRequirements,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(positionRecord as unknown as Record<string, unknown>);

  return formatResponse(201, {
    positionId,
    title: data.title,
    competencyRequirements: data.competencyRequirements,
    createdAt: now,
  });
}

// ─── PUT /positions/{positionId} ───────────────────────────────────────────────

/**
 * Update a position's title and/or competency requirements (Admin only).
 * If competencyRequirements are provided, validates weights sum to 1.0.
 */
async function updatePosition(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const positionId = event.pathParameters?.positionId || event.path.split('/').pop();

  if (!positionId) {
    return formatResponse(400, { error: 'positionId path parameter is required' });
  }

  const data = validateRequest(event, positionUpdateSchema);

  // Verify position exists in the same org
  const pk = `ORG#${claims.orgId}`;
  const sk = `POSITION#${positionId}`;

  const existingPosition = await getItem<PositionRecord>(pk, sk);
  if (!existingPosition) {
    return formatResponse(404, { error: 'Position not found in your organization' });
  }

  const updates: Record<string, unknown> = {};

  if (data.title !== undefined) {
    updates.title = data.title;
  }

  if (data.competencyRequirements !== undefined) {
    // Validate competency weights sum to 1.0 (with 0.01 tolerance)
    const weightSum = data.competencyRequirements.reduce((sum, req) => sum + req.weight, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
      return formatResponse(400, {
        error: 'Competency requirement weights must sum to 1.0',
        detail: `Current sum: ${weightSum.toFixed(4)}`,
      });
    }
    updates.competencyRequirements = data.competencyRequirements;
  }

  if (Object.keys(updates).length === 0) {
    return formatResponse(400, { error: 'No valid fields to update' });
  }

  await updateItem(pk, sk, updates);

  return formatResponse(200, {
    positionId,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}


// ─── Token Usage Constants ─────────────────────────────────────────────────────

const MONTHLY_TOKEN_LIMIT = 500_000;
const WARNING_THRESHOLD = 0.8; // 80% = 400,000 tokens
const CRITICAL_THRESHOLD = 0.95; // 95% = 475,000 tokens

// ─── GET /admin/token-usage ────────────────────────────────────────────────────

/**
 * Return monthly token usage for the Admin's organization including:
 * - Total tokens used and monthly limit
 * - Per-model breakdown (Nova Lite input/output, Cohere Embed input/output)
 * - Per-feature breakdown
 * - Alert status (none | warning | critical)
 *
 * Admin only.
 * Requirements: 10.4, 9.1, 9.2
 */
async function getTokenUsage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const month = getCurrentMonth();
  const pk = `ORG#${claims.orgId}`;
  const sk = `TOKENUSAGE#${month}`;

  const record = await getItem<TokenUsageRecord>(pk, sk);

  if (!record) {
    return formatResponse(200, {
      month,
      totalTokensUsed: 0,
      monthlyTokenLimit: MONTHLY_TOKEN_LIMIT,
      usagePercentage: 0,
      alertStatus: 'none',
      breakdownByModel: {
        'amazon.nova-lite-v1:0': { input: 0, output: 0, total: 0 },
        'cohere.embed-multilingual-v3': { input: 0, output: 0, total: 0 },
      },
      breakdownByFeature: {},
      novaLiteTokensUsed: 0,
      novaLiteInputTokens: 0,
      novaLiteOutputTokens: 0,
      cohereEmbedTokensUsed: 0,
    });
  }

  const usagePercentage = record.totalTokensUsed / MONTHLY_TOKEN_LIMIT;
  const alertStatus = getAlertStatus(usagePercentage);

  return formatResponse(200, {
    month,
    totalTokensUsed: record.totalTokensUsed,
    monthlyTokenLimit: record.monthlyTokenLimit,
    usagePercentage: Math.round(usagePercentage * 10000) / 100, // percentage with 2 decimals
    alertStatus,
    breakdownByModel: record.breakdownByModel,
    breakdownByFeature: record.breakdownByFeature,
    novaLiteTokensUsed: record.novaLiteTokensUsed,
    novaLiteInputTokens: record.novaLiteInputTokens,
    novaLiteOutputTokens: record.novaLiteOutputTokens,
    cohereEmbedTokensUsed: record.cohereEmbedTokensUsed,
  });
}

// ─── GET /admin/token-usage/daily ──────────────────────────────────────────────

/**
 * Return daily token usage for the current month.
 * Returns an array of { date, tokensUsed } entries sorted by date.
 *
 * Admin only.
 * Requirements: 10.4, 9.1
 */
async function getTokenUsageDaily(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const month = getCurrentMonth();
  const pk = `ORG#${claims.orgId}`;
  const sk = `TOKENUSAGE#${month}`;

  const record = await getItem<TokenUsageRecord>(pk, sk);

  if (!record || !record.dailyUsage) {
    return formatResponse(200, {
      month,
      dailyUsage: [],
      totalTokensUsed: 0,
      monthlyTokenLimit: MONTHLY_TOKEN_LIMIT,
    });
  }

  // Convert dailyUsage map to sorted array
  const dailyUsage = Object.entries(record.dailyUsage)
    .map(([date, tokensUsed]) => ({ date, tokensUsed }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return formatResponse(200, {
    month,
    dailyUsage,
    totalTokensUsed: record.totalTokensUsed,
    monthlyTokenLimit: record.monthlyTokenLimit,
  });
}

// ─── GET /admin/token-usage/forecast ───────────────────────────────────────────

/**
 * Calculate projected monthly usage based on daily average trend.
 * Returns forecast data including:
 * - Daily average tokens used
 * - Projected end-of-month total
 * - Whether thresholds (warning/critical) will be exceeded
 *
 * Admin only.
 * Requirements: 10.4, 9.2
 */
async function getTokenUsageForecast(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  assertRole(claims, ['Admin']);

  const month = getCurrentMonth();
  const pk = `ORG#${claims.orgId}`;
  const sk = `TOKENUSAGE#${month}`;

  const record = await getItem<TokenUsageRecord>(pk, sk);

  if (!record || !record.dailyUsage || Object.keys(record.dailyUsage).length === 0) {
    return formatResponse(200, {
      month,
      daysWithData: 0,
      daysInMonth: getDaysInCurrentMonth(),
      dailyAverage: 0,
      projectedMonthlyTotal: 0,
      projectedUsagePercentage: 0,
      currentTotalTokensUsed: 0,
      monthlyTokenLimit: MONTHLY_TOKEN_LIMIT,
      alertStatus: 'none',
      willExceedWarning: false,
      willExceedCritical: false,
    });
  }

  const dailyValues = Object.values(record.dailyUsage);
  const daysWithData = dailyValues.length;
  const totalFromDays = dailyValues.reduce((sum, tokens) => sum + tokens, 0);
  const dailyAverage = totalFromDays / daysWithData;
  const daysInMonth = getDaysInCurrentMonth();

  // Project total usage based on daily average * total days in month
  const projectedMonthlyTotal = Math.round(dailyAverage * daysInMonth);
  const projectedUsagePercentage = projectedMonthlyTotal / MONTHLY_TOKEN_LIMIT;

  const currentUsagePercentage = record.totalTokensUsed / MONTHLY_TOKEN_LIMIT;
  const alertStatus = getAlertStatus(currentUsagePercentage);

  const willExceedWarning = projectedMonthlyTotal > MONTHLY_TOKEN_LIMIT * WARNING_THRESHOLD;
  const willExceedCritical = projectedMonthlyTotal > MONTHLY_TOKEN_LIMIT * CRITICAL_THRESHOLD;

  return formatResponse(200, {
    month,
    daysWithData,
    daysInMonth,
    dailyAverage: Math.round(dailyAverage),
    projectedMonthlyTotal,
    projectedUsagePercentage: Math.round(projectedUsagePercentage * 10000) / 100,
    currentTotalTokensUsed: record.totalTokensUsed,
    monthlyTokenLimit: MONTHLY_TOKEN_LIMIT,
    alertStatus,
    willExceedWarning,
    willExceedCritical,
  });
}

// ─── Token Usage Helpers ───────────────────────────────────────────────────────

/**
 * Get the current month in YYYY-MM format.
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get the number of days in the current month.
 */
function getDaysInCurrentMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/**
 * Determine alert status based on usage percentage.
 * - 'critical' if >= 95% (475K tokens)
 * - 'warning' if >= 80% (400K tokens)
 * - 'none' otherwise
 */
function getAlertStatus(usagePercentage: number): 'none' | 'warning' | 'critical' {
  if (usagePercentage >= CRITICAL_THRESHOLD) return 'critical';
  if (usagePercentage >= WARNING_THRESHOLD) return 'warning';
  return 'none';
}
