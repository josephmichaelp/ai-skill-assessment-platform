/**
 * Performance Handler Lambda
 * Retrieves and generates AI-powered performance summaries for employees.
 *
 * Routes:
 * - GET /performance/{userId} → getPerformanceSummary (Manager/Admin)
 * - POST /performance/{userId}/generate → generatePerformanceSummary (Manager/Admin)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { extractClaims, assertRole, assertOrgAccess } from '../shared/auth';
import { invokeModel } from '../shared/bedrock-client';
import { validateRequest, performanceSummaryGenerationSchema } from '../shared/validation';
import { getItem, queryByPK, putItem } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import { writeAuditLog } from '../shared/audit';
import type {
  UserRecord,
  AssessmentRecord,
  RoleplaySessionRecord,
  AssignmentRecord,
} from '../shared/types';

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface PerformanceSummaryRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "PERFORMANCE#{timestamp}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  summaryId: string;
  orgId: string;
  userId: string;
  startDate: string;
  endDate: string;
  language: 'id' | 'en';
  generatedBy: string; // userId of the manager/admin who generated it
  highlights: string;
  achievements: string;
  improvements: string;
  recommendations: string;
  fullNarrative: string;
  assessmentCount: number;
  roleplayCount: number;
  assignmentCount: number;
  createdAt: string;
}

interface GenerateRequest {
  userId: string;
  startDate: string;
  endDate: string;
  language?: 'id' | 'en';
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const claims = extractClaims(event);
    const path = event.path || '';
    const httpMethod = event.httpMethod || '';

    // Route: POST /performance/{userId}/generate
    if (httpMethod === 'POST' && path.match(/\/performance\/[^/]+\/generate$/)) {
      return await generatePerformanceSummary(event, claims);
    }

    // Route: GET /performance/{userId}
    if (httpMethod === 'GET' && path.match(/\/performance\/[^/]+$/)) {
      return await getPerformanceSummary(event, claims);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── Route Handlers ────────────────────────────────────────────────────────────

/**
 * GET /performance/{userId}
 * Retrieve the latest performance summary for the target user.
 *
 * 1. Extract claims, assert Manager/Admin
 * 2. Verify target user in same org
 * 3. Query DynamoDB for latest performance summary: PK=`ORG#{orgId}#USER#{userId}`, SK prefix `PERFORMANCE#`
 * 4. Return summary or 404
 *
 * Requirements: 7.1
 */
async function getPerformanceSummary(
  event: APIGatewayProxyEvent,
  claims: ReturnType<typeof extractClaims>
): Promise<APIGatewayProxyResult> {
  // 1. Assert Manager or Admin role
  assertRole(claims, ['Manager', 'Admin']);

  // Extract target userId from path
  const targetUserId = event.pathParameters?.userId;
  if (!targetUserId) {
    return formatResponse(400, { error: 'userId path parameter is required' });
  }

  // 2. Verify target user in same org
  const targetUser = await getItem<UserRecord>(
    `ORG#${claims.orgId}`,
    `USER#${targetUserId}`
  );

  if (!targetUser) {
    return formatResponse(404, { error: 'User not found in your organization' });
  }

  assertOrgAccess(claims, targetUser.orgId);

  // 3. Query for latest performance summary (most recent first)
  const pk = `ORG#${claims.orgId}#USER#${targetUserId}`;
  const result = await queryByPK<PerformanceSummaryRecord>(pk, {
    skPrefix: 'PERFORMANCE#',
    scanIndexForward: false, // most recent first
    limit: 1,
  });

  // 4. Return summary or 404
  if (result.items.length === 0) {
    return formatResponse(404, {
      error: 'No performance summary found for this user. Use POST /performance/{userId}/generate to create one.',
    });
  }

  // Audit log: performance summary viewed (fire-and-forget)
  void writeAuditLog({
    orgId: claims.orgId,
    userId: claims.userId,
    action: 'READ',
    resource: `performance/${targetUserId}`,
    details: `Viewed performance summary for user: ${targetUser!.name}`,
  });

  return formatResponse(200, result.items[0]);
}

