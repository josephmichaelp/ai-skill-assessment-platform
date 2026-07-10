# Requirements Document

## Introduction

An AI-powered platform that helps organizations evaluate employee competencies, identify skill gaps through interactive learning simulations, and support career development through AI-based evaluation and insights. The platform leverages Amazon Bedrock (Amazon Nova Lite for text generation + Cohere Embed Multilingual v3 for embeddings) in region Jakarta (ap-southeast-3) for generating assessments, conducting roleplay simulations, evaluating assignments, and providing competency development recommendations. Built on a serverless AWS architecture targeting less than USD 10/month for MVP/demo traffic.

## Glossary

- **Platform**: The AI Skill Assessment & Talent Development Platform application as a whole
- **Assessment_Engine**: The component responsible for generating quizzes, evaluating answers, and computing competency scores
- **Roleplay_Simulator**: The component responsible for conducting interactive AI-based conversation simulations
- **Assignment_Reviewer**: The component responsible for evaluating uploaded documents and providing AI-based review feedback
- **Promotion_Evaluator**: The component responsible for computing promotion readiness scores and identifying skill gaps
- **Performance_Generator**: The component responsible for auto-generating employee performance summaries
- **Auth_System**: The authentication and authorization layer based on Amazon Cognito
- **Data_Store**: The DynamoDB single-table data persistence layer
- **Document_Store**: The Amazon S3 storage layer for uploaded documents
- **Bedrock_Client**: The shared integration layer for invoking Amazon Bedrock AI models
- **Admin**: A user with administrative privileges for an organization (user management, position configuration, token usage monitoring)
- **Manager**: A user who can view team members' promotion scorecards and performance summaries
- **Employee**: A standard user who can take assessments, participate in roleplay, upload assignments, and view own results
- **Organization**: A tenant entity representing a company or team using the platform
- **Competency_Topic**: A specific skill or knowledge area being assessed (e.g., "Leadership", "Java Programming")
- **Skill_Gap**: The difference between an employee's current competency score and the required score for a target position
- **Readiness_Score**: A numeric value (0-100) indicating how prepared an employee is for promotion to a target position

## Requirements

### Requirement 1: User Authentication and Authorization

**User Story:** As an organization administrator, I want to manage user access with role-based permissions, so that employees can only access features appropriate to their role.

#### Acceptance Criteria

1. WHEN a user attempts to access the Platform without a valid authentication token, THE Auth_System SHALL reject the request with a 401 Unauthorized response before any business logic executes
2. WHEN a user authenticates successfully, THE Auth_System SHALL issue a JWT token containing the user's orgId, userId, and role claims
3. WHILE a user session has been inactive for more than 30 minutes, THE Auth_System SHALL invalidate the session and require re-authentication
4. THE Auth_System SHALL enforce role-based access control where Employee users can access only their own data, Manager users can access their team's promotion scorecards and performance summaries, and Admin users can access user management and platform configuration
5. IF a user attempts to access a resource belonging to a different organization, THEN THE Auth_System SHALL deny the request and return a 403 Forbidden response

### Requirement 2: AI Quiz Assessment Generation

**User Story:** As an employee, I want to take AI-generated quizzes on specific competency topics, so that I can evaluate my current skill level.

#### Acceptance Criteria

1. WHEN an employee requests a new assessment with a valid competency topic and difficulty level, THE Assessment_Engine SHALL generate a quiz containing between 10 and 20 questions
2. THE Assessment_Engine SHALL generate questions of type multiple_choice, true_false, or short_answer only
3. WHEN a quiz is generated, THE Assessment_Engine SHALL include a correct answer for each question
4. WHEN an employee submits quiz answers, THE Assessment_Engine SHALL evaluate each answer and provide per-question feedback containing an explanation and the correct answer
5. WHEN a quiz evaluation is complete, THE Assessment_Engine SHALL compute a score between 0 and 100 and store the result with the employee's userId, orgId, and a timestamp
6. WHEN an employee requests assessment history, THE Assessment_Engine SHALL return all previous assessment results for that employee in reverse chronological order with pagination support

