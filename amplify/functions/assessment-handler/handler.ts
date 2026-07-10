/**
 * Assessment Handler Lambda
 * Manages quiz generation, submission, assessment history, and gap analysis.
 *
 * Endpoints:
 * - GET /assessments → listAssessments
 * - POST /assessments/generate → generateQuiz
 * - POST /assessments/submit → submitAssessment
 * - GET /assessments/gap-analysis → getGapAnalysis
 * - GET /assessments/{id} → getAssessment
 *
 * Requirements: 2.1, 2.2, 2.3, 2.6, 3.2, 3.3, 3.4, 3.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import crypto from 'crypto';
import { extractClaims } from '../shared/auth';
import { invokeModel } from '../shared/bedrock-client';
import { validateRequest, assessmentGenerationSchema, assessmentSubmissionSchema, sanitizeInput } from '../shared/validation';
import { putItem, queryByPK, getItem, updateItem } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import { writeAuditLog } from '../shared/audit';
import type { Question, Answer, QuestionFeedback, AssessmentRecord, UserRecord, PositionRecord } from '../shared/types';

// ─── Router ────────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path;

    // POST /assessments/generate
    if (method === 'POST' && path.endsWith('/assessments/generate')) {
      return await generateQuiz(event);
    }

    // POST /assessments/submit
    if (method === 'POST' && path.endsWith('/assessments/submit')) {
      return await submitAssessment(event);
    }

    // GET /assessments/gap-analysis
    if (method === 'GET' && path.endsWith('/assessments/gap-analysis')) {
      return await getGapAnalysis(event);
    }

    // GET /assessments/{id}
    if (method === 'GET' && /\/assessments\/[^/]+$/.test(path) && !path.endsWith('/assessments') && !path.endsWith('/gap-analysis')) {
      return await getAssessment(event);
    }

    // GET /assessments
    if (method === 'GET' && path.endsWith('/assessments')) {
      return await listAssessments(event);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── POST /assessments/generate ────────────────────────────────────────────────

/**
 * Generate a quiz using Amazon Bedrock Nova Lite.
 *
 * 1. Extract user claims (userId, orgId)
 * 2. Validate request body (topic, difficulty, language)
 * 3. Sanitize the topic input
 * 4. Build Bedrock prompt with JSON output schema
 * 5. Invoke Bedrock Nova Lite
 * 6. Parse and validate response (10-20 questions)
 * 7. Store assessment in DynamoDB
 * 8. Return assessment to client
 *
 * Requirements: 2.1 (quiz generation), 2.2 (difficulty levels), 2.3 (topic selection), 3.5 (bilingual)
 */
async function generateQuiz(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);
  const { userId, orgId } = claims;

  // 2. Validate request body
  const body = validateRequest(event, assessmentGenerationSchema);
  const { topic, difficulty, language = 'id' } = body;

  // 3. Sanitize topic input
  const sanitizedTopic = sanitizeInput(topic);

  // 4. Build Bedrock prompt
  const systemPrompt = buildQuizSystemPrompt(difficulty);
  const userContent = buildQuizUserContent(sanitizedTopic, difficulty, language);

  // 5. Invoke Bedrock Nova Lite
  const result = await invokeModel({
    systemPrompt,
    userContent,
    language,
    feature: 'quizGeneration',
    orgId,
  });

  // 6. Parse and validate response
  const questions = parseAndValidateQuestions(result.content);

  // 7. Store in DynamoDB
  const assessmentId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const assessmentRecord: AssessmentRecord = {
    PK: `ORG#${orgId}#USER#${userId}`,
    SK: `ASSESSMENT#${timestamp}#${assessmentId}`,
    GSI1PK: orgId,
    GSI1SK: userId,
    assessmentId,
    orgId,
    userId,
    topic: sanitizedTopic,
    difficulty,
    score: 0,
    questionCount: questions.length,
    questions,
    answers: [],
    feedback: [],
    competencyScores: {},
    createdAt: timestamp,
  };

  await putItem(assessmentRecord as unknown as Record<string, unknown>);

  // 8. Return assessment to client
  return formatResponse(201, {
    assessmentId,
    topic: sanitizedTopic,
    difficulty,
    questionCount: questions.length,
    questions: questions.map((q) => ({
      questionId: q.questionId,
      text: q.text,
      type: q.type,
      options: q.options,
    })),
    createdAt: timestamp,
  });
}

