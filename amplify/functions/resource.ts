import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import { AssessmentHandlerFunction } from './assessment-handler/resource.js';
import { RoleplayHandlerFunction } from './roleplay-handler/resource.js';
import { AssignmentHandlerFunction } from './assignment-handler/resource.js';
import { PromotionHandlerFunction } from './promotion-handler/resource.js';
import { PerformanceHandlerFunction } from './performance-handler/resource.js';
import { UserHandlerFunction } from './user-handler/resource.js';

/**
 * Platform Lambda Functions Construct
 *
 * Instantiates all Lambda functions and grants them the necessary IAM permissions:
 * - DynamoDB: Read/Write to platform-data table and its GSIs
 * - S3: Read/Write scoped to org/* prefix in the documents bucket
 * - Bedrock: InvokeModel and InvokeModelWithResponseStream for
 *   amazon.nova-lite-v1:0 and cohere.embed-multilingual-v3 in ap-southeast-3
 *
 * Environment variables set on each function:
 * - TABLE_NAME: DynamoDB table name
 * - BUCKET_NAME: S3 bucket name
 * - BEDROCK_REGION: ap-southeast-3
 */

export interface PlatformFunctionsProps {
  table: dynamodb.Table;
  bucket: s3.Bucket;
}

export class PlatformFunctions extends Construct {
  public readonly assessmentHandler: AssessmentHandlerFunction;
  public readonly roleplayHandler: RoleplayHandlerFunction;
  public readonly assignmentHandler: AssignmentHandlerFunction;
  public readonly promotionHandler: PromotionHandlerFunction;
  public readonly performanceHandler: PerformanceHandlerFunction;
  public readonly userHandler: UserHandlerFunction;

  constructor(scope: Construct, id: string, props: PlatformFunctionsProps) {
    super(scope, id);

    const { table, bucket } = props;
    const bedrockRegion = 'ap-southeast-3';

    // ─────────────────────────────────────────────────────────────────────────
    // Instantiate all Lambda functions
    // ─────────────────────────────────────────────────────────────────────────

    this.assessmentHandler = new AssessmentHandlerFunction(this, 'AssessmentHandler');
    this.roleplayHandler = new RoleplayHandlerFunction(this, 'RoleplayHandler');
    this.assignmentHandler = new AssignmentHandlerFunction(this, 'AssignmentHandler');
    this.promotionHandler = new PromotionHandlerFunction(this, 'PromotionHandler');
    this.performanceHandler = new PerformanceHandlerFunction(this, 'PerformanceHandler');
    this.userHandler = new UserHandlerFunction(this, 'UserHandler');

    // Collect all function references for bulk permission grants
    const allFunctions = [
      this.assessmentHandler.function,
      this.roleplayHandler.function,
      this.assignmentHandler.function,
      this.promotionHandler.function,
      this.performanceHandler.function,
      this.userHandler.function,
    ];

    // Functions that invoke Bedrock models (all except user-handler)
    const bedrockFunctions = [
      this.assessmentHandler.function,
      this.roleplayHandler.function,
      this.assignmentHandler.function,
      this.promotionHandler.function,
      this.performanceHandler.function,
    ];

    // Functions that need S3 access (assignment-handler primarily, others for read)
    const s3Functions = [
      this.assignmentHandler.function,
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // Environment variables
    // ─────────────────────────────────────────────────────────────────────────

    for (const fn of allFunctions) {
      fn.addEnvironment('TABLE_NAME', table.tableName);
      fn.addEnvironment('BUCKET_NAME', bucket.bucketName);
      fn.addEnvironment('BEDROCK_REGION', bedrockRegion);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DynamoDB permissions: Read/Write to table + GSI indexes
    // ─────────────────────────────────────────────────────────────────────────

    for (const fn of allFunctions) {
      table.grantReadWriteData(fn);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // S3 permissions: Read/Write scoped to org/* prefix
    // ─────────────────────────────────────────────────────────────────────────

    for (const fn of s3Functions) {
      // Scoped to org/ prefix for multi-tenant isolation
      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
        ],
        resources: [
          `${bucket.bucketArn}/org/*`,
        ],
      }));

      // Allow listing objects under org/ prefix
      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:ListBucket',
        ],
        resources: [
          bucket.bucketArn,
        ],
        conditions: {
          StringLike: {
            's3:prefix': ['org/*'],
          },
        },
      }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bedrock permissions: InvokeModel for Nova Lite + Cohere Embed
    // ─────────────────────────────────────────────────────────────────────────

    const bedrockModelArns = [
      `arn:aws:bedrock:${bedrockRegion}::foundation-model/amazon.nova-lite-v1:0`,
      `arn:aws:bedrock:${bedrockRegion}::foundation-model/cohere.embed-multilingual-v3`,
    ];

    for (const fn of bedrockFunctions) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: bedrockModelArns,
      }));
    }
  }
}