### Requirement 3: Competency Gap Analysis

**User Story:** As an employee, I want to understand my skill gaps relative to my target position, so that I can focus my development efforts effectively.

#### Acceptance Criteria

1. WHEN an employee completes an assessment for a competency topic, THE Assessment_Engine SHALL update the employee's competency score for that topic
2. WHEN an employee has a target position assigned, THE Assessment_Engine SHALL compare the employee's competency scores against the position's required scores
3. WHEN an employee's competency score for a topic is below the required score for their target position, THE Assessment_Engine SHALL identify that topic as a skill gap with a magnitude equal to the difference between required and current scores
4. WHEN skill gaps are identified, THE Assessment_Engine SHALL generate AI-based improvement recommendations for each gap area using Amazon Bedrock
5. THE Assessment_Engine SHALL support assessment generation and feedback in both Indonesian and English based on the user's language preference

### Requirement 4: AI Roleplay Simulation

**User Story:** As an employee, I want to practice communication and decision-making through AI-powered roleplay scenarios, so that I can develop my soft skills in a safe environment.

#### Acceptance Criteria

1. WHEN an employee selects a scenario type (Customer, Interviewer, Manager, or DifficultCustomer), THE Roleplay_Simulator SHALL initialize a session with a scenario context description and at least one objective
2. WHEN an employee sends a message during an active roleplay session, THE Roleplay_Simulator SHALL stream an AI response in real-time using Amazon Bedrock streaming
3. WHILE a roleplay session is active, THE Roleplay_Simulator SHALL maintain the complete message history and include all prior messages in the context for each new AI response
4. THE Roleplay_Simulator SHALL support roleplay conversations in both Indonesian and English based on the user's language preference
5. WHEN an employee ends a roleplay session, THE Roleplay_Simulator SHALL generate an evaluation containing a communication score (0-100), strengths list, weaknesses list, and recommendations list
6. WHEN a roleplay evaluation is complete, THE Roleplay_Simulator SHALL store the session with all messages and evaluation results in the Data_Store

### Requirement 5: AI Assignment Review

**User Story:** As an employee, I want to upload my work documents for AI-based review, so that I can receive objective feedback on the quality of my deliverables.

#### Acceptance Criteria

1. WHEN an employee requests an upload URL, THE Assignment_Reviewer SHALL generate a presigned S3 URL valid for 15 minutes for the specified file
2. THE Assignment_Reviewer SHALL accept documents in PDF, Microsoft Word, PowerPoint, source code, and design document formats
3. WHEN a document is uploaded with a file size exceeding 10 MB, THE Assignment_Reviewer SHALL reject the upload and return an error indicating the size constraint
4. WHEN a document review is triggered, THE Assignment_Reviewer SHALL analyze the document using Amazon Bedrock and produce a review containing a quality score (0-100), strengths list, weaknesses list, and improvement recommendations
5. WHEN a document review is complete, THE Assignment_Reviewer SHALL store the review result with the assignment record in the Data_Store
6. THE Assignment_Reviewer SHALL store all uploaded documents under the S3 key prefix org/{orgId}/ to maintain organization-level data isolation

### Requirement 6: AI Promotion Readiness Scorecard

**User Story:** As a manager, I want to view an employee's promotion readiness based on their assessment history and competencies, so that I can make informed promotion decisions.

#### Acceptance Criteria

1. WHEN a promotion scorecard is requested for an employee with a target position, THE Promotion_Evaluator SHALL compute a readiness score between 0 and 100
2. THE Promotion_Evaluator SHALL calculate the readiness score based on the employee's competency scores weighted against the target position's competency requirements
3. WHEN computing the promotion scorecard, THE Promotion_Evaluator SHALL identify all competencies where the employee's score is below the required score as skill gaps
4. WHEN skill gaps are identified, THE Promotion_Evaluator SHALL generate AI-based career development insights and recommendations using Amazon Bedrock
5. WHEN an employee completes a new assessment, THE Promotion_Evaluator SHALL reflect the updated competency score in subsequent scorecard calculations
6. WHEN a promotion scorecard history is requested, THE Promotion_Evaluator SHALL return competency development data ordered chronologically