// ─── Prompt Construction ───────────────────────────────────────────────────────

/**
 * Build system prompt for quiz generation.
 * Instructs the model to generate structured JSON output.
 */
function buildQuizSystemPrompt(difficulty: string): string {
  const questionCount = getQuestionCount(difficulty);

  return `You are an assessment generator. Generate a quiz with exactly ${questionCount} questions on the given topic at the specified difficulty level. Return ONLY valid JSON.

Your response must be a JSON object with the following schema:
{
  "questions": [
    {
      "questionId": "q1",
      "text": "The question text",
      "type": "multiple_choice" | "true_false" | "short_answer",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "The correct answer"
    }
  ]
}

Rules:
- Generate exactly ${questionCount} questions
- Use a mix of question types: multiple_choice (with 4 options), true_false, and short_answer
- Ensure questions are relevant to the topic and match the difficulty level
- For multiple_choice questions, always provide exactly 4 options
- For true_false questions, options should be ["True", "False"]
- For short_answer questions, omit the options field
- correctAnswer must be one of the options for multiple_choice/true_false, or a brief correct answer for short_answer
- Do not include any text outside the JSON object`;
}

/**
 * Build user content for quiz generation prompt.
 * Includes topic, difficulty, and language instruction.
 */
function buildQuizUserContent(topic: string, difficulty: string, language: string): string {
  const languageInstruction = language === 'id'
    ? 'Generate all question text and options in Bahasa Indonesia.'
    : 'Generate all question text and options in English.';

  return `Topic: ${topic}
Difficulty: ${difficulty}
${languageInstruction}

Generate the quiz now. Return ONLY the JSON object.`;
}

/**
 * Determine number of questions based on difficulty.
 * Beginner: 10, Intermediate: 15, Advanced: 20
 */
function getQuestionCount(difficulty: string): number {
  switch (difficulty) {
    case 'Beginner':
      return 10;
    case 'Intermediate':
      return 15;
    case 'Advanced':
      return 20;
    default:
      return 10;
  }
}

// ─── Response Parsing ──────────────────────────────────────────────────────────

/**
 * Parse the Bedrock response and validate it contains 10-20 questions
 * with proper format (questionId, text, type, correctAnswer).
 *
 * Requirement 2.1: Quiz must have 10-20 questions.
 */
function parseAndValidateQuestions(content: string): Question[] {
  // Try to extract JSON from the response (handle possible markdown code blocks)
  let jsonContent = content.trim();

  // Remove markdown code block wrappers if present
  if (jsonContent.startsWith('```json')) {
    jsonContent = jsonContent.slice(7);
  } else if (jsonContent.startsWith('```')) {
    jsonContent = jsonContent.slice(3);
  }
  if (jsonContent.endsWith('```')) {
    jsonContent = jsonContent.slice(0, -3);
  }
  jsonContent = jsonContent.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error(
      'Failed to parse quiz response from AI model. The response was not valid JSON. Please try again.'
    );
  }

  // Validate structure
  const data = parsed as { questions?: unknown[] };
  if (!data || !Array.isArray(data.questions)) {
    throw new Error(
      'Invalid quiz response structure. Expected an object with a "questions" array. Please try again.'
    );
  }

  const questions = data.questions;

  // Validate question count (10-20)
  if (questions.length < 10 || questions.length > 20) {
    throw new Error(
      `Invalid quiz: expected 10-20 questions, got ${questions.length}. Please try again.`
    );
  }

  // Validate and map each question
  const validatedQuestions: Question[] = questions.map((q: unknown, index: number) => {
    const question = q as Record<string, unknown>;

    const questionId = (question.questionId as string) || `q${index + 1}`;
    const text = question.text as string;
    const type = question.type as string;
    const options = question.options as string[] | undefined;
    const correctAnswer = question.correctAnswer as string;

    if (!text) {
      throw new Error(`Question ${index + 1} is missing "text" field.`);
    }

    if (!type || !['multiple_choice', 'true_false', 'short_answer'].includes(type)) {
      throw new Error(
        `Question ${index + 1} has invalid type "${type}". Must be one of: multiple_choice, true_false, short_answer.`
      );
    }

    if (!correctAnswer) {
      throw new Error(`Question ${index + 1} is missing "correctAnswer" field.`);
    }

    // Validate options for multiple_choice and true_false
    if ((type === 'multiple_choice' || type === 'true_false') && (!options || !Array.isArray(options) || options.length === 0)) {
      throw new Error(
        `Question ${index + 1} (${type}) must have an "options" array.`
      );
    }

    return {
      questionId,
      text,
      type: type as Question['type'],
      options: options ?? undefined,
      correctAnswer,
    };
  });

  return validatedQuestions;
}

