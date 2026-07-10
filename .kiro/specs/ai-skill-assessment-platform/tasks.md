# Implementation Plan: AI Skill Assessment & Talent Development Platform

## Overview

This plan implements a serverless multi-tenant AI assessment platform using AWS Amplify Gen 2 (Next.js 14), Amazon Cognito, API Gateway, Lambda (Node.js 20.x), DynamoDB (single-table), S3, and Amazon Bedrock (Nova Lite + Cohere Embed Multilingual v3, region ap-southeast-3). Tasks are ordered for incremental progress: infrastructure → shared utilities → backend domains → frontend → integration.

## Tasks

- [x] 1. Project scaffolding and dependency setup
  - [x] 1.1 Initialize Amplify Gen 2 project with Next.js 14 (App Router)
    - Run `npx create-amplify@latest` or `npm create amplify@latest` in the workspace
    - Configure `amplify/` folder for Gen 2 backend definition
    - Install core dependencies: `@aws-amplify/ui-react`, `aws-amplify`, `@cloudscape-design/components`, `@cloudscape-design/global-styles`, `next-intl`, `swr`, `zod`
    - _Requirements: 11.1_

  - [x] 1.2 Configure Next.js App Router with i18n (next-intl)
    - Create `src/app/[locale]/layout.tsx` with Cloudscape global styles
    - Set up `next-intl` middleware for `id` and `en` locales
    - Create `messages/id.json` and `messages/en.json` skeleton files
    - Configure `i18n.ts` with locale detection and default locale (`id`)
    - _Requirements: 11.2, 11.3_

  - [x] 1.3 Set up project structure and shared TypeScript interfaces
    - Create folder structure: `src/app/[locale]/`, `src/components/`, `src/hooks/`, `src/lib/`, `amplify/functions/`, `amplify/functions/shared/`
    - Define shared TypeScript interfaces in `amplify/functions/shared/types.ts` matching the DynamoDB item schemas from the design (UserRecord, AssessmentRecord, RoleplaySessionRecord, AssignmentRecord, PositionRecord, TokenUsageRecord)
    - _Requirements: 8.1_

- [x] 2. Infrastructure definitions (Amplify Gen 2 backend)
  - [x] 2.1 Define DynamoDB table resource
    - Create `amplify/data/resource.ts` with single-table `platform-data`
    - Define PK (String), SK (String) as key schema
    - Define GSI1 (GSI1PK, GSI1SK) and GSI2 (GSI2PK, GSI2SK) global secondary indexes
    - Set billing mode to PAY_PER_REQUEST
    - _Requirements: 8.1, 8.2_

  - [x] 2.2 Define Amazon Cognito auth resource
    - Create `amplify/auth/resource.ts` with User Pool configuration
    - Add custom attributes: `custom:orgId` (string), `custom:role` (string enum: Admin|Manager|Employee)
    - Configure access token expiry (1 hour), refresh token (30 days)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.3 Define S3 storage resource
    - Create `amplify/storage/resource.ts` for document bucket
    - Configure bucket with no public access, CORS for Amplify domain
    - Add lifecycle rule: transition to IA after 30 days
    - _Requirements: 5.6, 8.3_

  - [x] 2.4 Define Lambda function resources
    - Create function definitions in `amplify/functions/` for: `assessment-handler`, `roleplay-handler`, `assignment-handler`, `promotion-handler`, `performance-handler`, `user-handler`
    - Configure timeouts (30s for most, 60s for assignment-handler, 10s for user-handler)
    - Grant IAM permissions: DynamoDB read/write, S3 read/write (scoped), Bedrock InvokeModel
    - _Requirements: 2.1, 4.1, 5.1, 6.1, 7.1, 10.1_

  - [x] 2.5 Define API Gateway REST endpoints
    - Create API definition with Cognito authorizer on all routes
    - Map all endpoints from the design (assessments, roleplay, assignments, promotion, performance, users, positions, admin)
    - Configure request throttling (100 req/s)
    - _Requirements: 1.1, 1.4_

  - [x] 2.6 Define WebSocket API for roleplay streaming
    - Create WebSocket API resource for real-time roleplay token streaming
    - Configure `$connect`, `$disconnect`, and `sendMessage` routes
    - Attach Cognito-based authorization on `$connect`
    - _Requirements: 4.2, 11.5_

