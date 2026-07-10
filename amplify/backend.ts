import { defineBackend } from '@aws-amplify/backend';
import { CfnOutput } from 'aws-cdk-lib';
import { auth } from './auth/resource.js';
import { PlatformDataTable } from './data/resource.js';
import { PlatformDocumentsBucket } from './storage/resource.js';
import { PlatformFunctions } from './functions/resource.js';
import { PlatformApi } from './api/resource.js';
import { PlatformWebSocketApi } from './api/websocket-resource.js';
import { WsAuthorizerFunction } from './functions/ws-authorizer/resource.js';

/**
 * AI Skill Assessment & Talent Development Platform
 *
 * Backend definition for Amplify Gen 2.
 * Resources:
 * - auth (Cognito) ✓
 * - data (DynamoDB) ✓
 * - storage (S3)
 * - functions (Lambda handlers)
 * - API (REST + WebSocket)
 */
const backend = defineBackend({
  auth,
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth: CDK overrides for custom attributes and token settings
// ─────────────────────────────────────────────────────────────────────────────

const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;

// Add custom attributes for multi-tenancy and RBAC
// - custom:orgId — organization identifier for data isolation
// - custom:role — user role (Admin | Manager | Employee)
cfnUserPool.schema = [
  ...(cfnUserPool.schema as Array<Record<string, unknown>> || []),
  {
    name: 'orgId',
    attributeDataType: 'String',
    mutable: true,
    required: false,
    stringAttributeConstraints: {
      minLength: '1',
      maxLength: '128',
    },
  },
  {
    name: 'role',
    attributeDataType: 'String',
    mutable: true,
    required: false,
    stringAttributeConstraints: {
      minLength: '1',
      maxLength: '20',
    },
  },
];

// Configure token validity:
// - Access token: 1 hour (60 minutes)
// - Refresh token: 30 days (43200 minutes)
// - ID token: 1 hour (matches access token)
cfnUserPoolClient.accessTokenValidity = 60;
cfnUserPoolClient.idTokenValidity = 60;
cfnUserPoolClient.refreshTokenValidity = 43200;
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: 'minutes',
  idToken: 'minutes',
  refreshToken: 'minutes',
};

// ─────────────────────────────────────────────────────────────────────────────
// Data: DynamoDB single-table (platform-data) via custom CDK construct
// ─────────────────────────────────────────────────────────────────────────────

const dataStack = backend.createStack('PlatformDataStack');
const platformData = new PlatformDataTable(dataStack, 'PlatformData');

// Export table name and ARN for use by Lambda functions
new CfnOutput(dataStack, 'PlatformDataTableName', {
  value: platformData.table.tableName,
  description: 'DynamoDB single-table name for platform data',
});

new CfnOutput(dataStack, 'PlatformDataTableArn', {
  value: platformData.table.tableArn,
  description: 'DynamoDB single-table ARN for IAM policies',
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage: S3 document bucket for assignment uploads
// ─────────────────────────────────────────────────────────────────────────────

const storageStack = backend.createStack('PlatformStorageStack');
const documentsBucket = new PlatformDocumentsBucket(storageStack, 'PlatformDocuments');

// Export bucket name and ARN for use by Lambda functions
new CfnOutput(storageStack, 'PlatformDocumentsBucketName', {
  value: documentsBucket.bucket.bucketName,
  description: 'S3 bucket name for platform document uploads',
});

new CfnOutput(storageStack, 'PlatformDocumentsBucketArn', {
  value: documentsBucket.bucket.bucketArn,
  description: 'S3 bucket ARN for IAM policies',
});

// ─────────────────────────────────────────────────────────────────────────────
// Functions: Lambda handlers for all platform domains
// ─────────────────────────────────────────────────────────────────────────────

const functionsStack = backend.createStack('PlatformFunctionsStack');
const platformFunctions = new PlatformFunctions(functionsStack, 'PlatformFunctions', {
  table: platformData.table,
  bucket: documentsBucket.bucket,
});

// Export function ARNs for API Gateway integration
new CfnOutput(functionsStack, 'AssessmentHandlerArn', {
  value: platformFunctions.assessmentHandler.function.functionArn,
  description: 'Assessment handler Lambda ARN',
});

new CfnOutput(functionsStack, 'RoleplayHandlerArn', {
  value: platformFunctions.roleplayHandler.function.functionArn,
  description: 'Roleplay handler Lambda ARN',
});

new CfnOutput(functionsStack, 'AssignmentHandlerArn', {
  value: platformFunctions.assignmentHandler.function.functionArn,
  description: 'Assignment handler Lambda ARN',
});

new CfnOutput(functionsStack, 'PromotionHandlerArn', {
  value: platformFunctions.promotionHandler.function.functionArn,
  description: 'Promotion handler Lambda ARN',
});

new CfnOutput(functionsStack, 'PerformanceHandlerArn', {
  value: platformFunctions.performanceHandler.function.functionArn,
  description: 'Performance handler Lambda ARN',
});

new CfnOutput(functionsStack, 'UserHandlerArn', {
  value: platformFunctions.userHandler.function.functionArn,
  description: 'User handler Lambda ARN',
});

// ─────────────────────────────────────────────────────────────────────────────
// API: REST API Gateway with Cognito authorizer and Lambda integrations
// ─────────────────────────────────────────────────────────────────────────────

const apiStack = backend.createStack('PlatformApiStack');
const platformApi = new PlatformApi(apiStack, 'PlatformApi', {
  userPool: backend.auth.resources.userPool,
  assessmentHandler: platformFunctions.assessmentHandler.function,
  roleplayHandler: platformFunctions.roleplayHandler.function,
  assignmentHandler: platformFunctions.assignmentHandler.function,
  promotionHandler: platformFunctions.promotionHandler.function,
  performanceHandler: platformFunctions.performanceHandler.function,
  userHandler: platformFunctions.userHandler.function,
});

new CfnOutput(apiStack, 'PlatformApiUrl', {
  value: platformApi.api.url,
  description: 'REST API endpoint URL',
});

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket API: Real-time roleplay token streaming
// ─────────────────────────────────────────────────────────────────────────────

const wsApiStack = backend.createStack('PlatformWebSocketApiStack');
const wsAuthorizer = new WsAuthorizerFunction(wsApiStack, 'WsAuthorizer');

const platformWebSocketApi = new PlatformWebSocketApi(wsApiStack, 'PlatformWebSocketApi', {
  roleplayHandler: platformFunctions.roleplayHandler.function,
  wsAuthorizer: wsAuthorizer.function,
});

new CfnOutput(wsApiStack, 'PlatformWebSocketApiUrl', {
  value: platformWebSocketApi.webSocketUrl,
  description: 'WebSocket API endpoint URL for roleplay streaming',
});

new CfnOutput(wsApiStack, 'PlatformWebSocketCallbackUrl', {
  value: platformWebSocketApi.webSocketStage.callbackUrl,
  description: 'WebSocket callback URL for pushing messages to clients',
});