// ─── Assessment History & Gap Analysis Endpoints ───────────────────────────────

/**
 * GET /assessments — List user's assessments in reverse chronological order with pagination.
 *
 * Query parameters:
 * - limit: number of items per page (default 20, max 100)
 * - lastEvaluatedKey: base64-encoded JSON pagination token from previous response
 *
 * Returns assessment summaries (assessmentId, topic, difficulty, score, questionCount, createdAt).
 *
 * Requirement 2.6: Assessment history in reverse chronological order with pagination.
 */
async function listAssessments(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  const { userId, orgId } = claims;

  // Parse pagination params from query string
  const queryParams = event.queryStringParameters || {};
  const requestedLimit = queryParams.limit ? parseInt(queryParams.limit, 10) : 20;
  const limit = Math.min(Math.max(requestedLimit, 1), 100); // clamp to 1-100

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      lastEvaluatedKey = JSON.parse(
        Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8')
      );
    } catch {
      return formatResponse(400, { error: 'Invalid lastEvaluatedKey parameter' });
    }
  }

  const pk = `ORG#${orgId}#USER#${userId}`;
  const result = await queryByPK<AssessmentRecord>(pk, {
    skPrefix: 'ASSESSMENT#',
    limit,
    scanIndexForward: false,
    lastEvaluatedKey,
  });

  const assessments = result.items.map((item) => ({
    assessmentId: item.assessmentId,
    topic: item.topic,
    difficulty: item.difficulty,
    score: item.score,
    questionCount: item.questionCount,
    createdAt: item.createdAt,
  }));

  // Encode lastEvaluatedKey as base64 for the client to use in next request
  const nextPageToken = result.lastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
    : undefined;

  return formatResponse(200, {
    assessments,
    lastEvaluatedKey: nextPageToken,
  });
}

/**
 * POST /assessments/submit — Submit assessment answers and evaluate.
 *
 * 1. Extract user claims (userId, orgId)
 * 2. Validate request body (assessmentId, answers array)
 * 3. Fetch the assessment from DynamoDB to get questions and correct answers
 * 4. Grade each answer (exact match for MC/TF, Bedrock for short_answer)
 * 5. Compute overall score: (correctAnswers / totalQuestions) * 100
 * 6. Generate per-question feedback via Bedrock
 * 7. Update assessment record with answers, feedback, score, competencyScores
 * 8. Return the result
 *
 * Requirements: 2.4, 2.5, 3.1
 */
