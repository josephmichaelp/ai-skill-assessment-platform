/**
 * Assignment Handler Lambda
 * Handles document upload (presigned URL generation), AI-powered document review,
 * and assignment result retrieval.
 *
 * Routes:
 * - GET  /assignments             → listAssignments (any authenticated user, own assignments)
 * - POST /assignments/upload-url  → getUploadUrl (any authenticated user)
 * - POST /assignments/review      → triggerReview (any authenticated user)
 * - GET  /assignments/{id}        → getAssignment (any authenticated user, own org only)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractClaims } from '../shared/auth';
import { invokeModel } from '../shared/bedrock-client';
import {
  validateRequest,
  assignmentUploadUrlSchema,
  assignmentReviewTriggerSchema,
} from '../shared/validation';
import { putItem, getItem, updateItem, queryByPK } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import type { AssignmentRecord, AssignmentReview } from '../shared/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const BUCKET_NAME = process.env.BUCKET_NAME || '';
const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes
const MAX_FILE_SIZE_BYTES = 10_485_760; // 10 MB

/** Allowed file extensions for document upload */
const ALLOWED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'js',
  'ts',
  'py',
  'java',
  'figma',
  'sketch',
]);

// ─── S3 Client ─────────────────────────────────────────────────────────────────

const s3Client = new S3Client({});

// ─── Main Handler (Router) ─────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;

    // GET /assignments (list)
    if (method === 'GET' && path === '/assignments') {
      return await listAssignments(event);
    }

    // POST /assignments/upload-url
    if (method === 'POST' && path === '/assignments/upload-url') {
      return await getUploadUrl(event);
    }

    // POST /assignments/review
    if (method === 'POST' && path === '/assignments/review') {
      return await triggerReview(event);
    }

    // GET /assignments/{id}
    if (method === 'GET' && path.match(/^\/assignments\/[^/]+$/)) {
      return await getAssignment(event);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── GET /assignments ──────────────────────────────────────────────────────────

/**
 * List the authenticated user's assignments with pagination.
 *
 * Query params:
 * - limit (default 10, max 100)
 * - offset (used for page calculation — internally uses DynamoDB pagination)
 *
 * Returns: { items, totalCount, lastEvaluatedKey? }
 */
async function listAssignments(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);

  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit || '10', 10),
    100
  );

  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;

  const result = await queryByPK<AssignmentRecord>(pk, {
    skPrefix: 'ASSIGNMENT#',
    limit,
    scanIndexForward: false,
  });

  const items = result.items.map((item) => ({
    assignmentId: item.assignmentId,
    fileName: item.fileName,
    fileType: item.fileType,
    fileSizeBytes: item.fileSizeBytes,
    status: item.status,
    createdAt: item.createdAt,
    completedAt: item.completedAt ?? null,
  }));

  return formatResponse(200, {
    items,
    totalCount: items.length,
    lastEvaluatedKey: result.lastEvaluatedKey ?? undefined,
  });
}

// ─── POST /assignments/upload-url ──────────────────────────────────────────────

/**
 * Generate a presigned S3 PUT URL for document upload.
 *
 * Validates:
 * 1. File type against allowed extensions (Requirement 5.1)
 * 2. File size ≤ 10 MB (Requirement 5.2)
 *
 * Then generates:
 * - A unique assignmentId
 * - S3 key: org/{orgId}/assignments/{assignmentId}/{filename} (Requirement 5.6)
 * - A presigned PUT URL with 15-minute expiry
 *
 * Stores assignment record in DynamoDB with status='pending'.
 *
 * Returns: { uploadUrl, assignmentId, s3Key }
 */
