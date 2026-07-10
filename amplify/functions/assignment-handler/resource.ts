import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cdk from 'aws-cdk-lib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Assignment Handler Lambda Function
 *
 * Handles document upload (presigned URL generation), document review
 * via AI, and assignment result retrieval.
 *
 * Bedrock Models: Amazon Nova Lite (amazon.nova-lite-v1:0) + Cohere Embed Multilingual v3
 * Timeout: 60 seconds (longer due to document processing + embedding)
 */
export class AssignmentHandlerFunction extends Construct {
  public readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new nodejs.NodejsFunction(this, 'AssignmentHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, 'handler.ts'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
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
