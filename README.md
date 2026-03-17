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

1. **Google Cloud Project** — with Gmail API enabled and OAuth2 credentials (Desktop app type)
2. **Anthropic API Key** — from [console.anthropic.com](https://console.anthropic.com)
3. **AWS Account** — with AWS CLI configured (`aws configure`)
4. **AWS SAM CLI** — [install guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

## Setup

### 1. Install dependencies

```bash
npm install
```

Run the unit tests at any time with:

```bash
npm test
```

For secret scanning, install `gitleaks` locally and run:

```bash
npm run secrets:scan
```

### 2. Get a Gmail OAuth refresh token

Create OAuth2 credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Desktop app type), then run:

```bash
npx tsx setup-gmail-token.ts <client_id> <client_secret>
```

This opens a browser for Google consent and prints a refresh token. Save it for the next step.

### 3. Deploy to AWS

```bash
sam build
sam deploy --guided
```

SAM will prompt you for:

| Parameter | Description |
|---|---|
| `AnthropicApiKeyParam` | Your Anthropic API key |
| `GmailRefreshTokenParam` | The refresh token from step 2 |
| `GmailClientIdParam` | Your Google OAuth2 client ID |
| `GmailClientSecretParam` | Your Google OAuth2 client secret |

App-level secrets are stored in AWS SSM Parameter Store. Per-user Gmail refresh tokens should be encrypted with AWS KMS and stored in DynamoDB.

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
  services/dynamoDbGmailConnectionRepository.ts
  services/dynamoDbProcessedEmailService.ts
  services/gmailMessageService.ts
  services/kmsGmailTokenEncryptionService.ts
  services/parameterStore.ts
  services/translatorService.ts
  handler.ts                          # AWS Lambda entrypoint
docs/gmail-connection-contracts.md    # User-context and storage contracts
test/                                 # Vitest unit tests
```

## Development

```bash
npm test        # run tests in watch mode
npm run test:run
npm run secrets:scan
npm run secrets:scan:changes
npx tsc --noEmit
npm run build
```

## Secret Scanning

- `gitleaks` is used to scan the repo for hardcoded secrets
- `.husky/pre-commit` runs `npm run secrets:scan:staged` before each commit
- install `gitleaks` from the official releases: `https://github.com/gitleaks/gitleaks/releases`
