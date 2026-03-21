# Auth0 Setup

This document covers the one-time manual steps required to configure Auth0 before deploying the stack.

## 1. Create an Auth0 account and tenant

1. Sign up at https://auth0.com
2. Create a new tenant (e.g. `gmail-translator`)

## 2. Create an API resource

1. In the Auth0 dashboard go to **Applications → APIs → Create API**
2. Set a **Name** (e.g. `gmail-translator-api`)
3. Set an **Identifier** — this is the audience value embedded in every JWT issued for this API (e.g. `https://gmail-translator-api`). It does not need to be a reachable URL.
4. Leave **Signing Algorithm** as `RS256`

Add API scopes for the frontend user tokens:

- `gmail:connect` for `/auth/google/start`
- `gmail:disconnect` for `/auth/google/disconnect`

The identifier becomes the `Auth0AudienceParam` SAM parameter.

## 3. Enable Google social connection

1. Go to **Authentication → Social → Create Connection → Google / Gmail**
2. Enter your Google OAuth **Client ID** and **Client Secret** (from the Google Cloud Console)
3. Enable the connection on your application

## 4. Create a user-facing application

1. Go to **Applications → Applications → Create Application**
2. Choose the SPA or regular web app type that matches your frontend
3. Configure the app to request your API audience plus the `gmail:connect` and `gmail:disconnect` scopes when signing users in

These routes now require end-user access tokens. Machine-to-machine tokens should not be used for Gmail connect or disconnect flows.

## 5. Create a test application for non-user API checks

1. Go to **Applications → Applications → Create Application**
2. Choose **Machine to Machine** for API testing with tools like Postman or curl
3. Authorize it against the API created in step 2
4. Use the client credentials grant to obtain a JWT for testing:

```bash
curl -s --request POST \
  --url https://YOUR_DOMAIN.auth0.com/oauth/token \
  --header "content-type: application/json" \
  --data '{
    "client_id": "<YOUR_CLIENT_ID>",
    "client_secret": "<YOUR_CLIENT_SECRET>",
    "audience": "https://gmail-translator-api",
    "grant_type": "client_credentials"
  }'
```

Do not use the resulting client-credentials token against `/auth/google/start` or `/auth/google/disconnect`; those routes require end-user tokens with the scopes above.

## 6. Find the values needed for SAM deployment

| SAM parameter | Where to find it |
|---|---|
| `Auth0IssuerParam` | Your tenant domain with a trailing slash. Found at **Settings → General → Domain** in the Auth0 dashboard, or under any application's **Settings → Domain** field (format: `https://YOUR_DOMAIN.auth0.com/`) |
| `Auth0AudienceParam` | The identifier you set in step 2 (e.g. `https://gmail-translator-api`) |

Update `samconfig.toml` with the real values before running `sam deploy`.

## Notes

- Never commit real Auth0 client secrets to the repository
- The `Auth0IssuerParam` must include the trailing slash (e.g. `https://your-tenant.auth0.com/`)
- The issuer and audience values must exactly match what is configured in `template.yaml` — API Gateway will reject any JWT where they do not match
