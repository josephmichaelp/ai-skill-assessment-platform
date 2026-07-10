/**
 * Shared TypeScript interfaces for the AI Skill Assessment & Talent Development Platform.
 * These interfaces match the DynamoDB single-table item schemas defined in the design.
 *
 * Table: platform-data
 * Key Schema: PK (String, Partition Key), SK (String, Sort Key)
 * GSI1: GSI1PK (orgId), GSI1SK (userId) — manager views
 * GSI2: GSI2PK (orgId), GSI2SK (createdAt) — time-based queries
 */

// ─── User Record ───────────────────────────────────────────────────────────────

export interface UserRecord {
  PK: string;          // "ORG#{orgId}"
  SK: string;          // "USER#{userId}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "USER#{userId}"
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: 'Admin' | 'Manager' | 'Employee';
  targetPositionId?: string;
  languagePreference: 'id' | 'en';
  createdAt: string;   // ISO 8601
  updatedAt: string;
}

// ─── Assessment Record ─────────────────────────────────────────────────────────

export interface Question {
  questionId: string;
  text: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  options?: string[];
  correctAnswer: string;
}

export interface Answer {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
}

export interface QuestionFeedback {
  questionId: string;
  explanation: string;
  correctAnswer: string;
}

export interface AssessmentRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "ASSESSMENT#{timestamp}#{id}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  assessmentId: string;
  orgId: string;
  userId: string;
  topic: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  score: number;       // 0-100
  questionCount: number;
  questions: Question[];
  answers: Answer[];
  feedback: QuestionFeedback[];
  competencyScores: Record<string, number>;
  createdAt: string;
}

// ─── Roleplay Session Record ───────────────────────────────────────────────────

export interface RoleplayMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface RoleplayEvaluation {
  communicationScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallFeedback: string;
}

export interface RoleplaySessionRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "ROLEPLAY#{sessionId}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  sessionId: string;
  orgId: string;
  userId: string;
  scenarioType: 'Customer' | 'Interviewer' | 'Manager' | 'DifficultCustomer';
  scenarioContext: string;
  objectives: string[];
  status: 'active' | 'completed';
  messages: RoleplayMessage[];
  evaluation?: RoleplayEvaluation;
  createdAt: string;
  completedAt?: string;
}

// ─── Assignment Record ─────────────────────────────────────────────────────────

export interface AssignmentReview {
  qualityScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  plagiarismScore?: number;
}

export interface AssignmentRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "ASSIGNMENT#{assignmentId}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  assignmentId: string;
  orgId: string;
  userId: string;
  s3Key: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  review?: AssignmentReview;
  createdAt: string;
  completedAt?: string;
}

// ─── Position Record ───────────────────────────────────────────────────────────

export interface CompetencyRequirement {
  topic: string;
  requiredScore: number;
  weight: number;
}

export interface PositionRecord {
  PK: string;          // "ORG#{orgId}"
  SK: string;          // "POSITION#{positionId}"
  positionId: string;
  orgId: string;
  title: string;
  competencyRequirements: CompetencyRequirement[];
  createdAt: string;
  updatedAt: string;
}

// ─── Token Usage Record ────────────────────────────────────────────────────────

export interface TokenUsageRecord {
  PK: string;           // "ORG#{orgId}"
  SK: string;           // "TOKENUSAGE#{YYYY-MM}"
  orgId: string;
  month: string;
  totalTokensUsed: number;
  monthlyTokenLimit: number;
  novaLiteTokensUsed: number;
  novaLiteInputTokens: number;
  novaLiteOutputTokens: number;
  cohereEmbedTokensUsed: number;
  lastUpdatedAt: string;
  breakdownByFeature: Record<string, number>;
  breakdownByModel: {
    'amazon.nova-lite-v1:0': { input: number; output: number; total: number };
    'cohere.embed-multilingual-v3': { input: number; output: number; total: number };
  };
  dailyUsage: Record<string, number>;
}

// ─── Audit Log Record ──────────────────────────────────────────────────────────

export interface AuditLogRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "AUDIT#{timestamp}#{action}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  orgId: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: string;
}