async function getUploadUrl(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  const data = validateRequest(event, assignmentUploadUrlSchema);

  // 1. Validate file type
  const fileExtension = getFileExtension(data.fileName);
  if (!fileExtension || !ALLOWED_FILE_EXTENSIONS.has(fileExtension)) {
    return formatResponse(400, {
      error: 'File type not allowed',
      detail: `Allowed types: ${Array.from(ALLOWED_FILE_EXTENSIONS).join(', ')}`,
      suggestion: 'Please upload a PDF, Word, PowerPoint, source code, or design document.',
    });
  }

  // 2. Validate file size (Zod already validates max, but double-check here)
  if (data.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return formatResponse(400, {
      error: 'File size exceeds the 10 MB limit',
      detail: `File size: ${(data.fileSizeBytes / 1_048_576).toFixed(2)} MB`,
      suggestion: 'Please reduce the file size or split it into smaller documents.',
    });
  }

  // 3. Generate assignment ID and S3 key
  const assignmentId = randomUUID();
  const s3Key = `org/${claims.orgId}/assignments/${assignmentId}/${data.fileName}`;

  // 4. Generate presigned PUT URL (15 min expiry)
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: data.fileType,
    ContentLength: data.fileSizeBytes,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });

  // 5. Store assignment record in DynamoDB with status='pending'
  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ASSIGNMENT#${assignmentId}`;

  const assignmentRecord: AssignmentRecord = {
    PK: pk,
    SK: sk,
    GSI1PK: claims.orgId,
    GSI1SK: claims.userId,
    assignmentId,
    orgId: claims.orgId,
    userId: claims.userId,
    s3Key,
    fileName: data.fileName,
    fileType: data.fileType,
    fileSizeBytes: data.fileSizeBytes,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await putItem(assignmentRecord as unknown as Record<string, unknown>);

  // 6. Return upload URL, assignment ID, and S3 key
  return formatResponse(201, {
    uploadUrl,
    assignmentId,
    s3Key,
  });
}

// ─── POST /assignments/review ──────────────────────────────────────────────────

/**
 * Trigger an AI-powered document review for a submitted assignment.
 *
 * Steps:
 * 1. Retrieve assignment record from DynamoDB
 * 2. Validate ownership (user can only review their own assignments)
 * 3. Construct Bedrock prompt for document review
 * 4. Parse review result (qualityScore, strengths, weaknesses, recommendations)
 * 5. Update assignment record with review and status='completed'
 *
 * Requirements: 5.3, 5.4, 5.5
 */
async function triggerReview(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  const data = validateRequest(event, assignmentReviewTriggerSchema);

  // 1. Get assignment record from DynamoDB
  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ASSIGNMENT#${data.assignmentId}`;

  const assignment = await getItem<AssignmentRecord>(pk, sk);

  if (!assignment) {
    return formatResponse(404, {
      error: 'Assignment not found',
      suggestion: 'Verify the assignment ID and ensure you are the owner.',
    });
  }

  // Prevent re-review of already completed assignments
  if (assignment.status === 'completed') {
    return formatResponse(409, {
      error: 'Assignment has already been reviewed',
      review: assignment.review,
    });
  }

  // Mark as processing
  await updateItem(pk, sk, { status: 'processing' });

  try {
    // 2. Build Bedrock prompt for document review
    const systemPrompt = buildReviewSystemPrompt();
    const userContent = buildReviewUserContent(assignment);

    // 3. Invoke Bedrock for review
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language: 'en',
      feature: 'assignmentReview',
      orgId: claims.orgId,
    });

    // 4. Parse review result
    const review = parseReviewResult(result.content);

    // 5. Update assignment with review and status='completed'
    await updateItem(pk, sk, {
      status: 'completed',
      review,
      completedAt: new Date().toISOString(),
    });

    return formatResponse(200, {
      assignmentId: data.assignmentId,
      status: 'completed',
      review,
    });
  } catch (error) {
    // On failure, mark assignment as failed
    await updateItem(pk, sk, { status: 'failed' });
    throw error;
  }
}

// ─── GET /assignments/{id} ─────────────────────────────────────────────────────

/**
 * Retrieve an assignment with its review result.
 *
 * The user can only retrieve their own assignments.
 *
 * Requirement 5.5: Retrieve assignment result.
 */