- [x] 3. Checkpoint - Verify infrastructure deploys
  - Ensure all Amplify Gen 2 resource definitions compile and sandbox deploys without errors. Ask the user if questions arise.

- [x] 4. Shared utilities (backend)
  - [x] 4.1 Implement Bedrock Integration Layer
    - Create `amplify/functions/shared/bedrock-client.ts`
    - Implement `invokeModel(params)` with prompt construction (system persona + language instruction + user content)
    - Implement `invokeModelStreaming(params)` for roleplay streaming
    - Implement `checkTokenLimit(orgId, estimatedTokens)` — reads TokenUsage record from DynamoDB
    - Implement `incrementTokenUsage(orgId, actualTokensUsed, feature)` — atomic DynamoDB update
    - Implement retry logic (3 attempts, exponential backoff) for Bedrock errors
    - Model selection: `amazon.nova-lite-v1:0` for all text generation (quiz/roleplay/gap/promotion/assignment/performance), `cohere.embed-multilingual-v3` for document embedding
    - Implement organization token cap of 500,000 tokens/month (combined input+output across both models)
    - Track token usage per model (Nova Lite vs Cohere Embed) with daily granularity
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 4.2 Write property tests for Bedrock Integration Layer
    - **Property 26: Token Usage Tracking** — For any successful invocation, monthly token counter increases by actual tokens consumed
    - **Property 27: Token Limit Enforcement** — For any org at/over limit, AI invocations are rejected before calling Bedrock
    - **Property 24: Bedrock Error Response Completeness** — For any Bedrock failure, error contains human-readable message and retry suggestion
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [x] 4.3 Implement auth helper utilities
    - Create `amplify/functions/shared/auth.ts`
    - Implement `extractClaims(event)` — extracts orgId, userId, role from API Gateway event's JWT claims
    - Implement `assertRole(claims, allowedRoles)` — throws 403 if role not in allowedRoles
    - Implement `assertOrgAccess(claims, resourceOrgId)` — throws 403 if orgIds don't match
    - _Requirements: 1.1, 1.4, 1.5, 8.4_

  - [ ]* 4.4 Write property tests for auth utilities
    - **Property 1: RBAC Authorization is Consistent** — For any (role, resource, action), authorization matches the policy table exactly
    - **Property 2: Organization Data Isolation** — For any cross-org access attempt, the request is denied
    - **Property 3: User Creation Preserves Organization Context** — For any Admin creating a user, orgId matches Admin's orgId
    - **Validates: Requirements 1.2, 1.4, 1.5, 8.4**

  - [x] 4.5 Implement DynamoDB helper utilities
    - Create `amplify/functions/shared/dynamo.ts`
    - Implement `putItem(item)` with mandatory field enforcement (PK, SK, orgId, userId, timestamp)
    - Implement `queryByPK(pk, skPrefix?, limit?, lastEvaluatedKey?)` with pagination
    - Implement `queryGSI1(gsi1pk, gsi1sk?)` for manager team queries
    - Implement `queryGSI2(gsi2pk, dateRange?)` for time-based queries
    - Implement `getItem(pk, sk)` for single-record fetch
    - _Requirements: 8.1, 8.2_

  - [ ]* 4.6 Write property tests for DynamoDB helpers
    - **Property 21: DynamoDB Record Mandatory Fields** — For any write operation, the stored record must contain timestamp, userId, and orgId
    - **Property 22: S3 Key Organization Prefix** — For any document upload, S3 key starts with `org/{orgId}/`
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [x] 4.7 Implement request validation utilities
    - Create `amplify/functions/shared/validation.ts`
    - Define Zod schemas for all API request bodies (assessment generation, roleplay message, assignment upload, etc.)
    - Implement `validateRequest(event, schema)` — parses body with Zod, returns 400 on failure
    - Implement `sanitizeInput(input)` — strips injection patterns (SQL, prompt injection, script tags)
    - _Requirements: 9.5 (implied from design)_

  - [ ]* 4.8 Write property tests for validation and sanitization
    - **Property 25: API Request Validation Rejects Malformed Input** — For any request missing required fields, return 400 before business logic
    - **Property 28: Input Sanitization** — For any input with injection patterns, sanitized output does not preserve executable payload
    - **Validates: Requirements 9.5, 12.4 (design-level)_

  - [x] 4.9 Implement response formatting and error handling utilities
    - Create `amplify/functions/shared/response.ts`
    - Implement `formatResponse(statusCode, body)` with CORS headers
    - Implement `formatError(statusCode, message, suggestion?)` for consistent error responses
    - Create custom error classes: `TokenLimitExceededError`, `AuthorizationError`, `ValidationError`
    - _Requirements: 9.3, 9.4_

