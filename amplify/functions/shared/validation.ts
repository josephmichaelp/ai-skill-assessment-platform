/**
 * Request Validation Utilities
 * Zod schemas for all API request bodies and input sanitization helpers.
 *
 * - validateRequest(event, schema) — parses event.body with Zod, throws ValidationError on failure
 * - sanitizeInput(input) — strips injection patterns (SQL, prompt injection, script tags)
 *
 * Requirements: 9.5 (implied from design)
 */

import { z, ZodSchema, ZodError } from 'zod';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ─── Custom Errors ─────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  public readonly statusCode = 400;
  public readonly fieldErrors: Array<{ field: string; message: string }>;

  constructor(fieldErrors: Array<{ field: string; message: string }>) {
    const summary = fieldErrors.map((e) => `${e.field}: ${e.message}`).join('; ');
    super(`Validation failed: ${summary}`);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

// ─── Zod Schemas ───────────────────────────────────────────────────────────────

/** 1. Assessment generation */
export const assessmentGenerationSchema = z.object({
  topic: z.string().min(1, 'Topic is required').max(200),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  language: z.enum(['id', 'en']).optional(),
});

/** 2. Assessment submission */
export const assessmentSubmissionSchema = z.object({
  assessmentId: z.string().min(1, 'Assessment ID is required'),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1, 'Question ID is required'),
        answer: z.string().min(1, 'Answer is required'),
      })
    )
    .min(1, 'At least one answer is required'),
});

/** 3. Roleplay start */
export const roleplayStartSchema = z.object({
  scenarioType: z.enum(['Customer', 'Interviewer', 'Manager', 'DifficultCustomer']),
  language: z.enum(['id', 'en']).optional(),
});

/** 4. Roleplay message */
export const roleplayMessageSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  message: z.string().min(1, 'Message is required').max(5000),
});

/** 5. Assignment upload URL */
export const assignmentUploadUrlSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255),
  fileType: z.string().min(1, 'File type is required'),
  fileSizeBytes: z
    .number()
    .int()
    .positive('File size must be positive')
    .max(10_485_760, 'File size must not exceed 10 MB'),
});

/** 6. Assignment review trigger */
export const assignmentReviewTriggerSchema = z.object({
  assignmentId: z.string().min(1, 'Assignment ID is required'),
});

/** 7. Performance summary generation */
export const performanceSummaryGenerationSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  startDate: z.string().min(1, 'Start date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  endDate: z.string().min(1, 'End date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
  language: z.enum(['id', 'en']).optional(),
});

/** 8. User creation */
export const userCreationSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required').max(200),
  role: z.enum(['Employee', 'Manager']),
  targetPositionId: z.string().optional(),
});

/** 9. User update */
export const userUpdateSchema = z.object({
  role: z.enum(['Employee', 'Manager', 'Admin']).optional(),
  targetPositionId: z.string().optional(),
});

/** 10. Position creation */
export const positionCreationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  competencyRequirements: z
    .array(
      z.object({
        topic: z.string().min(1, 'Topic is required'),
        requiredScore: z.number().min(0).max(100),
        weight: z.number().min(0).max(1),
      })
    )
    .min(1, 'At least one competency requirement is required'),
});

/** 11. Position update (all fields optional) */
export const positionUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  competencyRequirements: z
    .array(
      z.object({
        topic: z.string().min(1, 'Topic is required'),
        requiredScore: z.number().min(0).max(100),
        weight: z.number().min(0).max(1),
      })
    )
    .min(1)
    .optional(),
});

// ─── validateRequest ───────────────────────────────────────────────────────────

/**
 * Parse and validate an API Gateway event body against a Zod schema.
 * Returns the validated and typed data on success.
 * Throws `ValidationError` with detailed field-level errors on failure.
 *
 * @param event - The API Gateway proxy event containing the JSON body
 * @param schema - The Zod schema to validate against
 * @returns The parsed and validated data
 * @throws ValidationError when body is missing, malformed JSON, or fails schema validation
 */
export function validateRequest<T>(event: APIGatewayProxyEvent, schema: ZodSchema<T>): T {
  const { body } = event;

  if (!body) {
    throw new ValidationError([{ field: 'body', message: 'Request body is required' }]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ValidationError([{ field: 'body', message: 'Request body must be valid JSON' }]);
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    const fieldErrors = mapZodErrors(result.error);
    throw new ValidationError(fieldErrors);
  }

  return result.data;
}

/**
 * Map Zod validation errors to a flat field/message list.
 */
function mapZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
}

// ─── sanitizeInput ─────────────────────────────────────────────────────────────

/**
 * Sanitize a string input by stripping potentially dangerous patterns:
 * 1. HTML/script tags
 * 2. SQL injection patterns (DROP, DELETE, INSERT, UPDATE followed by SQL keywords)
 * 3. Prompt injection patterns ("ignore previous instructions", "system:", etc.)
 *
 * @param input - The raw user input string
 * @returns The sanitized string
 */
export function sanitizeInput(input: string): string {
  let sanitized = input;

  // 1. Strip HTML/script tags
  sanitized = stripHtmlTags(sanitized);

  // 2. Remove SQL injection patterns
  sanitized = stripSqlInjection(sanitized);

  // 3. Remove prompt injection patterns
  sanitized = stripPromptInjection(sanitized);

  // Collapse multiple spaces resulting from removals
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();

  return sanitized;
}

/**
 * Strip HTML and script tags from input.
 */
function stripHtmlTags(input: string): string {
  // Remove script tags and their content
  let result = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove style tags and their content
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove all remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');
  return result;
}

/**
 * Strip SQL injection patterns.
 * Removes dangerous SQL statements: DROP TABLE, DELETE FROM, INSERT INTO, UPDATE ... SET,
 * UNION SELECT, and common SQL comment sequences.
 */
function stripSqlInjection(input: string): string {
  const sqlPatterns = [
    /\bDROP\s+(TABLE|DATABASE|INDEX)\b/gi,
    /\bDELETE\s+FROM\b/gi,
    /\bINSERT\s+INTO\b/gi,
    /\bUPDATE\s+\w+\s+SET\b/gi,
    /\bUNION\s+(ALL\s+)?SELECT\b/gi,
    /\bSELECT\s+.*\s+FROM\b/gi,
    /\bALTER\s+TABLE\b/gi,
    /\bEXEC(UTE)?\s*\(/gi,
    /;\s*--/g,
    /\/\*[\s\S]*?\*\//g,
  ];

  let result = input;
  for (const pattern of sqlPatterns) {
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * Strip prompt injection patterns.
 * Removes common attempts to override system instructions or inject system-level prompts.
 */
function stripPromptInjection(input: string): string {
  const promptPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /ignore\s+(all\s+)?prior\s+instructions/gi,
    /disregard\s+(all\s+)?previous\s+instructions/gi,
    /forget\s+(all\s+)?previous\s+(instructions|context)/gi,
    /\bsystem\s*:/gi,
    /\bassistant\s*:/gi,
    /\bhuman\s*:/gi,
    /you\s+are\s+now\s+/gi,
    /act\s+as\s+if\s+/gi,
    /pretend\s+(you\s+are|to\s+be)\s+/gi,
    /new\s+instructions?\s*:/gi,
    /override\s+(previous\s+)?instructions/gi,
    /\[\s*SYSTEM\s*\]/gi,
    /\[\s*INST\s*\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
  ];

  let result = input;
  for (const pattern of promptPatterns) {
    result = result.replace(pattern, '');
  }
  return result;
}