async function submitAssessment(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);
  const { userId, orgId } = claims;

  // 2. Validate request body
  const body = validateRequest(event, assessmentSubmissionSchema);
  const { assessmentId, answers } = body;

  // 3. Fetch the assessment from DynamoDB
  const pk = `ORG#${orgId}#USER#${userId}`;
  const assessmentResult = await queryByPK<AssessmentRecord>(pk, {
    skPrefix: 'ASSESSMENT#',
  });

  const assessment = assessmentResult.items.find(
    (item) => item.assessmentId === assessmentId
  );

  if (!assessment) {
    return formatResponse(404, { error: 'Assessment not found' });
  }

  // 4. Grade each answer
  const gradedAnswers: Answer[] = [];
  const questions = assessment.questions;

  for (const submittedAnswer of answers) {
    const question = questions.find(
      (q) => q.questionId === submittedAnswer.questionId
    );

    if (!question) {
      gradedAnswers.push({
        questionId: submittedAnswer.questionId,
        userAnswer: submittedAnswer.answer,
        isCorrect: false,
      });
      continue;
    }

    let isCorrect = false;

    if (question.type === 'multiple_choice' || question.type === 'true_false') {
      // Exact match (case-insensitive) for MC and TF
      isCorrect =
        submittedAnswer.answer.trim().toLowerCase() ===
        question.correctAnswer.trim().toLowerCase();
    } else if (question.type === 'short_answer') {
      // Use Bedrock to evaluate short answer similarity
      isCorrect = await evaluateShortAnswer(
        question.text,
        question.correctAnswer,
        submittedAnswer.answer,
        orgId
      );
    }

    gradedAnswers.push({
      questionId: submittedAnswer.questionId,
      userAnswer: submittedAnswer.answer,
      isCorrect,
    });
  }

  // 5. Compute overall score
  const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
  const totalQuestions = questions.length;
  const score = Math.round((correctCount / totalQuestions) * 100);

  // 6. Generate per-question feedback via Bedrock
  const feedback = await generateFeedback(questions, gradedAnswers, orgId);

  // 7. Update competencyScores for the topic
  const competencyScores: Record<string, number> = {
    [assessment.topic]: score,
  };

  // 8. Update the assessment record in DynamoDB
  await updateItem(assessment.PK, assessment.SK, {
    answers: gradedAnswers,
    feedback,
    score,
    competencyScores,
  });

  // 9. Return the result
  return formatResponse(200, {
    assessmentId,
    score,
    totalQuestions,
    correctCount,
    answers: gradedAnswers,
    feedback,
    competencyScores,
  });
}

/**
 * Evaluate a short answer using Bedrock to determine if it is semantically correct.
 * Returns true if the user's answer is considered correct or substantially equivalent.
 */
async function evaluateShortAnswer(
  questionText: string,
  correctAnswer: string,
  userAnswer: string,
  orgId: string
): Promise<boolean> {
  const systemPrompt = `You are an assessment grader. Evaluate whether the student's answer is semantically correct compared to the expected answer. Consider partial credit for answers that demonstrate understanding. Respond with ONLY "CORRECT" or "INCORRECT".`;

  const userContent = `Question: ${questionText}
Expected Answer: ${correctAnswer}
Student Answer: ${userAnswer}

Is the student's answer correct or substantially equivalent to the expected answer? Respond with ONLY "CORRECT" or "INCORRECT".`;

  try {
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language: 'en',
      feature: 'quizGeneration',
      orgId,
      maxOutputTokens: 10,
    });

    return result.content.trim().toUpperCase().includes('CORRECT') &&
      !result.content.trim().toUpperCase().includes('INCORRECT');
  } catch {
    // Fallback to simple string comparison if Bedrock fails
    return userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
  }
}

/**
 * Generate per-question feedback using Bedrock.
 * Returns an array of feedback objects with questionId, explanation, and correctAnswer.
 *
 * Requirement 2.4: Per-question feedback with explanation and correct answer.
 */
