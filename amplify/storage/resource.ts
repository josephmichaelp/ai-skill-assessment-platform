import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';

/**
 * S3 Storage for AI Skill Assessment Platform — Document Bucket.
 *
 * Bucket: platform-documents (logical name; CloudFormation generates actual name)
 * Key Pattern: org/{orgId}/assignments/{assignmentId}/{filename}
 *
 * Security:
 * - No public access (all access via presigned URLs)
 * - Block all public ACLs and policies
 * - Lambda IAM role scoped to org/${orgId}/* for GetObject + PutObject
 *
 * Lifecycle:
 * - Transition to S3 Infrequent Access after 30 days
 * - No automatic deletion (documents retained indefinitely)
 *
 * CORS:
 * - Allow GET, PUT, POST from Amplify hosting domain (wildcard for dev)
 */
export class PlatformDocumentsBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Determine if this is a sandbox environment
    const isSandbox = scope.node.tryGetContext('amplify-environment') === 'sandbox';

    this.bucket = new s3.Bucket(this, 'PlatformDocumentsBucket', {
      // Block all public access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // Encryption at rest using S3-managed keys
      encryption: s3.BucketEncryption.S3_MANAGED,

      // Enforce SSL for all requests
      enforceSSL: true,

      // Versioning disabled (not required for MVP; presigned URLs handle access)
      versioned: false,

      // Retention: keep bucket on stack deletion in production, destroy in sandbox
      removalPolicy: isSandbox ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: isSandbox,

      // CORS configuration for Amplify hosting domain
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['*'], // Use wildcard for development; restrict to Amplify domain in production
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag', 'x-amz-request-id'],
          maxAge: 3600,
        },
      ],

      // Lifecycle rules
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          // No expiration — documents retained indefinitely
        },
      ],
    });
  }
}
