import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cdk from 'aws-cdk-lib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * User Handler Lambda Function
 *
 * Handles user profile retrieval, user management (CRUD),
 * position configuration, and token usage monitoring.
 * Does NOT invoke Bedrock models.
 *
 * Timeout: 10 seconds (shortest — no AI operations)
 */
export class UserHandlerFunction extends Construct {
  public readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new nodejs.NodejsFunction(this, 'UserHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'handler.ts'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
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
