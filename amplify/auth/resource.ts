import { defineAuth } from '@aws-amplify/backend';

/**
 * Amazon Cognito User Pool configuration for AI Skill Assessment Platform.
 *
 * Base configuration:
 * - Login with email (verification enabled)
 * - Standard attributes only at this level
 *
 * Custom attributes (custom:orgId, custom:role) and token expiry settings
 * are applied via CDK overrides in amplify/backend.ts after defineBackend().
 *
 * @see Requirements 1.1, 1.2, 1.3
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