/**
 * POST /performance/{userId}/generate
 * Generate a new performance summary for the target user.
 *
 * 1. Extract claims, assert Manager/Admin
 * 2. Validate request (userId from path, startDate, endDate from body, language)
 * 3. Get target user record (verify same org)
 * 4. Query assessments within [startDate, endDate]
 * 5. Query roleplay sessions completed within [startDate, endDate]
 * 6. Query assignment reviews within [startDate, endDate]
 * 7. Build Bedrock prompt with all data
 * 8. Invoke Bedrock to synthesize narrative summary
 * 9. Store the summary in DynamoDB
 * 10. Return the generated summary
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
async function generatePerformanceSummary(
  event: APIGatewayProxyEvent,
  claims: ReturnType<typeof extractClaims>
): Promise<APIGatewayProxyResult> {
  // 1. Assert Manager or Admin role
  assertRole(claims, ['Manager', 'Admin']);

  // Extract target userId from path
  const targetUserId = event.pathParameters?.userId;
  if (!targetUserId) {
    return formatResponse(400, { error: 'userId path parameter is required' });
  }

  // 2. Validate request body
  const body = validateRequest<GenerateRequest>(event, performanceSummaryGenerationSchema);

  // 3. Get target user record and verify same org
  const targetUser = await getItem<UserRecord>(
    `ORG#${claims.orgId}`,
    `USER#${targetUserId}`
  );

  if (!targetUser) {
    return formatResponse(404, { error: 'User not found in your organization' });
  }

  assertOrgAccess(claims, targetUser.orgId);

  // Determine language: request body > user preference > default 'en'
  const language: 'id' | 'en' = body.language || targetUser.languagePreference || 'en';

  // 4. Query assessments within [startDate, endDate]
  const userPK = `ORG#${claims.orgId}#USER#${targetUserId}`;
  const assessments = await queryRecordsInPeriod<AssessmentRecord>(
    userPK,
    'ASSESSMENT#',
    body.startDate,
    body.endDate
  );

  // 5. Query roleplay sessions completed within [startDate, endDate]
  const roleplaySessions = await queryRecordsInPeriod<RoleplaySessionRecord>(
    userPK,
    'ROLEPLAY#',
    body.startDate,
    body.endDate
  );

  // Filter to only completed sessions with evaluations
  const completedRoleplays = roleplaySessions.filter(
    (s) => s.status === 'completed' && s.evaluation
  );

  // 6. Query assignment reviews within [startDate, endDate]
  const assignments = await queryRecordsInPeriod<AssignmentRecord>(
    userPK,
    'ASSIGNMENT#',
    body.startDate,
    body.endDate
  );

  // Filter to only completed assignments with reviews
  const completedAssignments = assignments.filter(
    (a) => a.status === 'completed' && a.review
  );

  // Check if there's any data to summarize
  if (assessments.length === 0 && completedRoleplays.length === 0 && completedAssignments.length === 0) {
    return formatResponse(400, {
      error: 'No performance data found for this user in the specified period. There must be at least one assessment, roleplay evaluation, or assignment review.',
    });
  }

  // 7-8. Build prompt and invoke Bedrock
  const summaryContent = await generateSummaryWithBedrock(
    claims.orgId,
    targetUser,
    assessments,
    completedRoleplays,
    completedAssignments,
    body.startDate,
    body.endDate,
    language
  );

  // 9. Store the summary in DynamoDB
  const timestamp = new Date().toISOString();
  const summaryId = `perf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const summaryRecord: PerformanceSummaryRecord = {
    PK: userPK,
    SK: `PERFORMANCE#${timestamp}`,
    GSI1PK: claims.orgId,
    GSI1SK: targetUserId,
    summaryId,
    orgId: claims.orgId,
    userId: targetUserId,
    startDate: body.startDate,
    endDate: body.endDate,
    language,
    generatedBy: claims.userId,
    highlights: summaryContent.highlights,
    achievements: summaryContent.achievements,
    improvements: summaryContent.improvements,
    recommendations: summaryContent.recommendations,
    fullNarrative: summaryContent.fullNarrative,
    assessmentCount: assessments.length,
    roleplayCount: completedRoleplays.length,
    assignmentCount: completedAssignments.length,
    createdAt: timestamp,
  };

  await putItem(summaryRecord as unknown as Record<string, unknown>);

  // Audit log: performance summary generated (fire-and-forget)
  void writeAuditLog({
    orgId: claims.orgId,
    userId: claims.userId,
    action: 'WRITE',
    resource: `performance/${targetUserId}`,
    details: `Generated performance summary for user: ${targetUser!.name}, period: ${body.startDate} to ${body.endDate}`,
  });

  // 10. Return the generated summary
  return formatResponse(201, summaryRecord);
}

// ─── Business Logic Functions ──────────────────────────────────────────────────

/**
 * Query records by PK and SK prefix, then filter by date range.
 * Uses the SK timestamp embedded after the prefix for filtering.
 */
