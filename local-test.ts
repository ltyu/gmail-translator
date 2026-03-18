/**
 * Local test script — runs the Lambda handler directly.
 *
 * Usage: pnpm exec tsx local-test.ts
 *
 * Requires:
 *   - AWS credentials configured locally (`aws configure`)
 *   - SSM app secrets already deployed (from `sam deploy`)
 *   - Gmail connection data already stored in DynamoDB
 */

export {};

// Set environment variables that the Lambda normally gets from CloudFormation
process.env.PROCESSED_EMAILS_TABLE = "gmail-translated-emails";
process.env.APP_SECRETS_SSM_PREFIX = "/gmail-translator";
process.env.GMAIL_CONNECTIONS_TABLE = "gmail-user-connections";
process.env.GMAIL_CONNECTIONS_STATUS_INDEX = "gsi1";
process.env.GMAIL_TOKEN_KMS_KEY_ID = "alias/gmail-refresh-token";

// Use dynamic import so env vars are set before handler.ts evaluates
const { handler } = await import("./src/handler.js");

handler({} as any)
  .then(() => console.log("\nFinished successfully"))
  .catch((err) => {
    console.error("\nFailed:", err);
    process.exit(1);
  });
