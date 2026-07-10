import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cdk from 'aws-cdk-lib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * WebSocket Authorizer Lambda Function
 *
 * Validates JWT tokens on WebSocket $connect requests.
 * Extracts claims (userId, orgId, role) and passes them
 * as authorizer context to downstream route handlers.
 *
 * Timeout: 10 seconds (authorization should be fast)
 */
export class WsAuthorizerFunction extends Construct {
  public readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new nodejs.NodejsFunction(this, 'WsAuthorizer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'handler.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    });
  }
}