### Requirement 7: AI Performance Summary Generation

**User Story:** As a manager, I want to auto-generate performance summaries for my team members, so that I can prepare for evaluation discussions efficiently.

#### Acceptance Criteria

1. WHEN a performance summary is requested for a specific time period, THE Performance_Generator SHALL compile only assessment results, roleplay evaluations, and assignment reviews within that period
2. THE Performance_Generator SHALL generate a summary containing overall performance highlights, key achievements, areas for improvement, and competency development recommendations
3. WHEN generating a performance summary, THE Performance_Generator SHALL use Amazon Bedrock to synthesize data into a human-readable narrative
4. THE Performance_Generator SHALL support summary generation in both Indonesian and English based on the requesting user's language preference

### Requirement 8: Multi-Tenant Data Isolation

**User Story:** As an organization administrator, I want assurance that our employee data is completely isolated from other organizations, so that sensitive assessment and performance data remains private.

#### Acceptance Criteria

1. THE Data_Store SHALL partition all records using the organization identifier as part of the primary key prefix
2. WHEN any data query is executed, THE Platform SHALL scope the query to the requesting user's organization by extracting the orgId from the verified JWT token
3. THE Document_Store SHALL organize all uploaded files under an organization-specific S3 key prefix
4. IF a Lambda function receives a request where the resource's orgId does not match the requesting user's orgId, THEN THE Platform SHALL deny the request and return a 403 Forbidden response

### Requirement 9: Bedrock Integration and Cost Management

**User Story:** As an organization administrator, I want to monitor and control AI usage costs, so that the platform remains within the target budget.

#### Acceptance Criteria

1. WHEN an AI operation is invoked, THE Bedrock_Client SHALL track the number of tokens consumed and store the usage per organization per month in the Data_Store
2. WHEN an organization's monthly token usage reaches the configured limit, THE Bedrock_Client SHALL reject further AI requests with an error indicating the token limit has been exceeded
3. IF a Bedrock API call fails due to timeout, throttling, or service error, THEN THE Bedrock_Client SHALL retry the request up to 3 times with exponential backoff before returning an error response
4. WHEN a Bedrock API call fails after all retries, THE Bedrock_Client SHALL return an error response containing a human-readable message and a suggestion to retry the operation
5. THE Bedrock_Client SHALL include a language instruction in every prompt directing the AI model to respond in the user's preferred language (Indonesian or English)

### Requirement 10: Admin User and Position Management

**User Story:** As an organization administrator, I want to manage users and configure target positions with competency requirements, so that the platform can properly evaluate employees against organizational standards.

#### Acceptance Criteria

1. WHEN an Admin creates a new user, THE Platform SHALL assign the new user to the Admin's own organization and set the specified role (Employee or Manager)
2. WHEN an Admin creates or updates a position, THE Platform SHALL store the position with its competency requirements where each requirement includes a topic, required score, and weight
3. THE Platform SHALL validate that all competency requirement weights for a position sum to 1.0
4. WHEN an Admin views token usage, THE Platform SHALL display the organization's monthly token consumption broken down by feature

### Requirement 11: Platform Responsiveness and User Experience

**User Story:** As an employee, I want a responsive bilingual interface, so that I can use the platform comfortably in my preferred language.

#### Acceptance Criteria

1. THE Platform SHALL provide a user interface built with AWS Cloudscape Design System components
2. THE Platform SHALL support both Indonesian and English languages for all user interface text
3. WHEN a user changes their language preference, THE Platform SHALL persist the preference and render all subsequent UI content and AI-generated responses in the selected language
4. WHEN an AI operation is processing, THE Platform SHALL display a loading indicator to inform the user that the operation is in progress
5. WHEN a roleplay AI response is being generated, THE Platform SHALL stream tokens to the user interface in real-time rather than waiting for the complete response