- [x] 5. Checkpoint - Shared utilities complete
  - Ensure all shared utilities compile and tests pass. Ask the user if questions arise.

- [x] 6. Implement user-handler Lambda
  - [x] 6.1 Implement user profile and management endpoints
    - Create `amplify/functions/user-handler/handler.ts`
    - Implement `POST /auth/profile` — get user profile from DynamoDB using JWT claims
    - Implement `GET /users` — list org users (Admin only), paginated query on GSI1
    - Implement `POST /users` — create user (Admin only), set orgId from Admin's claims, create Cognito user + DynamoDB record
    - Implement `PUT /users/{userId}` — update user role/status (Admin only)
    - _Requirements: 1.4, 10.1_

  - [x] 6.2 Implement position management endpoints
    - Implement `GET /positions` — list org positions with competency requirements
    - Implement `POST /positions` — create position (Admin only), validate competency weights sum to 1.0
    - Implement `PUT /positions/{positionId}` — update position (Admin only)
    - _Requirements: 10.2, 10.3_

  - [x] 6.3 Implement token usage dashboard endpoint
    - Implement `GET /admin/token-usage` — return monthly token usage with feature breakdown (Admin only)
    - Query TokenUsage record from DynamoDB for the current month
    - _Requirements: 10.4_

  - [x] 6.4 Implement token usage monitoring dashboard endpoints
    - Implement `GET /admin/token-usage` — return monthly token usage with per-model breakdown (Nova Lite input/output, Cohere Embed input/output) and per-feature breakdown
    - Implement `GET /admin/token-usage/daily` — return daily usage for the current month with model and feature granularity
    - Implement `GET /admin/token-usage/forecast` — calculate projected monthly usage based on daily average trend
    - Include alert thresholds: warning at 80% (400K tokens), critical at 95% (475K tokens)
    - _Requirements: 10.4, 9.1, 9.2_

  - [ ]* 6.5 Write unit tests for user-handler
    - Test user creation assigns correct orgId
    - Test position weight validation rejects non-1.0 sums
    - Test role-based access control for admin-only endpoints
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 7. Implement assessment-handler Lambda
  - [x] 7.1 Implement quiz generation endpoint
    - Create `amplify/functions/assessment-handler/handler.ts`
    - Implement `POST /assessments/generate` — construct Bedrock prompt with topic, difficulty, language; parse JSON response; validate 10-20 questions; store session in DynamoDB
    - Build prompt template requesting structured JSON output with questions array
    - _Requirements: 2.1, 2.2, 2.3, 3.5_

  - [x] 7.2 Implement quiz submission and evaluation endpoint
    - Implement `POST /assessments/submit` — evaluate answers against correct answers, compute score (0-100), generate per-question feedback via Bedrock, update competency score for the topic
    - Store result with userId, orgId, timestamp
    - _Requirements: 2.4, 2.5, 3.1_

  - [x] 7.3 Implement assessment history and gap analysis endpoints
    - Implement `GET /assessments` — query user's assessments in reverse chronological order with pagination
    - Implement `GET /assessments/{id}` — get single assessment result
    - Implement gap analysis logic: compare employee competency scores vs target position requirements, compute gap magnitude
    - Generate AI-based improvement recommendations for each gap
    - _Requirements: 2.6, 3.2, 3.3, 3.4_

  - [ ]* 7.4 Write property tests for assessment logic
    - **Property 4: Quiz Length Invariant** — For any (topic, difficulty), generated quiz has 10-20 questions
    - **Property 5: Quiz Question Format Invariant** — For any generated quiz, every question type is one of the three allowed values
    - **Property 6: Per-Question Feedback Completeness** — For any evaluation, feedback count equals question count
    - **Property 8: Skill Gap Magnitude Calculation** — For any (current, expected) where current < expected, gap = expected - current
    - **Property 9: Competency Score Coverage** — For any assessed topic, a competency score entry exists
    - **Validates: Requirements 2.1, 2.2, 2.4, 3.1, 3.3**

  - [ ]* 7.5 Write unit tests for assessment-handler
    - Test score computation with various answer combinations
    - Test pagination returns correct page sizes and ordering
    - Test language instruction injected into Bedrock prompt
    - _Requirements: 2.4, 2.5, 2.6, 3.5_

