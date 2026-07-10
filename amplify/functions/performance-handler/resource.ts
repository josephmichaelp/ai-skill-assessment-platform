import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cdk from 'aws-cdk-lib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Performance Handler Lambda Function
 *
 * Handles auto-generation of employee performance summaries
 * by compiling assessment results, roleplay evaluations, and
 * assignment reviews within a specified time period.
 *
 * Bedrock Model: Amazon Nova Lite (amazon.nova-lite-v1:0)
 * Timeout: 30 seconds
 */
export class PerformanceHandlerFunction extends Construct {
  public readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new nodejs.NodejsFunction(this, 'PerformanceHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'handler.ts'),
      timeout: cdk.Duration.seconds(30),
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
