# Gmail Connection Contracts

## Runtime configuration

- `APP_SECRETS_SSM_PREFIX`: SSM prefix for app-level secrets only.
- `PROCESSED_EMAILS_TABLE`: DynamoDB table for translated-email dedupe state.
- `GMAIL_CONNECTIONS_TABLE`: DynamoDB table for per-user Gmail connections.
- `GMAIL_CONNECTIONS_STATUS_INDEX`: GSI that uses `gsi1pk` / `gsi1sk` for status queries.
- `GMAIL_TOKEN_KMS_KEY_ID`: KMS key or alias used to encrypt Gmail refresh tokens before persistence.

## App secrets vs user connection data

- `ParameterStoreService` now loads only app-wide secrets: Anthropic API key, Gmail OAuth client ID, Gmail OAuth client secret.
- Per-user Gmail refresh tokens must be encrypted with KMS and stored only in `GMAIL_CONNECTIONS_TABLE`.
- `buildGmailClient` now requires app OAuth credentials plus a user-scoped refresh token supplied by caller code.

## Request and auth boundary for later issues

- Later request handlers should provide a stable internal `userId` through `AuthenticatedAppUserProvider`.
- The repo does not assume Clerk, Auth0, Cognito, or any frontend SDK. Only the internal `userId` contract matters.
- OAuth callback code should call `GmailConnectionRepository.upsertPrimary()` for the MVP.
- Worker code that needs to process many users should call `listActive()` and decrypt each stored token with the same `userId` and `connectionId` encryption context.

## Data model notes

- Primary key design is `pk = USER#<userId>` and `sk = CONNECTION#<connectionId>`.
- The MVP uses one connection per user and defaults `connectionId` to `primary`.
- This allows a future multi-connection rollout to add non-primary sort keys without changing the partition model.
- Status index records use `gsi1pk = STATUS#<status>` and `gsi1sk = UPDATED_AT#<timestamp>#USER#<userId>`.
- The persisted connection item stays intentionally small: status, stable Google subject, optional Gmail address, encrypted refresh token, and timestamps.

## Status and token lifecycle

- `active`: token is expected to work and the connection can be processed.
- `error`: token exchange or refresh failed and the connection should be excluded from active processing.
- `revoked`: connection is intentionally disabled, and callers may also clear the encrypted refresh token.
