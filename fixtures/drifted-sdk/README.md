# Acme Drifted SDK

Intentional **docs drift** fixture for `docs-auditor-mcp`. Do not use in production.

## Install

```bash
npm install @acme/drifted-sdk
```

## Quickstart

Create a user client from `src/api/createUser.ts` (this path does not exist on purpose):

```ts
import { createUser } from "./src/api/createUser.ts";

const user = createUser({ apiKey: process.env.ACME_API_KEY });
await user.ping();
```

The real module lives at `src/index.js` and exports `createClient`.

## Run locally

Docs tell people to use a script that was renamed:

```bash
npm run start:dev
```

The package.json script is actually `dev`.

## Auth guide

See `docs/auth.md` for webhook verification. (That file was never added.)

## Webhooks

```js
import { verifyWebhook } from "./src/webhooks.js";

verifyWebhook(req.body, process.env.ACME_WEBHOOK_SECRET);
```
