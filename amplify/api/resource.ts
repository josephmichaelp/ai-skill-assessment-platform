import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Platform REST API Construct
 *
 * Defines the API Gateway REST API with:
 * - Cognito User Pool Authorizer on all routes
 * - Request throttling (100 req/s)
 * - CORS enabled for all origins (dev mode)
 * - Request validators for POST/PUT endpoints
 * - All endpoints mapped to the appropriate Lambda handlers
 *
 * @see Requirements 1.1, 1.4
 */

export interface PlatformApiProps {
  /** Cognito User Pool for JWT authorization */
  userPool: cognito.IUserPool;
  /** Lambda function handlers */
  assessmentHandler: lambda.IFunction;
  roleplayHandler: lambda.IFunction;
  assignmentHandler: lambda.IFunction;
  promotionHandler: lambda.IFunction;
  performanceHandler: lambda.IFunction;
  userHandler: lambda.IFunction;
}

export class PlatformApi extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: PlatformApiProps) {
    super(scope, id);

    const {
      userPool,
      assessmentHandler,
      roleplayHandler,
      assignmentHandler,
      promotionHandler,
      performanceHandler,
      userHandler,
    } = props;

    // ─────────────────────────────────────────────────────────────────────────
    // REST API with throttling
    // ─────────────────────────────────────────────────────────────────────────

    this.api = new apigateway.RestApi(this, 'PlatformRestApi', {
      restApiName: 'AI Skill Assessment Platform API',
      description: 'REST API for the AI Skill Assessment & Talent Development Platform',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Cognito Authorizer
    // ─────────────────────────────────────────────────────────────────────────

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'PlatformCognitoAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    const authorizationConfig: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Request Validators (available for non-proxy integrations)
    // ─────────────────────────────────────────────────────────────────────────

    // Body validator for POST/PUT endpoints
    new apigateway.RequestValidator(this, 'BodyValidator', {
      restApi: this.api,
      requestValidatorName: 'validate-request-body',
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // Parameters validator for endpoints with path/query params
    new apigateway.RequestValidator(this, 'ParamsValidator', {
      restApi: this.api,
      requestValidatorName: 'validate-request-params',
      validateRequestBody: false,
      validateRequestParameters: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda Integrations
    // ─────────────────────────────────────────────────────────────────────────

    const assessmentIntegration = new apigateway.LambdaIntegration(assessmentHandler, {
      proxy: true,
    });

    const roleplayIntegration = new apigateway.LambdaIntegration(roleplayHandler, {
      proxy: true,
    });

    const assignmentIntegration = new apigateway.LambdaIntegration(assignmentHandler, {
      proxy: true,
    });

    const promotionIntegration = new apigateway.LambdaIntegration(promotionHandler, {
      proxy: true,
    });

    const performanceIntegration = new apigateway.LambdaIntegration(performanceHandler, {
      proxy: true,
    });

    const userIntegration = new apigateway.LambdaIntegration(userHandler, {
      proxy: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Authentication / User Context
    // ─────────────────────────────────────────────────────────────────────────

    const authResource = this.api.root.addResource('auth');
    const authProfile = authResource.addResource('profile');
    authProfile.addMethod('POST', userIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Assessments
    // ─────────────────────────────────────────────────────────────────────────

    const assessments = this.api.root.addResource('assessments');
    assessments.addMethod('GET', assessmentIntegration, authorizationConfig);

    const assessmentsGenerate = assessments.addResource('generate');
    assessmentsGenerate.addMethod('POST', assessmentIntegration, authorizationConfig);

    const assessmentsSubmit = assessments.addResource('submit');
    assessmentsSubmit.addMethod('POST', assessmentIntegration, authorizationConfig);

    const assessmentsGapAnalysis = assessments.addResource('gap-analysis');
    assessmentsGapAnalysis.addMethod('GET', assessmentIntegration, authorizationConfig);

    const assessmentById = assessments.addResource('{id}');
    assessmentById.addMethod('GET', assessmentIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Roleplay
    // ─────────────────────────────────────────────────────────────────────────

    const roleplay = this.api.root.addResource('roleplay');

    const roleplayStart = roleplay.addResource('start');
    roleplayStart.addMethod('POST', roleplayIntegration, authorizationConfig);

    const roleplayById = roleplay.addResource('{id}');
    roleplayById.addMethod('GET', roleplayIntegration, authorizationConfig);

    const roleplayMessage = roleplayById.addResource('message');
    roleplayMessage.addMethod('POST', roleplayIntegration, authorizationConfig);

    const roleplayEnd = roleplayById.addResource('end');
    roleplayEnd.addMethod('POST', roleplayIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Assignments
    // ─────────────────────────────────────────────────────────────────────────

    const assignments = this.api.root.addResource('assignments');
    assignments.addMethod('GET', assignmentIntegration, authorizationConfig);

    const assignmentsUploadUrl = assignments.addResource('upload-url');
    assignmentsUploadUrl.addMethod('POST', assignmentIntegration, authorizationConfig);

    const assignmentsReview = assignments.addResource('review');
    assignmentsReview.addMethod('POST', assignmentIntegration, authorizationConfig);

    const assignmentById = assignments.addResource('{id}');
    assignmentById.addMethod('GET', assignmentIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Promotion
    // ─────────────────────────────────────────────────────────────────────────

    const promotion = this.api.root.addResource('promotion');

    const promotionByUser = promotion.addResource('{userId}');
    promotionByUser.addMethod('GET', promotionIntegration, authorizationConfig);

    const promotionHistory = promotionByUser.addResource('history');
    promotionHistory.addMethod('GET', promotionIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Performance
    // ─────────────────────────────────────────────────────────────────────────

    const performance = this.api.root.addResource('performance');

    const performanceByUser = performance.addResource('{userId}');
    performanceByUser.addMethod('GET', performanceIntegration, authorizationConfig);

    const performanceGenerate = performanceByUser.addResource('generate');
    performanceGenerate.addMethod('POST', performanceIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Admin - Users
    // ─────────────────────────────────────────────────────────────────────────

    const users = this.api.root.addResource('users');
    users.addMethod('GET', userIntegration, authorizationConfig);
    users.addMethod('POST', userIntegration, authorizationConfig);

    const userById = users.addResource('{userId}');
    userById.addMethod('PUT', userIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Admin - Positions
    // ─────────────────────────────────────────────────────────────────────────

    const positions = this.api.root.addResource('positions');
    positions.addMethod('GET', userIntegration, authorizationConfig);
    positions.addMethod('POST', userIntegration, authorizationConfig);

    const positionById = positions.addResource('{positionId}');
    positionById.addMethod('PUT', userIntegration, authorizationConfig);

    // ─────────────────────────────────────────────────────────────────────────
    // Routes: Admin - Token Usage
    // ─────────────────────────────────────────────────────────────────────────

    const admin = this.api.root.addResource('admin');
    const tokenUsage = admin.addResource('token-usage');
    tokenUsage.addMethod('GET', userIntegration, authorizationConfig);

    const tokenUsageDaily = tokenUsage.addResource('daily');
    tokenUsageDaily.addMethod('GET', userIntegration, authorizationConfig);

    const tokenUsageForecast = tokenUsage.addResource('forecast');
    tokenUsageForecast.addMethod('GET', userIntegration, authorizationConfig);

  }
}
