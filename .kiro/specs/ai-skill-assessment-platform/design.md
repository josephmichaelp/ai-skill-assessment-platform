# Design Document: AI Skill Assessment & Talent Development Platform

## Overview

Platform berbasis Generative AI yang dirancang sebagai aplikasi multi-tenant serverless untuk mengevaluasi kompetensi karyawan, melakukan simulasi pembelajaran, dan mendukung pengembangan karier. Platform ini menggunakan arsitektur serverless di atas AWS dengan Amazon Bedrock (Amazon Nova Lite + Cohere Embed Multilingual v3) di region Jakarta (ap-southeast-3) sebagai AI backbone, sehingga biaya operasional dapat dijaga di bawah USD 10/bulan untuk traffic MVP.

### Design Goals

- **Cost-First**: Seluruh komponen serverless/pay-per-use, tidak ada always-on infrastructure
- **Multi-Tenant Isolation**: Setiap organisasi terisolasi penuh pada level database dan storage
- **AI-Augmented**: Amazon Bedrock digunakan untuk quiz generation, roleplay, document review, dan performance insights
- **Bilingual**: Mendukung Bahasa Indonesia dan English di seluruh UI dan konten AI-generated
- **Developer Experience**: Single-table DynamoDB design, modular Lambda functions per domain

---

## Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER                                       │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  Next.js (App Router) + Cloudscape Design System                   │     │
│   │  Deployed on AWS Amplify Hosting (CDN + CI/CD)                     │     │
│   └───────────────────────────┬────────────────────────────────────────┘     │
└───────────────────────────────│─────────────────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                           AUTH LAYER                                          │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  Amazon Cognito User Pool                                          │     │
│   │  - Multi-tenant (custom attributes: orgId, role)                   │     │
│   │  - JWT tokens (access + refresh)                                   │     │
│   │  - 30-minute session inactivity timeout                            │     │
│   └───────────────────────────┬────────────────────────────────────────┘     │
└───────────────────────────────│─────────────────────────────────────────────┘
                                │ JWT Authorization
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                            API LAYER                                          │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  AWS API Gateway (REST API)                                        │     │
│   │  - Cognito Authorizer on all endpoints                             │     │
│   │  - Request validation & throttling                                 │     │
│   │  - WebSocket API for roleplay streaming                            │     │
│   └───────────────────────────┬────────────────────────────────────────┘     │
└───────────────────────────────│─────────────────────────────────────────────┘
                                │ Invoke
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                         COMPUTE LAYER (Lambda)                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │  assessment  │ │   roleplay   │ │  assignment  │ │  promotion   │       │
│  │   -handler   │ │   -handler   │ │   -handler   │ │   -handler   │       │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘       │
│  ┌──────┴───────┐ ┌──────┴───────┐                                          │
│  │ performance  │ │    user      │                                           │
│  │   -handler   │ │   -handler   │                                           │
│  └──────┬───────┘ └──────┬───────┘                                          │
│         └────────────────┴─────────────────────────────────────┐            │
│                   ┌────────────────────────────────────┐        │            │
│                   │   Bedrock Integration Layer        │◄───────┘            │
│                   │  (shared utility: prompt builder,  │                     │
│                   │   model invoker, token tracker)    │                     │
│                   └────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                      │                    │
          ┌─────────▼──────┐    ┌──────────▼──────┐  ┌────────▼────────┐
          │  Amazon         │    │  Amazon S3       │  │  Amazon         │
          │  DynamoDB       │    │  (documents +    │  │  Bedrock        │
          │  (single-table) │    │   org-prefixed)  │  │  (Nova Lite +   │
          └─────────────────┘    └─────────────────┘  │  Cohere Embed)  │
                                                       └─────────────────┘
```

### Data Flow: Assessment Generation

```
Employee → API GW → assessment-handler → Bedrock Integration Layer
                                              │
                                    Nova Lite (quiz gen)
                                              │
                                    assessment-handler ← quiz JSON
                                              │
                                    DynamoDB (store session)
                                              │
