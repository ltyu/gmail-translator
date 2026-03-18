# Gmail Auto-Translator (English → Simplified Chinese)

Automatically translates incoming English emails to Simplified Chinese using Claude and replies in-thread, so the translation appears right in Gmail.

The Lambda keeps the orchestration in `handler.ts` while the Gmail, SSM, DynamoDB, translation, and parsing details live in focused helpers and services.

## How It Works

An AWS Lambda runs every 5 minutes, checks for new emails, translates them, and sends the translation as a reply in the same thread:

```
EventBridge (every 5 min) → Lambda (Node.js 20 / TypeScript)
                              ├── SSM Parameter Store (app secrets)
                              ├── Gmail API (fetch new emails)
                              ├── Claude API (translate EN → ZH-CN)
                              ├── Gmail API (reply with translation)
                              └── DynamoDB (processed emails + per-user Gmail connections)
```

Each translated reply looks like:

```
⬇ 以下为自动翻译 / Auto-translated
----------------------------------------
[translated text]
----------------------------------------
[original text]
```

DynamoDB tracks which emails have been processed (with 30-day auto-cleanup via TTL) so nothing gets translated twice.

## Prerequisites

1. **Google Cloud Project** — with Gmail API enabled and OAuth2 credentials
2. **Anthropic API Key** — from [console.anthropic.com](https://console.anthropic.com)
3. **AWS Account** — with AWS CLI configured (`aws configure`)
4. **AWS SAM CLI** — [install guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

Run the unit tests at any time with:

```bash
pnpm test
```

For secret scanning, install `gitleaks` locally and run:

```bash
pnpm secrets:scan
```

### 2. OAuth setup

Create Google OAuth credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

- use a Google OAuth **Web application** client for the backend start/callback flow
- register the callback URL from the deployed stack output `GoogleOAuthCallbackUrl`
- expect the app to request identity scopes (`openid`, `email`) in addition to the minimal Gmail scopes needed for inbox processing

If you still need a local one-off token for manual testing, you can use the legacy helper:

```bash
pnpm exec tsx setup-gmail-token.ts <client_id> <client_secret>
```

This opens a browser for Google consent and prints a refresh token for local/manual use. The deployed multi-user flow stores per-user refresh tokens encrypted with KMS in DynamoDB instead of relying on a single shared token.

### 3. Deploy to AWS

```bash
sam build
sam deploy --guided
```

SAM will prompt you for:

| Parameter | Description |
|---|---|
| `AnthropicApiKeyParam` | Your Anthropic API key |
| `GmailClientIdParam` | Your Google OAuth2 client ID |
| `GmailClientSecretParam` | Your Google OAuth2 client secret |
| `AppSecretsSsmPrefixParam` | SSM prefix for app-level secrets |
| `GmailConnectionSuccessRedirectUrlParam` | Future OAuth success redirect URL |
| `GmailConnectionFailureRedirectUrlParam` | Future OAuth failure redirect URL |

SAM now provisions:

- `TranslatedEmailsTable` for processed-email dedupe
- `GmailConnectionsTable` for per-user Gmail connections
- `GoogleOAuthStatesTable` for short-lived OAuth state records
- `GmailRefreshTokenKey` for encrypting per-user refresh tokens
- SSM parameters for app-level secrets under `AppSecretsSsmPrefixParam`
- scaffolded HttpApi routes and Lambda functions for `/auth/google/start`, `/auth/google/callback`, and `/auth/google/disconnect`
- stack outputs for `OAuthHttpApiBaseUrl` and `GoogleOAuthCallbackUrl`

The OAuth start and callback handlers are implemented in the stacked MVP work, while the disconnect handler remains a placeholder until `LEY-7`.

### 4. Verify

1. Send a test English email to the Gmail account
2. Wait up to 5 minutes (or invoke the Lambda manually from the AWS console)
3. A translated reply should appear in the same email thread
4. Check CloudWatch Logs for the `gmail-translator` function if anything goes wrong

## Cost

At low volume this is effectively free:

- **Lambda** — well within free tier (runs for a few seconds every 5 min)
- **DynamoDB** — pay-per-request, pennies per month
- **SSM Parameter Store** — free for standard parameters
- **Claude API** — ~$0.001–0.01 per email depending on length

## Project Structure

```text
src/
  utils/buildGmailClient.ts            # Gmail client construction
  utils/emailParser.ts                # Gmail payload parsing helpers
  utils/replyComposer.ts              # Reply message formatting
  repositories/dynamoDbGmailConnectionRepository.ts
  repositories/dynamoDbOAuthStateRepository.ts
  repositories/dynamoDbProcessedEmailRepository.ts
  services/headerAuthenticatedAppUserProvider.ts
  services/gmailMessageService.ts
  services/kmsGmailTokenEncryptionService.ts
  services/parameterStore.ts
  services/translatorService.ts
  handlers/startGoogleOAuth.ts
  handlers/googleOAuthCallback.ts
  handlers/disconnectGoogleOAuth.ts
  handler.ts                          # AWS Lambda entrypoint
docs/gmail-connection-contracts.md    # User-context and storage contracts
test/                                 # Vitest unit tests
```

## Development

```bash
pnpm test        # run tests in watch mode
pnpm test:run
pnpm secrets:scan
pnpm secrets:scan:changes
pnpm exec tsc --noEmit
pnpm build
```

## Secret Scanning

- `gitleaks` is used to scan the repo for hardcoded secrets
- `.husky/pre-commit` runs `pnpm run secrets:scan:staged` before each commit
- install `gitleaks` from the official releases: `https://github.com/gitleaks/gitleaks/releases`
