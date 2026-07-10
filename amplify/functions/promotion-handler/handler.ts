/**
 * Promotion Handler Lambda
 * Computes promotion readiness scorecards and retrieves competency development history.
 *
 * Routes:
 * - GET /promotion/{userId} → getPromoScorecard
 * - GET /promotion/{userId}/history → getPromoHistory
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { extractClaims, assertRole, assertOrgAccess } from '../shared/auth';
import { invokeModel } from '../shared/bedrock-client';
import { getItem, queryByPK } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import { writeAuditLog } from '../shared/audit';
import type {
  UserRecord,
  PositionRecord,
  AssessmentRecord,
  CompetencyRequirement,
} from '../shared/types';

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface SkillGap {
  topic: string;
  currentScore: number;
  requiredScore: number;
  gapMagnitude: number;
  weight: number;
}

interface CompetencyScore {
  topic: string;
  score: number;
  assessmentId: string;
  assessedAt: string;
}

interface ScorecardResponse {
  readinessScore: number;
  gaps: SkillGap[];
  insights: string;
  competencyScores: CompetencyScore[];
}

interface HistoryEntry {
  date: string;
  topic: string;
  score: number;
  assessmentId: string;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const claims = extractClaims(event);
    const path = event.path || '';
    const httpMethod = event.httpMethod || '';

    // Route: GET /promotion/{userId}/history
    if (httpMethod === 'GET' && path.match(/\/promotion\/[^/]+\/history$/)) {
      return await getPromoHistory(event, claims);
    }

    // Route: GET /promotion/{userId}
    if (httpMethod === 'GET' && path.match(/\/promotion\/[^/]+$/)) {
      return await getPromoScorecard(event, claims);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── Route Handlers ────────────────────────────────────────────────────────────

/**
 * GET /promotion/{userId}
 * Compute promotion readiness scorecard for the target user.
 *
 * 1. Assert Manager or Admin role
 * 2. Get target user's record (verify same org)
 * 3. Get target user's target position and its competency requirements
 * 4. Get user's latest competency scores (from most recent assessments per topic)
 * 5. Compute readiness score: sum of (min(userScore, requiredScore) / requiredScore * weight) * 100
 * 6. Identify gaps: competencies where userScore < requiredScore
 * 7. Generate AI career development insights via Bedrock
 * 8. Return { readinessScore, gaps, insights, competencyScores }
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
async function getPromoScorecard(
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

  // 2. Get target user's record and verify same org
  const targetUser = await getItem<UserRecord>(
    `ORG#${claims.orgId}`,
    `USER#${targetUserId}`
  );

  if (!targetUser) {
    return formatResponse(404, { error: 'User not found in your organization' });
  }

  assertOrgAccess(claims, targetUser.orgId);

  // 3. Get target user's target position and its competency requirements
  if (!targetUser.targetPositionId) {
    return formatResponse(400, {
      error: 'User does not have a target position assigned. Please assign a target position before viewing the promotion scorecard.',
    });
  }

  const position = await getItem<PositionRecord>(
    `ORG#${claims.orgId}`,
    `POSITION#${targetUser.targetPositionId}`
  );

  if (!position) {
    return formatResponse(404, {
      error: 'Target position not found. The assigned position may have been removed.',
    });
  }

  const requirements = position.competencyRequirements || [];
  if (requirements.length === 0) {
    return formatResponse(400, {
      error: 'Target position has no competency requirements configured.',
    });
  }

  // 4. Get user's latest competency scores (from most recent assessments per topic)
  const assessmentsPK = `ORG#${claims.orgId}#USER#${targetUserId}`;
  const assessmentsResult = await queryByPK<AssessmentRecord>(assessmentsPK, {
    skPrefix: 'ASSESSMENT#',
    scanIndexForward: false, // most recent first
  });

  const latestScores = getLatestCompetencyScores(assessmentsResult.items);

  // 5. Compute readiness score
  const readinessScore = computeReadinessScore(requirements, latestScores);

  // 6. Identify gaps
  const gaps = identifyGaps(requirements, latestScores);

  // 7. Generate AI career development insights via Bedrock
  const competencyScores = buildCompetencyScoreList(requirements, latestScores);
  const insights = await generateInsights(
    claims.orgId,
    targetUser,
    position,
    gaps,
    competencyScores,
    claims
  );

  // 8. Return response
  const response: ScorecardResponse = {
    readinessScore,
    gaps,
    insights,
    competencyScores,
  };

  // Audit log: promotion scorecard viewed (fire-and-forget)
  void writeAuditLog({
    orgId: claims.orgId,
    userId: claims.userId,
    action: 'READ',
    resource: `promotion/${targetUserId}`,
    details: `Viewed promotion scorecard for user: ${targetUser.name}`,
  });

  return formatResponse(200, response);
}

/**
 * GET /promotion/{userId}/history
 * Return competency development data ordered chronologically.
 *
 * 1. Query all assessments for the user chronologically
 * 2. Build a timeline of competency score changes
 * 3. Return ordered entries: [{ date, topic, score, assessmentId }]
 *
 * Requirement: 6.6
 */