- [x] 8. Implement roleplay-handler Lambda
  - [x] 8.1 Implement roleplay session management
    - Create `amplify/functions/roleplay-handler/handler.ts`
    - Implement `POST /roleplay/start` — initialize session with scenario type, generate context description and objectives via Bedrock, store in DynamoDB with status `active`
    - Implement `GET /roleplay/{id}` — retrieve session with full message history
    - _Requirements: 4.1, 4.4_

  - [x] 8.2 Implement roleplay message handling with streaming
    - Implement `POST /roleplay/{id}/message` — append user message to history, construct Bedrock prompt with full conversation context, invoke streaming, store AI response
    - Implement WebSocket handler for real-time token streaming to client
    - Ensure all N prior messages included in context for each new turn
    - _Requirements: 4.2, 4.3, 11.5_

  - [x] 8.3 Implement roleplay session end and evaluation
    - Implement `POST /roleplay/{id}/end` — generate evaluation via Bedrock (communication score, strengths, weaknesses, recommendations), update session status to `completed`, store evaluation
    - _Requirements: 4.5, 4.6_

  - [ ]* 8.4 Write property tests for roleplay logic
    - **Property 10: Roleplay Session Initialization Completeness** — For any valid scenario type, response has non-empty scenarioContext and at least one objective
    - **Property 11: Roleplay Context Preservation** — For any session with N messages, Bedrock prompt includes all N messages in order
    - **Property 12: Roleplay Evaluation Structural Completeness** — For any completed session, evaluation has communicationScore [0-100], non-empty strengths/weaknesses/recommendations
    - **Validates: Requirements 4.1, 4.3, 4.5**

- [x] 9. Implement assignment-handler Lambda
  - [x] 9.1 Implement document upload and review endpoints
    - Create `amplify/functions/assignment-handler/handler.ts`
    - Implement `POST /assignments/upload-url` — validate file type (PDF, Word, PPT, source code, design docs), validate file size ≤ 10MB, generate presigned PUT URL (15 min expiry) with S3 key `org/{orgId}/assignments/{assignmentId}/{filename}`
    - Implement `POST /assignments/review` — trigger document review via Bedrock Sonnet, produce quality score + strengths + weaknesses + recommendations, store result
    - Implement `GET /assignments/{id}` — retrieve assignment with review result
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 9.2 Write property tests for assignment logic
    - **Property 13: File Size Validation** — For any file ≤ 10MB accepted, any file > 10MB rejected with error
    - **Property 14: Assignment Review Structural Completeness** — For any completed review, has qualityScore [0-100], non-empty strengths/weaknesses/recommendations
    - **Property 22: S3 Key Organization Prefix** — For any upload, S3 key starts with `org/{orgId}/`
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.6**

- [x] 10. Implement promotion-handler Lambda
  - [x] 10.1 Implement promotion scorecard and history endpoints
    - Create `amplify/functions/promotion-handler/handler.ts`
    - Implement `GET /promotion/{userId}` — compute readiness score (weighted competency scores vs position requirements), identify all skill gaps, generate AI career development insights, enforce Manager/Admin role access
    - Implement `GET /promotion/{userId}/history` — return competency development data ordered chronologically
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 10.2 Write property tests for promotion logic
    - **Property 15: Promotion Readiness Score Range** — For any computation, readinessScore is in [0, 100]
    - **Property 16: Promotion Gap Identification Correctness** — Gaps = exactly the competencies where employeeScore < requiredScore
    - **Property 18: Competency Timeline Ordering** — Timeline entries ordered chronologically
    - **Validates: Requirements 6.1, 6.3, 6.6**

- [x] 11. Implement performance-handler Lambda
  - [x] 11.1 Implement performance summary generation
    - Create `amplify/functions/performance-handler/handler.ts`
    - Implement `GET /performance/{userId}` — retrieve existing summary
    - Implement `POST /performance/{userId}/generate` — query assessments, roleplay evaluations, and assignment reviews within the specified time period; invoke Bedrock Sonnet to synthesize into narrative; store result
    - Enforce Manager/Admin role access, support bilingual generation
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 11.2 Write property tests for performance logic
    - **Property 19: Performance Period Filter Correctness** — For any [startDate, endDate], all compiled records have timestamps within that interval
    - **Property 20: Performance Summary Structural Completeness** — Summary has all four required sections non-empty
    - **Validates: Requirements 7.1, 7.3**

