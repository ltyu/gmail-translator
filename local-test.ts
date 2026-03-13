/**
 * Local test script — runs the Lambda handler directly.
 *
 * Usage: npx tsx local-test.ts
 *
 * Requires:
 *   - AWS credentials configured locally (`aws configure`)
 *   - SSM parameters already deployed (from `sam deploy`)
 */

// Set environment variables that the Lambda normally gets from CloudFormation
process.env.DYNAMODB_TABLE = "gmail-translated-emails";
process.env.SSM_PREFIX = "/gmail-translator";

// Use dynamic import so env vars are set before handler.ts evaluates
const { handler } = await import("./src/handler.js");

handler({} as any)
  .then(() => console.log("\nFinished successfully"))
  .catch((err) => {
    console.error("\nFailed:", err);
    process.exit(1);
  });
