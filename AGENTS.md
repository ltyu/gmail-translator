# AGENTS.md

Repository guidance for coding agents working in `gmail-translator`.

## Scope

- Applies to the whole repository.
- Prefer existing repo patterns over generic TypeScript defaults.
- Keep edits small and localized; avoid broad rewrites unless the task requires them.

## Agent Rule Sources

- No `.cursor/rules/` directory was present during analysis.
- No `.cursorrules` file was present during analysis.
- No `.github/copilot-instructions.md` file was present during analysis.
- If any of those appear later, merge their instructions into this file.

## Project Snapshot

- Runtime: Node.js 20 on AWS Lambda.
- Language: TypeScript.
- Module system: ESM with `"type": "module"`.
- Bundler: esbuild.
- Test runner: Vitest with `environment: "node"`.
- Main entrypoint: `src/handler.ts`.
- Main integrations: Gmail API, Anthropic, DynamoDB, SSM, and KMS.

## Repository Layout

- `src/handler.ts`: Lambda composition root and inbox processing flow.
- `src/services/`: service adapters for AWS, Gmail, translation, and repositories.
- `src/utils/`: focused helpers for parsing, reply formatting, and client creation.
- `src/types.ts`: shared interfaces, type aliases, and domain contracts.
- `test/`: Vitest unit tests mirroring source modules.
- `docs/gmail-connection-contracts.md`: storage and auth boundary rules.

## Setup And Daily Commands

- Install dependencies: `npm install`
- Build once: `npm run build`
- Test in watch mode: `npm test`
- Test once: `npm run test:run`
- Type-check: `npx tsc --noEmit`
- Local handler run: `npx tsx local-test.ts`
- Gmail token setup: `npx tsx setup-gmail-token.ts <client_id> <client_secret>`
- SAM deploy flow from README: `sam build` then `sam deploy --guided`

## Build, Lint, And Test Notes

- There is no dedicated ESLint script in this repo.
- There is no Prettier config in this repo.
- Treat `npx tsc --noEmit` as the main static check.
- Use `npm run test:run` for one-shot verification.
- Use `npm run build` when entrypoint wiring or bundle behavior changes.
- If you touch secrets or auth flow, also run a secret scan.

## Running A Single Test

- Single test file once: `npm run test:run -- src/handler.test.ts`
- Single test by name once: `npm run test:run -- -t "translates, replies, and marks processed"`
- Direct Vitest file run: `npx vitest run src/handler.test.ts`
- Direct Vitest file + name: `npx vitest run src/handler.test.ts -t "translates, replies, and marks processed"`
- For local watch mode on one file, pass the path to `npm test -- <path>` or run `npx vitest <path>`.

## Secret Scanning

- Full repo scan: `npm run secrets:scan`
- Pending changes scan: `npm run secrets:scan:changes`
- Staged changes scan: `npm run secrets:scan:staged`
- The pre-commit hook requires `gitleaks` and runs the staged scan automatically.

## Type Guidance

- Prefer interfaces for boundaries between modules and external systems.
- Inject SDK clients through constructors for testability.
- Reuse existing interfaces such as `GmailService`, `TranslationService`, and `ProcessedEmailRepository`.
- Avoid `any` in production code; current `any` usage is mostly in Gmail payload parsing and lightweight test doubles.

## Architecture Patterns

- Keep `src/handler.ts` as the composition root.
- Keep provider-specific behavior in `src/services/` and persistence adapters in `src/repositories/`.
- Keep pure helpers in `src/utils/`.
- Keep orchestration logic in testable functions like `processInbox`.
- Preserve dependency injection patterns that make units easy to mock.
- Use `Repository` for persistence-focused adapters such as DynamoDB-backed storage wrappers; reserve `Service` for broader behavior or external API integrations.

## Secrets And Safety

- Never commit real API keys, OAuth secrets, refresh tokens, or copied ciphertext.
- Use placeholders in docs, examples, and tests.
- Treat data from Gmail, Anthropic, SSM, DynamoDB, and KMS as sensitive by default.
- Prefer adding tests with fake values rather than recorded production material.