async function queryRecordsInPeriod<T extends { createdAt?: string; completedAt?: string }>(
  pk: string,
  skPrefix: string,
  startDate: string,
  endDate: string
): Promise<T[]> {
  const result = await queryByPK<T>(pk, {
    skPrefix,
    scanIndexForward: true,
  });

  // Filter items by date range using createdAt or completedAt
  const startTimestamp = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const endTimestamp = new Date(`${endDate}T23:59:59.999Z`).getTime();

  return result.items.filter((item) => {
    const dateStr = item.completedAt || item.createdAt;
    if (!dateStr) return false;
    const itemTime = new Date(dateStr).getTime();
    return itemTime >= startTimestamp && itemTime <= endTimestamp;
  });
}

/**
 * Generate the performance summary narrative using Amazon Bedrock.
 *
 * Requirements: 7.2, 7.3, 7.4
 */
async function generateSummaryWithBedrock(
  orgId: string,
  targetUser: UserRecord,
  assessments: AssessmentRecord[],
  roleplays: RoleplaySessionRecord[],
  assignments: AssignmentRecord[],
  startDate: string,
  endDate: string,
  language: 'id' | 'en'
): Promise<{
  highlights: string;
  achievements: string;
  improvements: string;
  recommendations: string;
  fullNarrative: string;
}> {
  const systemPrompt = `You are an AI performance review assistant for an employee talent platform.
Your role is to synthesize assessment results, roleplay evaluations, and assignment reviews into a comprehensive performance summary.
The summary must be professional, balanced, and constructive.

Output STRICTLY in the following JSON format:
{
  "highlights": "Overall performance highlights paragraph",
  "achievements": "Key achievements paragraph",
  "improvements": "Areas for improvement paragraph",
  "recommendations": "Competency development recommendations paragraph"
}

Do not include any text outside the JSON object.`;

  // Build assessment summary
  const assessmentSummary = assessments.length > 0
    ? assessments
        .map((a) => `- Topic: ${a.topic}, Score: ${a.score}/100, Difficulty: ${a.difficulty}, Date: ${a.createdAt.split('T')[0]}`)
        .join('\n')
    : 'No assessments in this period.';

  // Build roleplay summary
  const roleplaySummary = roleplays.length > 0
    ? roleplays
        .map((r) => {
          const eval_ = r.evaluation!;
          return `- Scenario: ${r.scenarioType}, Communication Score: ${eval_.communicationScore}/100, Strengths: ${eval_.strengths.join(', ')}, Weaknesses: ${eval_.weaknesses.join(', ')}, Date: ${r.completedAt || r.createdAt}`;
        })
        .join('\n')
    : 'No roleplay evaluations in this period.';

  // Build assignment summary
  const assignmentSummary = assignments.length > 0
    ? assignments
        .map((a) => {
          const review = a.review!;
          return `- File: ${a.fileName}, Quality Score: ${review.qualityScore}/100, Strengths: ${review.strengths.join(', ')}, Weaknesses: ${review.weaknesses.join(', ')}, Date: ${a.completedAt || a.createdAt}`;
        })
        .join('\n')
    : 'No assignment reviews in this period.';

  // Compute average scores
  const avgAssessmentScore = assessments.length > 0
    ? Math.round(assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length)
    : null;

  const avgRoleplayScore = roleplays.length > 0
    ? Math.round(roleplays.reduce((sum, r) => sum + (r.evaluation?.communicationScore ?? 0), 0) / roleplays.length)
    : null;

  const avgAssignmentScore = assignments.length > 0
    ? Math.round(assignments.reduce((sum, a) => sum + (a.review?.qualityScore ?? 0), 0) / assignments.length)
    : null;

  const userContent = `Generate a performance summary for the following employee:

Employee: ${targetUser.name}
Review Period: ${startDate} to ${endDate}

=== ASSESSMENT RESULTS (${assessments.length} total${avgAssessmentScore !== null ? `, average score: ${avgAssessmentScore}/100` : ''}) ===
${assessmentSummary}

=== ROLEPLAY EVALUATIONS (${roleplays.length} total${avgRoleplayScore !== null ? `, average communication score: ${avgRoleplayScore}/100` : ''}) ===
${roleplaySummary}

=== ASSIGNMENT REVIEWS (${assignments.length} total${avgAssignmentScore !== null ? `, average quality score: ${avgAssignmentScore}/100` : ''}) ===
${assignmentSummary}

Please synthesize all the above data into a comprehensive performance summary with the four required sections: highlights, achievements, improvements, and recommendations.`;

  try {
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language,
      feature: 'performanceSummary',
      orgId,
    });

    // Parse the JSON response from Bedrock
    const parsed = parseJsonResponse(result.content);

    return {
      highlights: parsed.highlights || 'Performance data has been compiled for this period.',
      achievements: parsed.achievements || 'See assessment and evaluation scores for details.',
      improvements: parsed.improvements || 'Continue to develop skills across all competency areas.',
      recommendations: parsed.recommendations || 'Focus on areas with lower scores for targeted improvement.',
      fullNarrative: `${parsed.highlights}\n\n${parsed.achievements}\n\n${parsed.improvements}\n\n${parsed.recommendations}`,
    };
  } catch (error) {
    // If Bedrock fails, return a fallback summary based on raw data
    console.error('Failed to generate AI performance summary:', error);

    const fallbackHighlights = buildFallbackHighlights(
      assessments,
      roleplays,
      assignments,
      avgAssessmentScore,
      avgRoleplayScore,
      avgAssignmentScore
    );

    return {
      highlights: fallbackHighlights,
      achievements: `Completed ${assessments.length} assessment(s), ${roleplays.length} roleplay session(s), and ${assignments.length} assignment review(s) during this period.`,
      improvements: 'Please review individual assessment and evaluation details for specific improvement areas.',
      recommendations: 'Continue regular skill development activities across all competency areas.',
      fullNarrative: fallbackHighlights,
    };
  }
}