- [x] 12. Checkpoint - All backend Lambda handlers complete
  - Ensure all Lambda handlers compile, shared utilities are wired correctly, and property/unit tests pass. Ask the user if questions arise.

- [x] 13. Frontend - Auth and layout
  - [x] 13.1 Implement authentication flow
    - Configure Amplify Auth in `src/lib/auth.ts` with Cognito User Pool
    - Create login page at `src/app/[locale]/login/page.tsx` using Cloudscape Form + Input
    - Implement session management with 30-minute inactivity timeout (client-side)
    - Add language toggle on login page
    - Create `src/lib/api-client.ts` — Axios/fetch wrapper injecting `Authorization: Bearer <JWT>` on all requests
    - _Requirements: 1.1, 1.2, 1.3, 11.2_

  - [x] 13.2 Implement main layout and navigation
    - Create `src/app/[locale]/layout.tsx` with Cloudscape `AppLayout`
    - Create `src/components/Navigation.tsx` with `SideNavigation` — menu items based on user role
    - Create `src/components/TopNavigation.tsx` with user info, language switcher, logout
    - Implement role-based menu visibility (Employee/Manager/Admin items)
    - _Requirements: 1.4, 11.1, 11.2, 11.3_

- [x] 14. Frontend - Dashboard
  - [x] 14.1 Implement dashboard page
    - Create `src/app/[locale]/dashboard/page.tsx`
    - Display summary cards: last assessment score, active roleplay sessions, pending assignments
    - Recent activity feed using Cloudscape `Table`
    - Quick action buttons: "Start Assessment", "Start Roleplay", "Upload Assignment"
    - Create SWR hooks in `src/hooks/useDashboard.ts`
    - _Requirements: 11.1_

- [x] 15. Frontend - Assessment module
  - [x] 15.1 Implement assessment list and history page
    - Create `src/app/[locale]/assessments/page.tsx` with Cloudscape `Table`
    - Implement pagination, score badges, date filters
    - Create `src/hooks/useAssessments.ts` with SWR
    - _Requirements: 2.6_

  - [x] 15.2 Implement new assessment form and quiz interface
    - Create `src/app/[locale]/assessments/new/page.tsx` — topic/difficulty selector form
    - Create `src/app/[locale]/assessments/[id]/quiz/page.tsx` — question-by-question UI with Cloudscape RadioGroup, Textarea, ProgressBar
    - Show loading indicator during AI generation
    - _Requirements: 2.1, 11.4_

  - [x] 15.3 Implement assessment results page with gap analysis
    - Create `src/app/[locale]/assessments/[id]/page.tsx`
    - Display score with StatusIndicator, per-question feedback accordion
    - Show competency gap visualization with BarChart
    - Display AI-generated improvement recommendations
    - _Requirements: 2.4, 2.5, 3.2, 3.3, 3.4_

- [x] 16. Frontend - Roleplay module
  - [x] 16.1 Implement roleplay scenario selector
    - Create `src/app/[locale]/roleplay/page.tsx` with Cloudscape Cards showing 4 scenario types
    - Each card shows scenario description and objectives preview
    - _Requirements: 4.1_

  - [x] 16.2 Implement roleplay chat interface with streaming
    - Create `src/app/[locale]/roleplay/[id]/page.tsx` — chat UI with message bubbles
    - Implement WebSocket connection for real-time token streaming
    - Show loading skeleton during AI response generation
    - Display "End Session" button to trigger evaluation
    - _Requirements: 4.2, 4.3, 11.5_

  - [x] 16.3 Implement roleplay evaluation display
    - Create evaluation results view within session page
    - Display communication score gauge, tabbed strengths/weaknesses/recommendations
    - _Requirements: 4.5_

- [x] 17. Frontend - Assignment module
  - [x] 17.1 Implement assignment upload and review pages
    - Create `src/app/[locale]/assignments/page.tsx` — list of assignments with status
    - Create upload page with drag-and-drop zone + Cloudscape FileUpload
    - Implement presigned URL upload flow (get URL → upload to S3 → trigger review)
    - Show file size validation error for files > 10MB
    - Create `src/app/[locale]/assignments/[id]/page.tsx` — review results with quality score ProgressBar, expandable sections
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.4_

