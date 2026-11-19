/**
 * Tiny demo SDK used only as a docs-drift fixture.
 * Real export name is `createClient` — README wrongly says `createUser`.
 */
export function createClient(options = {}) {
  return {
    apiKey: options.apiKey ?? null,
    async ping() {
      return { ok: true };
    },
  };
}

export function verifyWebhook(payload, secret) {
  return Boolean(payload && secret);
}
