#!/usr/bin/env node
import { createClient } from "./index.js";

// ACME_REGION is intentionally undocumented (env-drift fixture).
const region = process.env.ACME_REGION ?? "us";
const client = createClient({
  apiKey: process.env.ACME_API_KEY,
  region,
});
const result = await client.ping();
console.log(JSON.stringify(result));