async function getPromoHistory(
  event: APIGatewayProxyEvent,
  claims: ReturnType<typeof extractClaims>
): Promise<APIGatewayProxyResult> {
  // Assert Manager or Admin role
  assertRole(claims, ['Manager', 'Admin']);

  // Extract target userId from path
  const targetUserId = event.pathParameters?.userId;
  if (!targetUserId) {
    return formatResponse(400, { error: 'userId path parameter is required' });
  }

  // Verify target user belongs to same org
  const targetUser = await getItem<UserRecord>(
    `ORG#${claims.orgId}`,
    `USER#${targetUserId}`
  );

  if (!targetUser) {
    return formatResponse(404, { error: 'User not found in your organization' });
  }

  assertOrgAccess(claims, targetUser.orgId);

  // 1. Query all assessments for the user chronologically (oldest first)
  const assessmentsPK = `ORG#${claims.orgId}#USER#${targetUserId}`;
  const assessmentsResult = await queryByPK<AssessmentRecord>(assessmentsPK, {
    skPrefix: 'ASSESSMENT#',
    scanIndexForward: true, // chronological order (oldest first)
  });

  // 2. Build a timeline of competency score changes
  const history: HistoryEntry[] = assessmentsResult.items.map((assessment) => ({
    date: assessment.createdAt,
    topic: assessment.topic,
    score: assessment.score,
    assessmentId: assessment.assessmentId,
  }));

  // 3. Return ordered entries
  return formatResponse(200, { history });
}

// ─── Business Logic Functions ──────────────────────────────────────────────────

/**
 * Extract the latest competency score per topic from a list of assessments.
 * Assessments should be sorted most-recent-first.
 */
function getLatestCompetencyScores(
  assessments: AssessmentRecord[]
): Map<string, { score: number; assessmentId: string; assessedAt: string }> {
  const latestScores = new Map<string, { score: number; assessmentId: string; assessedAt: string }>();

  for (const assessment of assessments) {
    const topic = assessment.topic;
    // Since assessments are sorted most-recent-first, the first one per topic is the latest
    if (!latestScores.has(topic)) {
      latestScores.set(topic, {
        score: assessment.score,
        assessmentId: assessment.assessmentId,
        assessedAt: assessment.createdAt,
      });
    }
  }

  return latestScores;
}

/**
 * Compute the promotion readiness score.
 * Formula: sum of (min(userScore, requiredScore) / requiredScore * weight) * 100
 *
 * If a user has no score for a required competency, that score counts as 0.
 *
 * Requirement 6.1, 6.2
 */
