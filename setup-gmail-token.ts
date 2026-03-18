/**
 * One-time local script to obtain a Gmail OAuth2 refresh token.
 *
 * Usage:
 *   1. Create OAuth2 credentials (Desktop app) in Google Cloud Console
 *   2. Download the JSON and note the client_id and client_secret
 *   3. Run: pnpm exec tsx setup-gmail-token.ts <client_id> <client_secret>
 *   4. A browser window will open for Google consent
 *   5. The refresh token will be printed — use it during `sam deploy --guided`
 */

import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

async function main() {
  const clientId = process.argv[2];
  const clientSecret = process.argv[3];

  if (!clientId || !clientSecret) {
    console.error(
      "Usage: pnpm exec tsx setup-gmail-token.ts <client_id> <client_secret>"
    );
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\nOpening browser for Google OAuth consent...\n");
  console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);

  // Open browser
  const { exec } = await import("node:child_process");
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${openCmd} "${authUrl}"`);

  // Start local server to receive the callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
      const authCode = url.searchParams.get("code");

      if (authCode) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>"
        );
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1><p>No code received.</p>");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(
        `Listening on http://localhost:${REDIRECT_PORT} for OAuth callback...\n`
      );
    });

    server.on("error", reject);
  });

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "ERROR: No refresh token received. Make sure you used prompt: 'consent' and access_type: 'offline'."
    );
    console.error(
      "Try revoking access at https://myaccount.google.com/permissions and re-running."
    );
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("SUCCESS! Here is your refresh token:\n");
  console.log(tokens.refresh_token);
  console.log("\n" + "=".repeat(60));
  console.log(
    "\nSave this token — you'll need it when running `sam deploy --guided`."
  );
  console.log(
    "It will be stored securely in AWS SSM Parameter Store.\n"
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
