/**
 * Audit logging utility for the AI Skill Assessment & Talent Development Platform.
 *
 * Writes audit log entries to DynamoDB for sensitive resource access tracking.
 * Uses fire-and-forget pattern (non-blocking) to avoid slowing down responses.
 *
 * DynamoDB Key Design:
 * - PK: ORG#{orgId}#USER#{userId}
 * - SK: AUDIT#{timestamp}#{action}
 * - GSI1PK: {orgId}
 * - GSI1SK: {userId}
 *
 * Requirements: 12.6 (design-level)
 */

import { putItem } from './dynamo';

export interface AuditLogParams {
  orgId: string;
  userId: string;
  action: 'READ' | 'WRITE' | 'DELETE';
  resource: string;
  details?: string;
}

/**
 * Write an audit log entry to DynamoDB.
 *
 * This function stores an audit trail for sensitive resource access.
 * It is designed to be called in a fire-and-forget manner:
 *   void writeAuditLog({ ... });
 *
 * Errors are caught and logged to console.error to avoid impacting
 * the main request flow.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  const { orgId, userId, action, resource, details } = params;
  const timestamp = new Date().toISOString();

  const auditItem: Record<string, unknown> = {
    PK: `ORG#${orgId}#USER#${userId}`,
    SK: `AUDIT#${timestamp}#${action}`,
    GSI1PK: orgId,
    GSI1SK: userId,
    orgId,
    userId,
    action,
    resource,
    timestamp,
    createdAt: timestamp,
  };

  if (details) {
    auditItem.details = details;
  }

  try {
    await putItem(auditItem);
  } catch (error) {
    // Log the error but don't propagate it — audit failures should not affect user requests
    console.error('[AuditLog] Failed to write audit entry:', {
      orgId,
      userId,
      action,
      resource,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
