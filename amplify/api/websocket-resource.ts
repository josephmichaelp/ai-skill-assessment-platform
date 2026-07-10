import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Platform WebSocket API Construct
 *
 * Defines the API Gateway WebSocket API for real-time roleplay token streaming.
 * Routes:
 * - $connect: Authenticated via Lambda authorizer (validates JWT from query string)
 * - $disconnect: Cleanup handler (uses roleplay handler)
 * - sendMessage: Main route for roleplay message exchange with streaming
 *
 * The roleplay handler Lambda is granted execute-api:ManageConnections
 * permission so it can push streamed tokens back to connected WebSocket clients.
 *
 * @see Requirements 4.2, 11.5
 */

export interface PlatformWebSocketApiProps {
  /** Lambda function that handles roleplay WebSocket messages */
  roleplayHandler: lambda.IFunction;
  /** Lambda function that authorizes WebSocket $connect requests */
  wsAuthorizer: lambda.IFunction;
}

export class PlatformWebSocketApi extends Construct {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly webSocketStage: apigatewayv2.WebSocketStage;
  public readonly webSocketUrl: string;

  constructor(scope: Construct, id: string, props: PlatformWebSocketApiProps) {
    super(scope, id);

    const { roleplayHandler, wsAuthorizer } = props;

    // ─────────────────────────────────────────────────────────────────────────
    // Lambda Authorizer for $connect
    // ─────────────────────────────────────────────────────────────────────────

    const lambdaAuthorizer = new authorizers.WebSocketLambdaAuthorizer(
      'WsConnectAuthorizer',
      wsAuthorizer,
      {
        identitySource: ['route.request.querystring.Authorization'],
      },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket API
    // ─────────────────────────────────────────────────────────────────────────

    const roleplayIntegration = new integrations.WebSocketLambdaIntegration(
      'RoleplayIntegration',
      roleplayHandler,
    );

    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'RoleplayWebSocketApi', {
      apiName: 'AI Skill Assessment Platform - Roleplay WebSocket',
      description: 'WebSocket API for real-time roleplay token streaming',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          roleplayHandler,
        ),
        authorizer: lambdaAuthorizer,
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          roleplayHandler,
        ),
      },
      defaultRouteOptions: {
        integration: roleplayIntegration,
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // sendMessage route
    // ─────────────────────────────────────────────────────────────────────────

    this.webSocketApi.addRoute('sendMessage', {
      integration: new integrations.WebSocketLambdaIntegration(
        'SendMessageIntegration',
        roleplayHandler,
      ),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Stage with auto-deploy
    // ─────────────────────────────────────────────────────────────────────────

    this.webSocketStage = new apigatewayv2.WebSocketStage(this, 'RoleplayWebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Store the WebSocket URL for outputs
    this.webSocketUrl = this.webSocketStage.url;

    // ─────────────────────────────────────────────────────────────────────────
    // Grant roleplay handler permission to manage WebSocket connections
    // (push messages back to connected clients via @connections API)
    // ─────────────────────────────────────────────────────────────────────────

    roleplayHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          cdk.Fn.join('', [
            'arn:aws:execute-api:',
            cdk.Stack.of(this).region,
            ':',
            cdk.Stack.of(this).account,
            ':',
            this.webSocketApi.apiId,
            '/',
            this.webSocketStage.stageName,
            '/POST/@connections/*',
          ]),
        ],
      }),
    );

    // Pass the WebSocket callback URL as environment variable to the roleplay handler
    // so it can post messages back to connected clients
    (roleplayHandler as lambda.Function).addEnvironment(
      'WEBSOCKET_CALLBACK_URL',
      this.webSocketStage.callbackUrl,
    );
  }
}