function computeReadinessScore(
  requirements: CompetencyRequirement[],
  latestScores: Map<string, { score: number; assessmentId: string; assessedAt: string }>
): number {
  let weightedSum = 0;

  for (const req of requirements) {
    const userScoreEntry = latestScores.get(req.topic);
    const userScore = userScoreEntry?.score ?? 0;
    const contribution = (Math.min(userScore, req.requiredScore) / req.requiredScore) * req.weight;
    weightedSum += contribution;
  }

  // Multiply by 100 to get 0-100 scale
  const readinessScore = Math.round(weightedSum * 100);

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, readinessScore));
}

/**
 * Identify skill gaps: competencies where the user's score is below the required score.
 *
 * Requirement 6.3
 */
function identifyGaps(
  requirements: CompetencyRequirement[],
  latestScores: Map<string, { score: number; assessmentId: string; assessedAt: string }>
): SkillGap[] {
  const gaps: SkillGap[] = [];

  for (const req of requirements) {
    const userScoreEntry = latestScores.get(req.topic);
    const userScore = userScoreEntry?.score ?? 0;

    if (userScore < req.requiredScore) {
      gaps.push({
        topic: req.topic,
        currentScore: userScore,
        requiredScore: req.requiredScore,
        gapMagnitude: req.requiredScore - userScore,
        weight: req.weight,
      });
    }
  }

  // Sort by gap magnitude descending (largest gaps first)
  gaps.sort((a, b) => b.gapMagnitude - a.gapMagnitude);

  return gaps;
}

/**
 * Build a list of competency scores for the response.
 */
function buildCompetencyScoreList(
  requirements: CompetencyRequirement[],
  latestScores: Map<string, { score: number; assessmentId: string; assessedAt: string }>
): CompetencyScore[] {
  return requirements.map((req) => {
    const entry = latestScores.get(req.topic);
    return {
      topic: req.topic,
      score: entry?.score ?? 0,
      assessmentId: entry?.assessmentId ?? '',
      assessedAt: entry?.assessedAt ?? '',
    };
  });
}

/**
 * Generate AI career development insights using Bedrock.
 *
 * Requirement 6.4
 */
async function generateInsights(
  orgId: string,
  targetUser: UserRecord,
  position: PositionRecord,
  gaps: SkillGap[],
  competencyScores: CompetencyScore[],
  claims: ReturnType<typeof extractClaims>
): Promise<string> {
  // If there are no gaps, provide a brief positive insight
  if (gaps.length === 0) {
    return 'The employee meets or exceeds all competency requirements for the target position. They are ready for promotion consideration.';
  }

  const systemPrompt = `You are an AI career development advisor for an employee talent platform. 
Your role is to analyze skill gaps and provide actionable career development insights and recommendations.
Focus on practical steps the employee can take to close their skill gaps and prepare for promotion.
Be specific, constructive, and encouraging in your recommendations.
Output format: A concise paragraph of career development insights followed by 3-5 specific recommendations.`;

  const gapSummary = gaps
    .map(
      (g) =>
        `- ${g.topic}: Current score ${g.currentScore}/100, Required ${g.requiredScore}/100 (Gap: ${g.gapMagnitude} points, Weight: ${(g.weight * 100).toFixed(0)}%)`
    )
    .join('\n');

  const scoreSummary = competencyScores
    .map((s) => `- ${s.topic}: ${s.score}/100`)
    .join('\n');

  const userContent = `Employee: ${targetUser.name}
Target Position: ${position.title}

Current Competency Scores:
${scoreSummary}

Identified Skill Gaps:
${gapSummary}

Please provide career development insights and specific recommendations to help this employee close their skill gaps and prepare for promotion to ${position.title}.`;

  const language = targetUser.languagePreference || 'en';

  try {
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language,
      feature: 'promotionInsights',
      orgId,
    });

    return result.content;
  } catch (error) {
    // If Bedrock fails, return a fallback message rather than failing the whole request
    console.error('Failed to generate AI insights:', error);
    return `Skill gaps identified in: ${gaps.map((g) => g.topic).join(', ')}. Please focus development efforts on the areas with the largest gaps.`;
  }
}
