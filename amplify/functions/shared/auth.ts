/**
 * Auth Helper Utilities
 * Extracts and verifies JWT claims from API Gateway events.
 *
 * The Cognito User Pool has custom attributes: `custom:orgId` and `custom:role`.
 * When API Gateway validates the JWT via the Cognito authorizer, it passes claims in:
 * - event.requestContext.authorizer.claims (for REST API with Cognito authorizer)
 *
 * Requirements: 1.1, 1.4, 1.5, 8.4
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface UserClaims {
  userId: string;
  orgId: string;
  role: 'Admin' | 'Manager' | 'Employee';
  email: string;
}

export type AllowedRole = 'Admin' | 'Manager' | 'Employee';

// ─── Errors ────────────────────────────────────────────────────────────────────

/**
 * Custom error for authorization failures.
 * Contains an HTTP status code (401 or 403) indicating the type of auth failure.
 */
export class AuthorizationError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = statusCode;
  }
}

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Extract user claims from an API Gateway event's JWT authorizer claims.
 *
 * Extracts:
 * - `sub` → userId
 * - `custom:orgId` → orgId
 * - `custom:role` → role
 * - `email` → email
 *
 * Throws AuthorizationError (401) if claims are missing or incomplete.
 *
 * Requirement 1.1: Reject requests without valid authentication.
 */
export function extractClaims(event: APIGatewayProxyEvent): UserClaims {
  const claims = event.requestContext?.authorizer?.claims;

  if (!claims) {
    throw new AuthorizationError(
      401,
      'Authentication required. No valid token claims found in the request.'
    );
  }

  const userId = claims['sub'];
  const orgId = claims['custom:orgId'];
  const role = claims['custom:role'] as UserClaims['role'] | undefined;
  const email = claims['email'];

  if (!userId) {
    throw new AuthorizationError(
      401,
      'Authentication required. User ID (sub) is missing from token claims.'
    );
  }

  if (!orgId) {
    throw new AuthorizationError(
      401,
      'Authentication required. Organization ID is missing from token claims.'
    );
  }

  if (!role || !isValidRole(role)) {
    throw new AuthorizationError(
      401,
      'Authentication required. User role is missing or invalid in token claims.'
    );
  }

  return {
    userId,
    orgId,
    role,
    email: email ?? '',
  };
}

/**
 * Assert that the user's role is in the list of allowed roles.
 * Throws AuthorizationError (403) if the user's role is not permitted.
 *
 * Requirement 1.4: Enforce role-based access control.
 */
export function assertRole(claims: UserClaims, allowedRoles: AllowedRole[]): void {
  if (!allowedRoles.includes(claims.role)) {
    throw new AuthorizationError(
      403,
      `Access denied. Role '${claims.role}' is not authorized for this resource. ` +
      `Allowed roles: ${allowedRoles.join(', ')}.`
    );
  }
}

/**
 * Assert that the user belongs to the same organization as the requested resource.
 * Throws AuthorizationError (403) if the orgIds don't match.
 *
 * Requirement 1.5, 8.4: Deny cross-organization access.
 */
export function assertOrgAccess(claims: UserClaims, resourceOrgId: string): void {
  if (claims.orgId !== resourceOrgId) {
    throw new AuthorizationError(
      403,
      'Access denied. You do not have permission to access resources from another organization.'
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ROLES: ReadonlyArray<string> = ['Admin', 'Manager', 'Employee'];

/** Validate that a string is one of the accepted role values. */
function isValidRole(role: string): role is UserClaims['role'] {
  return VALID_ROLES.includes(role);
}