/**
 * Parse a JSON response from Bedrock, handling potential formatting issues.
 */
function parseJsonResponse(content: string): {
  highlights: string;
  achievements: string;
  improvements: string;
  recommendations: string;
} {
  // Try to extract JSON from the response (it might be wrapped in code blocks)
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      highlights: parsed.highlights || '',
      achievements: parsed.achievements || '',
      improvements: parsed.improvements || '',
      recommendations: parsed.recommendations || '',
    };
  } catch {
    // If JSON parsing fails, treat the whole content as a narrative
    return {
      highlights: content,
      achievements: '',
      improvements: '',
      recommendations: '',
    };
  }
}

/**
 * Build a fallback highlights string when Bedrock is unavailable.
 */
function buildFallbackHighlights(
  assessments: AssessmentRecord[],
  roleplays: RoleplaySessionRecord[],
  assignments: AssignmentRecord[],
  avgAssessmentScore: number | null,
  avgRoleplayScore: number | null,
  avgAssignmentScore: number | null
): string {
  const parts: string[] = [];

  if (assessments.length > 0) {
    parts.push(
      `Completed ${assessments.length} assessment(s) with an average score of ${avgAssessmentScore}/100.`
    );
  }

  if (roleplays.length > 0) {
    parts.push(
      `Participated in ${roleplays.length} roleplay session(s) with an average communication score of ${avgRoleplayScore}/100.`
    );
  }

  if (assignments.length > 0) {
    parts.push(
      `Submitted ${assignments.length} assignment(s) with an average quality score of ${avgAssignmentScore}/100.`
    );
  }

  return parts.join(' ');
}
