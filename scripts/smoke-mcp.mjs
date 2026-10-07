// Local smoke test over real stdio: initialize, tools/list, health (live mainnet, free),
// and one paid tool WITHOUT a key (expects a parsed 402 quote, nothing paid).
// Usage: node scripts/smoke-mcp.mjs [path-to-server.mjs]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = process.argv[2] || new URL("../dist/btc-radar-mcp.mjs", import.meta.url).pathname;
const env = { ...process.env };
delete env.X402_PRIVATE_KEY; // never pay in smoke tests
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "inherit" });
const client = new Client({ name: "smoke", version: "0.0.0" });
const out = (label, v) => console.log(`\n=== ${label}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);

await client.connect(transport);
out("initialize -> serverVersion", client.getServerVersion());
const { tools } = await client.listTools();
out("tools/list", tools.map((t) => `${t.name}: ${t.description.slice(0, 60)}…`));
const h = await client.callTool({ name: "health", arguments: {} });
out("health", h.content[0].text);
const tr = await client.callTool({ name: "token_risk", arguments: { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } });
out(`token_risk (no key) isError=${tr.isError}`, tr.content[0].text);
const bad = await client.callTool({ name: "token_risk", arguments: { chain: "eth", address: "0x1" } });
out(`token_risk bad input isError=${bad.isError}`, bad.content[0].text.slice(0, 300));
const brief = (r) => { try { const j = JSON.parse(r.content[0].text); return { isError: r.isError, error: j.error, price_usd: j.quote?.price_usd, pay_to: j.quote?.pay_to, upstream: j.upstream }; } catch { return r.content[0].text.slice(0, 200); } };
for (const [name, args] of [
  ["btc_radar_latest", {}],
  ["project_info", { slug: "gpda" }],
  ["project_info", { slug: "no-such-project" }],
  ["token_risk_batch", { chain: "base", addresses: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0x4200000000000000000000000000000000000006"] }],
]) out(`${name} ${JSON.stringify(args)} (no key)`, brief(await client.callTool({ name, arguments: args })));
await client.close();