Employee ← API GW ← assessment-handler ← quiz response
```

### Data Flow: Roleplay (Streaming)

```
Employee ↔ API GW (WebSocket) ↔ roleplay-handler → Bedrock Streaming
                                        │
                                  DynamoDB (message history)
                                        │
Employee ← streamed tokens ← API GW ← roleplay-handler ← Nova Lite
```

### Data Flow: Document Embedding (Semantic Search)

```
Document Upload → S3 → assignment-handler → Bedrock Integration Layer
                                                  │
                                        Cohere Embed Multilingual v3
                                                  │
                                        Vector embedding (1024 dims)
                                                  │
                                        DynamoDB / future OpenSearch
```

---

## Components and Interfaces

### 1. Frontend SPA (Next.js + Cloudscape)

**Technology**: Next.js 14 (App Router), AWS Cloudscape Design System, next-intl (i18n)

**Responsibilities**:
- Render all UI screens using Cloudscape components
- Manage authentication state via Amplify Auth (Cognito)
- Cache API responses via SWR
- Handle streaming roleplay responses via ReadableStream API
- i18n rendering (id/en) using next-intl

**Key Modules**:
```
src/
  app/
    [locale]/
      dashboard/
      assessments/
      roleplay/
      assignments/
      promotion/
      performance/
      admin/
  components/       # Shared Cloudscape wrappers
  hooks/            # SWR-based API hooks
  lib/
    api-client.ts   # Axios/fetch wrapper with auth headers
    auth.ts         # Amplify Auth helpers
    i18n.ts         # next-intl config
```

**Interface to Backend**: REST API calls with `Authorization: Bearer <JWT>` header on every request. Streaming responses via WebSocket for roleplay.

---

### 2. Auth Layer (Amazon Cognito)

**Technology**: Amazon Cognito User Pool, configured via AWS Amplify Gen 2

**Configuration**:
- User Pool with custom attributes: `custom:orgId` (string), `custom:role` (enum: Admin | Manager | Employee)
- App Client with Hosted UI (optional) or custom login form
- JWT token: 1-hour access token, 30-day refresh token
- Session inactivity: 30-minute idle timeout enforced client-side via Amplify Auth timeout configuration

**Multi-Tenant Pattern**:
- Every user has `custom:orgId` set at creation time by an Admin
- Every Lambda extracts `orgId` from the verified JWT claims — no client-provided orgId is trusted
- All DynamoDB queries are scoped to `ORG#{orgId}` partition key prefix

**RBAC Policy**:

| Role     | Can Access                                                                 |
|----------|---------------------------------------------------------------------------|
| Employee | Dashboard, own Assessments, Roleplay, Assignment upload, own Promotion, own Performance |
| Manager  | All Employee access + team Promotion Scorecards + team Performance Summaries |
| Admin    | All Manager access + User Management + Position Config + Token Usage dashboard |

---

### 3. API Gateway (REST + WebSocket)

**Technology**: AWS API Gateway v1 (REST API)

**Security**:
- Cognito Authorizer on all REST endpoints (validates JWT, extracts claims)
- CORS configured for Amplify Hosting domain
- Request throttling: 100 req/s per stage (prevents cost overrun from Bedrock calls)
- Request validators for all POST/PUT endpoints

**API Endpoints**:

```
# Authentication / User Context
POST   /auth/profile              → user-handler: get profile + org context

# Assessments
GET    /assessments               → assessment-handler: list history (paginated, max 100)
POST   /assessments/generate      → assessment-handler: generate new quiz
POST   /assessments/submit        → assessment-handler: submit answers + evaluate
GET    /assessments/{id}          → assessment-handler: get result

# Roleplay
POST   /roleplay/start            → roleplay-handler: initiate session
POST   /roleplay/{id}/message     → roleplay-handler: send message
POST   /roleplay/{id}/end         → roleplay-handler: end + evaluate
GET    /roleplay/{id}             → roleplay-handler: get session + history

# Assignment Review
POST   /assignments/upload-url    → assignment-handler: get presigned S3 URL
POST   /assignments/review        → assignment-handler: trigger review
GET    /assignments/{id}          → assignment-handler: get review result

# Promotion
GET    /promotion/{userId}        → promotion-handler: get scorecard
GET    /promotion/{userId}/history → promotion-handler: get timeline

# Performance
GET    /performance/{userId}      → performance-handler: get/generate summary
POST   /performance/{userId}/generate → performance-handler: trigger generation

# Admin: Users
GET    /users                     → user-handler: list org users
POST   /users                     → user-handler: create user
PUT    /users/{userId}            → user-handler: update user role/status

# Admin: Positions
GET    /positions                 → user-handler: list positions + competencies
POST   /positions                 → user-handler: create position
PUT    /positions/{positionId}    → user-handler: update position

# Admin: Token Usage
GET    /admin/token-usage         → user-handler: monthly token stats
GET    /admin/token-usage/daily   → user-handler: daily usage breakdown with model details
GET    /admin/token-usage/forecast → user-handler: projected monthly usage based on trend
```