async function generateFeedback(
  questions: Question[],
  gradedAnswers: Answer[],
  orgId: string
): Promise<QuestionFeedback[]> {
  // Build prompt with all questions, user answers, and correct answers
  const questionsContext = questions.map((q, i) => {
    const userAnswer = gradedAnswers.find((a) => a.questionId === q.questionId);
    return `Question ${i + 1} (${q.questionId}):
  Text: ${q.text}
  Type: ${q.type}
  Correct Answer: ${q.correctAnswer}
  User Answer: ${userAnswer?.userAnswer ?? '(no answer)'}
  Was Correct: ${userAnswer?.isCorrect ?? false}`;
  }).join('\n\n');

  const systemPrompt = `You are an educational feedback generator. For each question, provide a brief explanation of why the correct answer is right and, if the student answered incorrectly, what they should understand. Return ONLY valid JSON.

Your response must be a JSON object with the following schema:
{
  "feedback": [
    {
      "questionId": "q1",
      "explanation": "Brief explanation of the correct answer and learning point",
      "correctAnswer": "The correct answer"
    }
  ]
}

Rules:
- Provide feedback for EVERY question, not just incorrect ones
- Keep explanations concise (1-2 sentences)
- Include the correct answer in each feedback item
- Do not include any text outside the JSON object`;

  const userContent = `Here are the assessment questions and the student's answers:\n\n${questionsContext}\n\nGenerate feedback for all ${questions.length} questions. Return ONLY the JSON object.`;

  try {
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language: 'en',
      feature: 'quizGeneration',
      orgId,
    });

    return parseFeedbackResponse(result.content, questions);
  } catch {
    // Fallback: return basic feedback without AI explanation
    return questions.map((q) => ({
      questionId: q.questionId,
      explanation: `The correct answer is: ${q.correctAnswer}`,
      correctAnswer: q.correctAnswer,
    }));
  }
}

/**
 * Parse the Bedrock feedback response JSON.
 * Falls back to basic feedback if parsing fails.
 */
function parseFeedbackResponse(
  content: string,
  questions: Question[]
): QuestionFeedback[] {
  let jsonContent = content.trim();

  // Remove markdown code block wrappers if present
  if (jsonContent.startsWith('```json')) {
    jsonContent = jsonContent.slice(7);
  } else if (jsonContent.startsWith('```')) {
    jsonContent = jsonContent.slice(3);
  }
  if (jsonContent.endsWith('```')) {
    jsonContent = jsonContent.slice(0, -3);
  }
  jsonContent = jsonContent.trim();

  try {
    const parsed = JSON.parse(jsonContent) as { feedback?: unknown[] };

    if (!parsed || !Array.isArray(parsed.feedback)) {
      throw new Error('Invalid feedback structure');
    }

    const feedbackItems: QuestionFeedback[] = parsed.feedback.map((item: unknown) => {
      const fb = item as Record<string, unknown>;
      return {
        questionId: (fb.questionId as string) || '',
        explanation: (fb.explanation as string) || '',
        correctAnswer: (fb.correctAnswer as string) || '',
      };
    });

    // Ensure we have feedback for all questions
    if (feedbackItems.length >= questions.length) {
      return feedbackItems.slice(0, questions.length);
    }

    // Fill missing feedback entries
    const filledFeedback: QuestionFeedback[] = questions.map((q) => {
      const existing = feedbackItems.find((f) => f.questionId === q.questionId);
      return existing ?? {
        questionId: q.questionId,
        explanation: `The correct answer is: ${q.correctAnswer}`,
        correctAnswer: q.correctAnswer,
      };
    });

    return filledFeedback;
  } catch {
    // Fallback if parsing fails
    return questions.map((q) => ({
      questionId: q.questionId,
      explanation: `The correct answer is: ${q.correctAnswer}`,
      correctAnswer: q.correctAnswer,
    }));
  }
}

/**
 * GET /assessments/{id} — Get a single assessment result with full details.
 *
 * Path parameter: id — the assessmentId
 *
 * Returns the full assessment with questions, answers, feedback, and score.
 *
 * Requirements: 2.6 (assessment history access)
 */