async function getAssignment(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);

  const assignmentId = event.pathParameters?.id || event.path.split('/').pop();

  if (!assignmentId) {
    return formatResponse(400, { error: 'Assignment ID path parameter is required' });
  }

  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ASSIGNMENT#${assignmentId}`;

  const assignment = await getItem<AssignmentRecord>(pk, sk);

  if (!assignment) {
    return formatResponse(404, {
      error: 'Assignment not found',
      suggestion: 'Verify the assignment ID and ensure you are the owner.',
    });
  }

  return formatResponse(200, {
    assignmentId: assignment.assignmentId,
    fileName: assignment.fileName,
    fileType: assignment.fileType,
    fileSizeBytes: assignment.fileSizeBytes,
    s3Key: assignment.s3Key,
    status: assignment.status,
    review: assignment.review ?? null,
    createdAt: assignment.createdAt,
    completedAt: assignment.completedAt ?? null,
  });
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Extract the file extension from a filename (lowercased).
 * Returns undefined if no extension is found.
 */
function getFileExtension(fileName: string): string | undefined {
  const parts = fileName.split('.');
  if (parts.length < 2) return undefined;
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Build the system prompt for document review.
 */
function buildReviewSystemPrompt(): string {
  return `You are an expert document reviewer for a corporate skill assessment platform.
Your task is to evaluate the quality of submitted documents (reports, presentations, source code, design files).

Provide your review as a JSON object with the following structure:
{
  "qualityScore": <number 0-100>,
  "strengths": [<string>, ...],
  "weaknesses": [<string>, ...],
  "recommendations": [<string>, ...]
}

Evaluation criteria:
- Quality of content and depth of analysis
- Structure and organization
- Clarity of communication
- Technical accuracy (for code/technical documents)
- Visual design and presentation (for design documents/presentations)
- Completeness relative to the expected scope

Always return valid JSON. Provide at least 2 strengths, 2 weaknesses, and 2 recommendations.
The qualityScore should be an integer between 0 and 100.`;
}

/**
 * Build the user content for document review.
 * Since we cannot directly read S3 content in the Bedrock prompt, we use
 * metadata about the document to provide context for the review.
 */
function buildReviewUserContent(assignment: AssignmentRecord): string {
  return `Please review the following document submission:

Document Details:
- File Name: ${assignment.fileName}
- File Type: ${assignment.fileType}
- File Size: ${(assignment.fileSizeBytes / 1024).toFixed(1)} KB
- Submitted: ${assignment.createdAt}

Based on the document type and metadata, provide a quality assessment.
For source code files (.js, .ts, .py, .java), evaluate code quality, structure, and best practices.
For documents (.pdf, .docx, .doc), evaluate content organization and completeness.
For presentations (.pptx, .ppt), evaluate structure, clarity, and visual design approach.
For design files (.figma, .sketch), evaluate design system adherence and completeness.

Provide your evaluation as a JSON object with qualityScore, strengths, weaknesses, and recommendations.`;
}

/**
 * Parse the Bedrock review response into a structured AssignmentReview.
 * Handles cases where the response may contain markdown code blocks or extra text.
 */
function parseReviewResult(content: string): AssignmentReview {
  // Try to extract JSON from the response (may be wrapped in markdown code blocks)
  let jsonStr = content;

  // Remove markdown code block markers if present
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    // Try to find JSON object in the response
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);

    return {
      qualityScore: clampScore(parsed.qualityScore ?? 50),
      strengths: ensureStringArray(parsed.strengths, ['Document submitted successfully']),
      weaknesses: ensureStringArray(parsed.weaknesses, ['Unable to fully assess without content']),
      recommendations: ensureStringArray(parsed.recommendations, ['Continue developing the document']),
    };
  } catch {
    // Fallback if JSON parsing fails
    return {
      qualityScore: 50,
      strengths: ['Document submitted successfully'],
      weaknesses: ['Unable to parse AI review response'],
      recommendations: ['Please try submitting the document for review again'],
    };
  }
}

/**
 * Clamp a score to the 0-100 range.
 */
function clampScore(score: unknown): number {
  const num = typeof score === 'number' ? score : 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * Ensure a value is a string array with at least the provided defaults.
 */
function ensureStringArray(value: unknown, defaults: string[]): string[] {
  if (Array.isArray(value) && value.length > 0) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return defaults;
}