---

### 4. Lambda Functions (Node.js 20.x)

Each Lambda function handles a specific domain. They share a common pattern:

```typescript
// Common Lambda handler pattern
export const handler = async (event: APIGatewayProxyEvent) => {
  // 1. Extract & verify JWT claims (orgId, userId, role)
  const claims = extractClaims(event);
  
  // 2. Validate request body/params
  const validated = validateRequest(event, schema);
  
  // 3. Business logic (DynamoDB + Bedrock calls)
  const result = await processDomain(validated, claims);
  
  // 4. Audit log sensitive access
  await auditLog(claims, event.path, 'READ' | 'WRITE');
  
  // 5. Return response
  return formatResponse(result);
};
```

**Lambda Functions**:

| Function | Trigger | Bedrock Model | Timeout |
|---|---|---|---|
| `assessment-handler` | API Gateway | Nova Lite | 30s |
| `roleplay-handler` | API Gateway | Nova Lite | 30s |
| `assignment-handler` | API Gateway | Nova Lite + Cohere Embed | 60s |
| `promotion-handler` | API Gateway | Nova Lite | 30s |
| `performance-handler` | API Gateway | Nova Lite | 30s |
| `user-handler` | API Gateway | None | 10s |

---

### 5. Bedrock Integration Layer (Shared Utility)

**File**: `src/shared/bedrock-client.ts`

**Responsibilities**:
- Construct prompts with system persona + language instruction + few-shot examples
- Invoke Bedrock models (invoke or streaming)
- Track token usage per org per month in DynamoDB
- Enforce token limits (check before invoke, increment after)
- Handle Bedrock errors with retry (3 attempts, exponential backoff)

**Region**: `ap-southeast-3` (Jakarta)

**Model Selection**:
- `amazon.nova-lite-v1:0` — All text generation tasks: quiz generation, roleplay, assignment review, gap analysis, performance summary, promotion insights. Context window: 300K tokens. Max output: 5K tokens. Supports 200+ languages including Indonesian.
- `cohere.embed-multilingual-v3` — Text embedding for semantic search and document similarity. Supports 100+ languages including Indonesian. Output: 1024-dimension vectors. Context window: 512 tokens per chunk.

**Cost Rationale**: Nova Lite is Amazon's lowest-cost multimodal model, ideal for MVP. Combined with Cohere Embed for embedding tasks, the total token usage is capped well below the 1M tier pricing threshold.

**Token Tracking Flow**:
```
checkTokenLimit(orgId, estimatedTokens)
  → IF over limit: throw TokenLimitExceededError
  → ELSE: invoke Bedrock
  → incrementTokenUsage(orgId, actualTokensUsed)
```

**Organization Token Cap**:
- **Monthly limit per organization**: 500,000 tokens (combined input + output, across both Nova Lite and Cohere Embed)
- **Rationale**: Keeps total usage well under the 1M token pricing tier to minimize costs
- **Enforcement**: Token check runs BEFORE every Bedrock invocation; if remaining budget < estimated tokens needed, the request is rejected
- **Tracking granularity**: Per model (Nova Lite vs Cohere Embed), per feature, per day, per month

**Token Budget Breakdown (recommended defaults)**:

| Model | Allocated Tokens/Month | Purpose |
|---|---|---|
| Nova Lite (generation) | 400,000 | Quiz, roleplay, review, summary, promotion |
| Cohere Embed (embedding) | 100,000 | Document embedding, semantic search |
| **Total** | **500,000** | Combined cap per org |

**Prompt Template Structure**:
```
System: [Role persona in target language]
       [Output format instruction (JSON schema)]
       [Language instruction: "Respond in Bahasa Indonesia" or "Respond in English"]
       
Human: [User context / conversation history]
       [Specific task instruction]

```

**Max Token Limits per Feature**:

| Feature | Max Input Tokens | Max Output Tokens |
|---|---|---|
| Quiz Generation | 800 | 1000 |
| Roleplay Turn | 2000 | 500 |
| Assignment Review | 4000 | 2000 |
| Performance Summary | 3000 | 1500 |
| Gap Analysis Recommendations | 600 | 800 |
| Promotion Insights | 1500 | 1000 |

---

## Data Models

### DynamoDB Single-Table Design

**Table Name**: `platform-data`

**Key Schema**: `PK` (String, Partition Key), `SK` (String, Sort Key)

**Global Secondary Indexes**:
- **GSI1**: `GSI1PK` (orgId), `GSI1SK` (userId) — for manager views of team data
- **GSI2**: `GSI2PK` (orgId), `GSI2SK` (createdAt ISO string) — for time-based queries

---

#### Access Patterns → Key Design

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| User | `ORG#{orgId}` | `USER#{userId}` | `{orgId}` | `USER#{userId}` |
| Assessment Result | `ORG#{orgId}#USER#{userId}` | `ASSESSMENT#{timestamp}#{id}` | `{orgId}` | `{userId}` |
| Roleplay Session | `ORG#{orgId}#USER#{userId}` | `ROLEPLAY#{sessionId}` | `{orgId}` | `{userId}` |
| Assignment Review | `ORG#{orgId}#USER#{userId}` | `ASSIGNMENT#{assignmentId}` | `{orgId}` | `{userId}` |
| Position Config | `ORG#{orgId}` | `POSITION#{positionId}` | — | — |
| Token Usage | `ORG#{orgId}` | `TOKENUSAGE#{YYYY-MM}` | — | — |
| Audit Log | `ORG#{orgId}#USER#{userId}` | `AUDIT#{timestamp}#{action}` | `{orgId}` | `{userId}` |

---

#### Item Schemas (TypeScript interfaces)

```typescript
// User record
interface UserRecord {
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

// Assessment Result record
interface AssessmentRecord {
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

// Question sub-type
interface Question {
  questionId: string;
  text: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  options?: string[];  // for multiple_choice
  correctAnswer: string;
}

// Answer sub-type
interface Answer {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
}

// Per-question feedback
interface QuestionFeedback {
  questionId: string;
  explanation: string;
  correctAnswer: string;
}

// Roleplay Session record
interface RoleplaySessionRecord {
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

// Roleplay message sub-type
interface RoleplayMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Roleplay evaluation sub-type
interface RoleplayEvaluation {
  communicationScore: number;   // 0-100
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallFeedback: string;
}

// Assignment Review record
interface AssignmentRecord {
  PK: string;          // "ORG#{orgId}#USER#{userId}"
  SK: string;          // "ASSIGNMENT#{assignmentId}"
  GSI1PK: string;      // "{orgId}"
  GSI1SK: string;      // "{userId}"
  assignmentId: string;
  orgId: string;
  userId: string;
  s3Key: string;       // "org/{orgId}/assignments/{assignmentId}/{filename}"
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  review?: AssignmentReview;
  createdAt: string;
  completedAt?: string;
}

// Assignment review sub-type
interface AssignmentReview {
  qualityScore: number;      // 0-100
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  plagiarismScore?: number;  // 0-100, if enabled for org
}

// Position Config record
interface PositionRecord {
  PK: string;          // "ORG#{orgId}"
  SK: string;          // "POSITION#{positionId}"
  positionId: string;
  orgId: string;
  title: string;
  competencyRequirements: CompetencyRequirement[];
  createdAt: string;
  updatedAt: string;
}

// Competency requirement sub-type
interface CompetencyRequirement {
  topic: string;
  requiredScore: number;  // 0-100
  weight: number;         // 0-1, sum of all weights = 1
}

// Token Usage record (enhanced with per-model tracking)
interface TokenUsageRecord {
  PK: string;           // "ORG#{orgId}"
  SK: string;           // "TOKENUSAGE#{YYYY-MM}"
  orgId: string;
  month: string;        // "YYYY-MM"
  totalTokensUsed: number;
  monthlyTokenLimit: number;  // default: 500000
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
  dailyUsage: Record<string, number>;  // "YYYY-MM-DD" → tokens used that day
}
```