async function getAssessment(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  const { userId, orgId } = claims;

  // Extract assessmentId from path
  const pathParts = event.path.split('/');
  const assessmentId = pathParts[pathParts.length - 1];

  if (!assessmentId) {
    return formatResponse(400, { error: 'Assessment ID is required' });
  }

  // Query by PK with ASSESSMENT# prefix and filter by assessmentId
  // (SK includes timestamp which we don't know, so we query all and filter)
  const pk = `ORG#${orgId}#USER#${userId}`;
  const result = await queryByPK<AssessmentRecord>(pk, {
    skPrefix: 'ASSESSMENT#',
  });

  const assessment = result.items.find(
    (item) => item.assessmentId === assessmentId
  );

  if (!assessment) {
    return formatResponse(404, { error: 'Assessment not found' });
  }

  // Audit log: assessment result viewed (fire-and-forget)
  void writeAuditLog({
    orgId,
    userId,
    action: 'READ',
    resource: `assessment/${assessmentId}`,
    details: `Viewed assessment result for topic: ${assessment.topic}`,
  });

  return formatResponse(200, {
    assessmentId: assessment.assessmentId,
    topic: assessment.topic,
    difficulty: assessment.difficulty,
    score: assessment.score,
    questionCount: assessment.questionCount,
    questions: assessment.questions,
    answers: assessment.answers,
    feedback: assessment.feedback,
    competencyScores: assessment.competencyScores,
    createdAt: assessment.createdAt,
  });
}

/**
 * GET /assessments/gap-analysis — Compute skill gaps and generate AI recommendations.
 *
 * 1. Extract claims
 * 2. Get user's target position from their UserRecord
 * 3. If no target position, return empty gaps
 * 4. Get position's competency requirements
 * 5. Get user's latest competency scores (aggregated from all assessments)
 * 6. Compare: for each requirement where user score < required score → gap
 * 7. Generate AI recommendations for each gap via Bedrock
 * 8. Return gaps with recommendations
 *
 * Requirements: 3.2 (compare scores vs target), 3.3 (identify gaps with magnitude), 3.4 (AI recommendations)
 */
async function getGapAnalysis(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = extractClaims(event);
  const { userId, orgId } = claims;

  // 2. Get user's record to find target position
  const userRecord = await getItem<UserRecord>(`ORG#${orgId}`, `USER#${userId}`);

  if (!userRecord || !userRecord.targetPositionId) {
    return formatResponse(200, { gaps: [], message: 'No target position assigned' });
  }

  // 3. Get position's competency requirements
  const positionRecord = await getItem<PositionRecord>(
    `ORG#${orgId}`,
    `POSITION#${userRecord.targetPositionId}`
  );

  if (!positionRecord || !positionRecord.competencyRequirements || positionRecord.competencyRequirements.length === 0) {
    return formatResponse(200, { gaps: [], message: 'Target position has no competency requirements configured' });
  }

  // 4. Get user's latest competency scores (aggregate from all assessments)
  const pk = `ORG#${orgId}#USER#${userId}`;
  const assessmentResult = await queryByPK<AssessmentRecord>(pk, {
    skPrefix: 'ASSESSMENT#',
    scanIndexForward: false, // most recent first
  });

  // Aggregate: for each topic, take the latest (most recent) score
  const latestScoresByTopic: Record<string, number> = {};
  for (const assessment of assessmentResult.items) {
    if (assessment.competencyScores) {
      for (const [topic, score] of Object.entries(assessment.competencyScores)) {
        // Since results are ordered reverse-chronologically, first occurrence is the latest
        if (!(topic in latestScoresByTopic)) {
          latestScoresByTopic[topic] = score;
        }
      }
    }
  }

  // 5. Compare user scores vs required scores
  const gaps: Array<{
    topic: string;
    currentScore: number;
    requiredScore: number;
    gapMagnitude: number;
    recommendation?: string;
  }> = [];

  for (const requirement of positionRecord.competencyRequirements) {
    const currentScore = latestScoresByTopic[requirement.topic] ?? 0;
    if (currentScore < requirement.requiredScore) {
      gaps.push({
        topic: requirement.topic,
        currentScore,
        requiredScore: requirement.requiredScore,
        gapMagnitude: requirement.requiredScore - currentScore,
      });
    }
  }

  // 6. If no gaps, return early
  if (gaps.length === 0) {
    return formatResponse(200, { gaps: [], message: 'No skill gaps identified. All competencies meet or exceed requirements.' });
  }

  // 7. Generate AI recommendations for each gap via Bedrock
  const language = userRecord.languagePreference || 'id';
  const recommendations = await generateGapRecommendations(gaps, positionRecord.title, language, orgId);

  // Merge recommendations into gaps
  const gapsWithRecommendations = gaps.map((gap, index) => ({
    ...gap,
    recommendation: recommendations[index] || 'Focus on improving this competency through targeted practice and study.',
  }));

  return formatResponse(200, {
    targetPosition: positionRecord.title,
    gaps: gapsWithRecommendations,
  });
}

