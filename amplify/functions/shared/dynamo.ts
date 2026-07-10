/**
 * DynamoDB helper utilities for the AI Skill Assessment & Talent Development Platform.
 *
 * Table: platform-data (env: TABLE_NAME)
 * Key Schema: PK (partition key), SK (sort key)
 * GSI1: GSI1PK + GSI1SK (index name: "GSI1") — manager team queries
 * GSI2: GSI2PK + GSI2SK (index name: "GSI2") — time-based queries
 *
 * Uses @aws-sdk/lib-dynamodb (DynamoDBDocumentClient) for document-level operations.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

// ─── Client Setup ──────────────────────────────────────────────────────────────

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const TABLE_NAME = process.env.TABLE_NAME || 'platform-data';

// ─── TypeScript Interfaces ─────────────────────────────────────────────────────

export interface QueryOptions {
  skPrefix?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
  scanIndexForward?: boolean;
}

export interface GSI1QueryOptions {
  gsi1sk?: string;
  gsi1skPrefix?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
  scanIndexForward?: boolean;
}

export interface GSI2QueryOptions {
  startDate?: string;
  endDate?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
  scanIndexForward?: boolean;
}

export interface QueryResult<T = Record<string, unknown>> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface UpdateItemInput {
  [key: string]: unknown;
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Puts an item into the DynamoDB table.
 * Validates that PK, SK, and orgId are present.
 * Adds `createdAt` if not already set.
 *
 * Note: userId is optional since some records (e.g., PositionRecord) don't have it.
 */
export async function putItem(item: Record<string, unknown>): Promise<void> {
  if (!item.PK || !item.SK || !item.orgId) {
    throw new Error(
      'putItem requires PK, SK, and orgId fields to be present'
    );
  }

  if (!item.createdAt) {
    item.createdAt = new Date().toISOString();
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );
}

/**
 * Queries the table by PK with optional SK begins_with prefix, limit,
 * pagination token (lastEvaluatedKey), and sort order.
 */
export async function queryByPK<T = Record<string, unknown>>(
  pk: string,
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const { skPrefix, limit, lastEvaluatedKey, scanIndexForward = false } = options;

  let keyConditionExpression = 'PK = :pk';
  const expressionAttributeValues: Record<string, unknown> = { ':pk': pk };

  if (skPrefix) {
    keyConditionExpression += ' AND begins_with(SK, :skPrefix)';
    expressionAttributeValues[':skPrefix'] = skPrefix;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ExclusiveStartKey: lastEvaluatedKey as Record<string, unknown> | undefined,
      ScanIndexForward: scanIndexForward,
    })
  );

  return {
    items: (result.Items || []) as T[],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

/**
 * Queries GSI1 index for manager team queries.
 * GSI1PK is typically the orgId, GSI1SK is typically the userId or a prefix.
 */
export async function queryGSI1<T = Record<string, unknown>>(
  gsi1pk: string,
  options: GSI1QueryOptions = {}
): Promise<QueryResult<T>> {
  const { gsi1sk, gsi1skPrefix, limit, lastEvaluatedKey, scanIndexForward = false } = options;

  let keyConditionExpression = 'GSI1PK = :gsi1pk';
  const expressionAttributeValues: Record<string, unknown> = { ':gsi1pk': gsi1pk };

  if (gsi1sk) {
    keyConditionExpression += ' AND GSI1SK = :gsi1sk';
    expressionAttributeValues[':gsi1sk'] = gsi1sk;
  } else if (gsi1skPrefix) {
    keyConditionExpression += ' AND begins_with(GSI1SK, :gsi1skPrefix)';
    expressionAttributeValues[':gsi1skPrefix'] = gsi1skPrefix;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ExclusiveStartKey: lastEvaluatedKey as Record<string, unknown> | undefined,
      ScanIndexForward: scanIndexForward,
    })
  );

  return {
    items: (result.Items || []) as T[],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

/**
 * Queries GSI2 index for time-based queries.
 * GSI2PK is typically the orgId, GSI2SK is typically createdAt (ISO string).
 * Supports date range filtering with BETWEEN on GSI2SK.
 */
export async function queryGSI2<T = Record<string, unknown>>(
  gsi2pk: string,
  options: GSI2QueryOptions = {}
): Promise<QueryResult<T>> {
  const { startDate, endDate, limit, lastEvaluatedKey, scanIndexForward = false } = options;

  let keyConditionExpression = 'GSI2PK = :gsi2pk';
  const expressionAttributeValues: Record<string, unknown> = { ':gsi2pk': gsi2pk };

  if (startDate && endDate) {
    keyConditionExpression += ' AND GSI2SK BETWEEN :startDate AND :endDate';
    expressionAttributeValues[':startDate'] = startDate;
    expressionAttributeValues[':endDate'] = endDate;
  } else if (startDate) {
    keyConditionExpression += ' AND GSI2SK >= :startDate';
    expressionAttributeValues[':startDate'] = startDate;
  } else if (endDate) {
    keyConditionExpression += ' AND GSI2SK <= :endDate';
    expressionAttributeValues[':endDate'] = endDate;
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ExclusiveStartKey: lastEvaluatedKey as Record<string, unknown> | undefined,
      ScanIndexForward: scanIndexForward,
    })
  );

  return {
    items: (result.Items || []) as T[],
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

/**
 * Gets a single item by PK and SK. Returns the item or null if not found.
 */
export async function getItem<T = Record<string, unknown>>(
  pk: string,
  sk: string
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
    })
  );

  return (result.Item as T) || null;
}

/**
 * Updates an item by PK and SK with the provided updates.
 * Automatically builds the UpdateExpression from the updates object.
 * Adds `updatedAt` timestamp to every update.
 */
export async function updateItem(
  pk: string,
  sk: string,
  updates: UpdateItemInput
): Promise<void> {
  const updatesWithTimestamp = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};
  const updateExpressions: string[] = [];

  for (const [key, value] of Object.entries(updatesWithTimestamp)) {
    // Skip key attributes — they cannot be updated
    if (key === 'PK' || key === 'SK') continue;

    const attrName = `#${key}`;
    const attrValue = `:${key}`;
    expressionAttributeNames[attrName] = key;
    expressionAttributeValues[attrValue] = value;
    updateExpressions.push(`${attrName} = ${attrValue}`);
  }

  if (updateExpressions.length === 0) return;

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * Deletes an item by PK and SK.
 */
export async function deleteItem(pk: string, sk: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
    })
  );
}
