import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';

/**
 * DynamoDB Single-Table Design for AI Skill Assessment Platform.
 *
 * Table: platform-data
 * Key Schema: PK (String, Partition Key), SK (String, Sort Key)
 * GSI1: GSI1PK + GSI1SK — manager team views (orgId → userId)
 * GSI2: GSI2PK + GSI2SK — time-based queries (orgId → createdAt)
 * Billing: PAY_PER_REQUEST (on-demand)
 * Recovery: Point-in-time recovery enabled
 */
export class PlatformDataTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Determine if this is a sandbox environment
    const isSandbox = scope.node.tryGetContext('amplify-environment') === 'sandbox';

    this.table = new dynamodb.Table(this, 'PlatformDataTable', {
      tableName: 'platform-data',
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: isSandbox ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: For manager team views (query by orgId → userId)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: For time-based queries (query by orgId → createdAt)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'GSI2PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