---

### S3 Storage Structure

**Bucket**: `platform-documents-{accountId}`

**Key Pattern**: `org/{orgId}/assignments/{assignmentId}/{filename}`

**Example**: `org/acme-corp/assignments/asgn-123/report.pdf`

**Bucket Policy**: All access via presigned URLs only (no public access). Lambda IAM role has `s3:GetObject` and `s3:PutObject` scoped to `org/${orgId}/*`.

**Presigned URL Config**:
- Upload URL: expires in 15 minutes (`PutObject`)
- Download URL: expires in 15 minutes (`GetObject`)

**Lifecycle Policy**:
- Transition to S3 Infrequent Access after 30 days
- No automatic deletion (documents retained indefinitely)

---

## Frontend Design

### Pages and Components

#### 1. Login Page
- Cognito Hosted UI or custom form using Cloudscape `Form` + `Input`
- Redirects to `/dashboard` after successful auth
- Supports language toggle (id/en) before login

#### 2. Dashboard
- Cloudscape `AppLayout` with `SideNavigation`
- Summary cards: last assessment score, active roleplay sessions, pending assignments
- Recent activity feed using `Table` component
- Quick action buttons: "Start Assessment", "Start Roleplay", "Upload Assignment"

#### 3. Assessment Module
- **List page**: Cloudscape `Table` with pagination, score badges, date filters
- **New Assessment**: Cloudscape `Form` with `Select` (topic, difficulty) → triggers generation
- **Quiz page**: Question-by-question with `ProgressBar` timer, `RadioGroup` for MC, `Textarea` for short answer
- **Results page**: Score `StatusIndicator`, per-question accordion with feedback, `BarChart` for competency scores

#### 4. Roleplay Module
- **Scenario Selector**: Cloudscape `Cards` showing 4 scenario types with descriptions
- **Chat Interface**: Custom streaming UI with message bubbles, loading skeleton during AI response
- **Evaluation page**: Score `Gauge` (Cloudscape), tabbed strengths/weaknesses/recommendations

#### 5. Assignment Review Module
- **Upload page**: Drag-and-drop zone (custom component) + Cloudscape `FileUpload`
- **Review Result page**: Quality score `ProgressBar`, expandable `ExpandableSection` for strengths/weaknesses

#### 6. Promotion Scorecard
- Employee `Header` with readiness score as large number + status badge
- `PieChart` or `RadialBarChart` for competency radar
- Skill gaps `Table` with magnitude indicators
- `LineChart` for competency timeline

#### 7. Performance Summary
- Period selector: Cloudscape `DateRangePicker`
- Generated summary in `Container` with `Header` sections
- Export to PDF button (client-side via browser print)

#### 8. Admin Panel
- **User Management**: `Table` with create/edit actions, `Modal` for user form
- **Position Config**: `Table` for positions, nested `Table` for competency requirements
- **Token Usage Monitoring Dashboard**:
  - Overview cards: Total tokens used / 500K limit, percentage consumed, days remaining in month
  - `BarChart`: Daily token consumption trend (last 30 days)
  - `PieChart`: Token distribution by model (Nova Lite vs Cohere Embed)
  - `BarChart`: Token usage breakdown by feature (Assessment, Roleplay, Assignment, Performance, Promotion)
  - `Table`: Detailed daily log with model, feature, input tokens, output tokens, total
  - `Alert` banner: Warning at 80% usage (400K), critical at 95% (475K)
  - `StatusIndicator`: Real-time remaining budget display
  - Projected monthly usage based on daily average with `LineChart` forecast