/**
 * Generate AI-based improvement recommendations for skill gaps.
 * Uses Amazon Bedrock Nova Lite to produce personalized suggestions.
 *
 * Requirement 3.4: AI-based improvement recommendations for each gap.
 */
async function generateGapRecommendations(
  gaps: Array<{ topic: string; currentScore: number; requiredScore: number; gapMagnitude: number }>,
  positionTitle: string,
  language: 'id' | 'en',
  orgId: string
): Promise<string[]> {
  const gapDescriptions = gaps.map(
    (g, i) => `${i + 1}. Topic: "${g.topic}" — Current Score: ${g.currentScore}/100, Required: ${g.requiredScore}/100, Gap: ${g.gapMagnitude} points`
  ).join('\n');

  const systemPrompt = `You are a career development advisor. Given an employee's skill gaps relative to their target position, provide actionable improvement recommendations for each gap area. Return ONLY valid JSON.

Your response must be a JSON object with the following schema:
{
  "recommendations": [
    "Recommendation for gap 1",
    "Recommendation for gap 2"
  ]
}

Rules:
- Provide exactly one recommendation per gap (in the same order as the input)
- Each recommendation should be 2-3 sentences with specific, actionable advice
- Consider the gap magnitude when prioritizing urgency
- Include both learning resources suggestions and practical exercises
- Do not include any text outside the JSON object`;

  const userContent = `Target Position: ${positionTitle}

Skill Gaps:
${gapDescriptions}

Generate one improvement recommendation for each gap area. Return ONLY the JSON object.`;

  try {
    const result = await invokeModel({
      systemPrompt,
      userContent,
      language,
      feature: 'gapAnalysis',
      orgId,
    });

    return parseRecommendationsResponse(result.content, gaps.length);
  } catch {
    // Fallback: return generic recommendations if Bedrock fails
    return gaps.map(
      (g) => `Focus on improving your ${g.topic} skills to close the ${g.gapMagnitude}-point gap. Consider taking additional assessments and studying relevant materials.`
    );
  }
}

/**
 * Parse the AI recommendations response JSON.
 * Falls back to empty array if parsing fails.
 */
function parseRecommendationsResponse(content: string, expectedCount: number): string[] {
  let jsonContent = content.trim();

  // Remove markdown code block wrappers if present
  if (jsonContent.startsWith('```json')) {
    jsonContent = jsonContent.slice(7);
  } else if (jsonContent.startsWith('```')) {
    jsonContent = jsonContent.slice(3);
  }
  if (jsonContent.endsWith('```')) {
    jsonContent = jsonContent.slice(0, -3);
  }
  jsonContent = jsonContent.trim();

  try {
    const parsed = JSON.parse(jsonContent) as { recommendations?: unknown[] };

    if (!parsed || !Array.isArray(parsed.recommendations)) {
      return [];
    }

    const recommendations = parsed.recommendations
      .map((r) => (typeof r === 'string' ? r : String(r)))
      .slice(0, expectedCount);

    return recommendations;
  } catch {
    return [];
  }
}
