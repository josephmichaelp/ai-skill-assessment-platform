import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

/**
 * WebSocket Authorizer Lambda
 *
 * Validates JWT tokens passed via the `Authorization` query string parameter
 * on WebSocket $connect requests.
 *
 * For now, this performs basic JWT decoding and expiry validation.
 * Full Cognito signature verification (JWKS) will be added in a later task.
 */

interface JwtPayload {
  sub: string;
  'custom:orgId'?: string;
  'custom:role'?: string;
  exp?: number;
  iss?: string;
  token_use?: string;
}

/**
 * Decode a JWT token payload without verifying the signature.
 * Full signature verification against Cognito JWKS will be added later.
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Generate an IAM policy document for the authorizer response.
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>,
): APIGatewayAuthorizerResult {
  const authResponse: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  if (context) {
    authResponse.context = context;
  }

  return authResponse;
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  // Extract token from query string parameters
  const token =
    event.queryStringParameters?.Authorization ||
    event.queryStringParameters?.authorization ||
    event.queryStringParameters?.token;

  if (!token) {
    console.error('No authorization token found in query string parameters');
    return generatePolicy('anonymous', 'Deny', event.methodArn);
  }

  // Decode the JWT payload
  const payload = decodeJwtPayload(token);

  if (!payload) {
    console.error('Failed to decode JWT token');
    return generatePolicy('anonymous', 'Deny', event.methodArn);
  }

  // Check token expiry
  if (payload.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      console.error('Token has expired', { exp: payload.exp, now });
      return generatePolicy(payload.sub || 'anonymous', 'Deny', event.methodArn);
    }
  }

  // Validate required claims exist
  if (!payload.sub) {
    console.error('Token missing sub claim');
    return generatePolicy('anonymous', 'Deny', event.methodArn);
  }

  // Build context to pass to downstream Lambda functions
  const context: Record<string, string> = {
    userId: payload.sub,
    orgId: payload['custom:orgId'] || '',
    role: payload['custom:role'] || 'Employee',
  };

  // Allow access — use wildcard resource to allow all routes in this WebSocket API
  // This allows $connect to authorize once, and subsequent messages are allowed
  const arnParts = event.methodArn.split(':');
  const apiGatewayArnParts = arnParts[5].split('/');
  const wildcardArn = `${arnParts[0]}:${arnParts[1]}:${arnParts[2]}:${arnParts[3]}:${arnParts[4]}:${apiGatewayArnParts[0]}/${apiGatewayArnParts[1]}/*`;

  return generatePolicy(payload.sub, 'Allow', wildcardArn, context);
};