- [x] 18. Frontend - Promotion and Performance modules
  - [x] 18.1 Implement promotion scorecard page
    - Create `src/app/[locale]/promotion/page.tsx` — employee view (own scorecard) + manager view (team selection)
    - Display readiness score, competency radar chart (PieChart/RadialBar), skill gaps table, competency timeline LineChart
    - Show AI career development insights
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [x] 18.2 Implement performance summary page
    - Create `src/app/[locale]/performance/page.tsx` — manager view with team member selector
    - DateRangePicker for period selection
    - Display generated summary in Container with Header sections
    - "Generate Summary" button with loading state
    - Export to PDF via browser print
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 19. Frontend - Admin panel
  - [x] 19.1 Implement admin user management page
    - Create `src/app/[locale]/admin/users/page.tsx` with Cloudscape Table
    - Create/edit user modal with role selector
    - _Requirements: 10.1_

  - [x] 19.2 Implement admin position configuration page
    - Create `src/app/[locale]/admin/positions/page.tsx`
    - Position table with nested competency requirements table
    - Validate competency weights sum to 1.0 on form submission
    - _Requirements: 10.2, 10.3_

  - [x] 19.3 Implement admin token usage monitoring dashboard
    - Create `src/app/[locale]/admin/token-usage/page.tsx`
    - Overview cards: Total tokens (X / 500K), percentage used, days remaining in billing month
    - Daily consumption trend `BarChart` (last 30 days)
    - Model distribution `PieChart` (Nova Lite vs Cohere Embed with input/output breakdown)
    - Feature breakdown `BarChart` (Assessment, Roleplay, Assignment, Performance, Promotion)
    - Detailed daily log `Table` with columns: date, model, feature, input tokens, output tokens, total
    - Alert banners: Warning at 80% (400K), Critical at 95% (475K) using Cloudscape `Alert`
    - Projected monthly usage `LineChart` based on daily average forecast
    - _Requirements: 10.4, 9.1_

- [x] 20. Checkpoint - Frontend pages complete
  - Ensure all frontend pages render correctly, navigation works, and i18n switches between Indonesian and English. Ask the user if questions arise.

- [x] 21. Integration and end-to-end wiring
  - [x] 21.1 Wire frontend API calls to backend endpoints
    - Ensure all SWR hooks point to correct API Gateway URLs
    - Verify JWT token is attached to every request via api-client interceptor
    - Test auth flow: login → get token → call protected endpoint → receive data
    - _Requirements: 1.1, 1.2_

  - [x] 21.2 Implement audit logging in backend handlers
    - Add audit log writes in each handler for sensitive resource access (assessment results, performance summaries, promotion scorecards)
    - Store audit entries in DynamoDB with userId, orgId, resource, timestamp
    - _Requirements: 12.6 (design-level)_

  - [ ]* 21.3 Write property tests for audit logging and data isolation
    - **Property 29: Audit Log on Sensitive Access** — For any sensitive read, audit log entry is written with correct fields
    - **Property 23: Auth Validation Before Processing** — For any invalid JWT, request rejected with 401 before business logic
    - **Validates: Requirements 1.1, 8.4, 12.6**

  - [ ]* 21.4 Write integration tests for end-to-end flows
    - Test assessment flow: generate quiz → submit answers → view result → verify competency updated
    - Test roleplay flow: start session → send messages → end → verify evaluation stored
    - Test assignment flow: get upload URL → trigger review → verify result stored
    - Test multi-tenant isolation: user A cannot access user B's org data
    - _Requirements: 2.1-2.6, 4.1-4.6, 5.1-5.6, 8.1-8.4_

- [x] 22. Final checkpoint - Full system verification
  - Ensure all tests pass (unit, property, integration), frontend renders all pages correctly, i18n works, and role-based access is enforced. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1-29)
- The project uses TypeScript throughout (Next.js frontend + Node.js 20.x Lambda backend)
- Amazon Bedrock region: `ap-southeast-3` (Jakarta)
- Amazon Bedrock model IDs: `amazon.nova-lite-v1:0` (text generation) and `cohere.embed-multilingual-v3` (embeddings)
- Organization token cap: 500,000 tokens/month (400K Nova Lite + 100K Cohere Embed)
- WebSocket API is specifically for roleplay streaming; all other endpoints use REST