### i18n Strategy

```typescript
// next-intl config
// messages/id.json and messages/en.json
// All UI strings externalized
// Language stored in user profile (DynamoDB) + persisted to localStorage
// Language injection in every Bedrock prompt via languageInstruction field
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The platform's core logic contains several pure functions (RBAC authorization, competency gap calculation, token limit enforcement, input validation, data partitioning) that are well-suited to property-based testing. Infrastructure concerns (Cognito, DynamoDB latency, S3, Bedrock availability) are handled via integration and smoke tests.

### Property 1: RBAC Authorization is Consistent

*For any* (role, resource, action) triple, the authorization decision must exactly match the RBAC policy table — no role can access a resource beyond its defined permission set, and no role is denied a resource it is permitted to access.

**Validates: Requirements 1.2**

---

### Property 2: Organization Data Isolation

*For any* authenticated user and *any* DynamoDB record belonging to a different organization, the platform must never return that cross-organization record in any query response. The partition key for every read and write must contain the requesting user's own orgId.

**Validates: Requirements 1.3, 8.1**

---

### Property 3: User Creation Preserves Organization Context

*For any* Admin user creating a new user account, the created user's `orgId` must equal the Admin's `orgId`. No user can be assigned to an organization other than the creating Admin's organization.

**Validates: Requirements 1.4**

---

### Property 4: Quiz Length Invariant

*For any* valid (competency topic, difficulty level) pair passed to the Assessment Engine, the generated quiz must contain between 10 and 20 questions, inclusive.

**Validates: Requirements 2.1**

---

### Property 5: Quiz Question Format Invariant

*For any* generated quiz, every question's `type` field must be one of the three allowed values: `multiple_choice`, `true_false`, or `short_answer`. No question may have an absent or unrecognized type.

**Validates: Requirements 2.2**

---

### Property 6: Per-Question Feedback Completeness

*For any* quiz evaluation result, the number of feedback entries must equal the number of questions in the quiz. Every question must have a corresponding feedback entry — no question may be left without feedback.

**Validates: Requirements 2.4**

---

### Property 7: Assessment History Round-Trip

*For any* completed quiz evaluation (with score, answers, and timestamp), after storing the result to DynamoDB, querying the employee's assessment history must return a record that contains the same score, answer set, and timestamp.

**Validates: Requirements 2.5, 8.2**

---

### Property 8: Skill Gap Magnitude Calculation

*For any* (current_score, expected_score) pair where `current_score < expected_score`, the computed skill gap magnitude must equal exactly `expected_score - current_score`. The gap is never negative and never exceeds 100.

**Validates: Requirements 3.3**

---

### Property 9: Competency Score Coverage

*For any* non-empty set of assessments for a given competency topic, a competency score entry must exist for that topic in the employee's competency profile. No assessed topic may be absent from the profile.

**Validates: Requirements 3.1**

---

### Property 10: Roleplay Session Initialization Completeness

*For any* valid scenario type (`Customer`, `Interviewer`, `Manager`, `DifficultCustomer`), the session initialization response must contain a non-empty `scenarioContext` string and at least one non-empty `objectives` entry.

**Validates: Requirements 4.1, 4.7**

---

### Property 11: Roleplay Context Preservation

*For any* active roleplay session with N prior messages, the Bedrock prompt constructed for the next turn must include all N prior messages in the correct chronological order. No message may be silently dropped from context.

**Validates: Requirements 4.3**

---

### Property 12: Roleplay Evaluation Structural Completeness

*For any* completed roleplay session evaluation, all four required fields must be present and non-empty: `communicationScore` (a number in [0, 100]), `strengths` (non-empty array), `weaknesses` (non-empty array), and `recommendations` (non-empty array).

**Validates: Requirements 4.5**

---

### Property 13: File Size Validation

*For any* document upload where `fileSizeBytes <= 10,485,760` (10 MB), the upload must be accepted. *For any* document upload where `fileSizeBytes > 10,485,760`, the upload must be rejected with an error response indicating the size constraint.

**Validates: Requirements 5.1, 5.5**

---

### Property 14: Assignment Review Structural Completeness

*For any* completed assignment review, the result must contain: `qualityScore` in [0, 100], a non-empty `strengths` array, a non-empty `weaknesses` array, and a non-empty `recommendations` array.

**Validates: Requirements 5.4**

---

### Property 15: Promotion Readiness Score Range

*For any* employee competency data and target position requirements passed to the Promotion Scorecard, the computed `readinessScore` must be in the range [0, 100].

**Validates: Requirements 6.1**

---

### Property 16: Promotion Gap Identification Correctness

*For any* employee competency profile compared against position requirements, the set of identified skill gaps must equal exactly the set of competencies where `employeeScore < requiredScore`. No competency where `employeeScore >= requiredScore` should appear as a gap.

**Validates: Requirements 6.3**

---

### Property 17: Competency Score Update After New Assessment

*For any* new assessment result for a specific competency topic, after the result is stored, querying the employee's competency scores must return a score for that topic that reflects the new assessment. The competency tracking data must not retain only stale scores.

**Validates: Requirements 6.5**

---

### Property 18: Competency Timeline Ordering

*For any* employee with N completed assessments, the competency development timeline must contain N entries and must be ordered chronologically (each entry's `createdAt` must be ≥ the previous entry's `createdAt`).

**Validates: Requirements 6.6**

---

### Property 19: Performance Period Filter Correctness

*For any* specified time period [startDate, endDate], all records compiled by the Performance Summary Generator must have timestamps within the interval [startDate, endDate]. No record outside the specified period may be included.

**Validates: Requirements 7.1**

---

### Property 20: Performance Summary Structural Completeness

*For any* generated performance summary, all four required sections must be present and non-empty: overall performance highlights, key achievements, areas for improvement, and competency development recommendations.

**Validates: Requirements 7.3**

---

### Property 21: DynamoDB Record Mandatory Fields

*For any* write operation to DynamoDB, the stored record must contain all three mandatory fields: `timestamp` (valid ISO 8601 string), `userId` (non-empty string), and `orgId` (non-empty string).

**Validates: Requirements 8.2**

---

### Property 22: S3 Key Organization Prefix

*For any* document upload, the generated S3 key must start with `org/{orgId}/`. No document may be stored under a key that does not begin with the organization prefix.

**Validates: Requirements 8.4**

---

### Property 23: Auth Validation Before Processing

*For any* API request with an invalid, missing, or expired JWT token, the platform must reject the request with a 401 response before any business logic executes. No business logic may run without successful auth validation.

**Validates: Requirements 9.2**

---

### Property 24: Bedrock Error Response Completeness

*For any* Bedrock API failure (timeout, throttle, service error), the platform must return an error response containing a non-empty human-readable message and a suggestion to retry the operation.

**Validates: Requirements 9.5**

---

### Property 25: API Request Validation Rejects Malformed Input

*For any* API request missing one or more required fields (as defined by the endpoint's request schema), the platform must return a 400 error response before business logic executes.

**Validates: Requirements 9.6**

---

### Property 26: Token Usage Tracking

*For any* successful Bedrock invocation, the organization's monthly token counter in DynamoDB must increase by the number of tokens actually consumed in that invocation.

**Validates: Requirements 11.3**

---

### Property 27: Token Limit Enforcement

*For any* organization where monthly token usage has reached or exceeded the configured monthly token limit, any AI feature invocation must be rejected with a `TOKEN_LIMIT_EXCEEDED` error before invoking Bedrock.

**Validates: Requirements 11.5**

---

### Property 28: Input Sanitization

*For any* user-provided string input containing common injection patterns (SQL injection fragments, prompt injection sequences like "ignore previous instructions", HTML script tags), the sanitized output must not preserve the injection payload in a form that could execute or alter system behavior.

**Validates: Requirements 12.4**

---

### Property 29: Audit Log on Sensitive Access

*For any* successful read of assessment results, performance summaries, or promotion scorecards, an audit log entry must be written to DynamoDB containing the `userId`, `orgId`, resource accessed, and `timestamp`.

**Validates: Requirements 12.6**

---
