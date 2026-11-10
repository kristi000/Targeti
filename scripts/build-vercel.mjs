// Builds the Vercel deployment in Build Output API v3 format (.vercel/output).
// Run after `vite build`. Vercel deploys this directory as-is:
//   - static/            the SPA from dist/client
//   - functions/api.func the Hono server (src/server/vercel.ts) with only the
//                        node_modules files it uses, traced by @vercel/nft
//   - config.json        routing: /api/* and signed-out pages go to the function,
//                        everything else is static with an index.html fallback
// https://vercel.com/docs/build-output-api/v3
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { nodeFileTrace } from "@vercel/nft";

const root = process.cwd();
const output = join(root, ".vercel", "output");
const functionDir = join(output, "functions", "api.func");
const entry = "dist/vercel/index.mjs";

await rm(output, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });

// 1. Static client.
await cp(join(root, "dist", "client"), join(output, "static"), { recursive: true });

// 2. Server bundle. npm packages stay external and are traced below.
await build({
  entryPoints: ["src/server/vercel.ts"],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// 3. Copy the bundle plus every file it loads at runtime.
// The tracer may log "Failed to parse ...LICENSE" for grpc-js proto folders; that's harmless.
const { fileList, warnings } = await nodeFileTrace([entry], { base: root });
for (const warning of warnings) {
  // Optional peer dependencies that are never installed are expected.
  if (!/Cannot find module|Failed to resolve dependency/.test(String(warning.message))) console.warn(warning.message);
}
// Workbook templates are read from process.cwd() (src/lib/server/annual-closing.ts).
const files = [...fileList, "src/lib/server/templates/inforsd.xlsx", "src/lib/server/templates/rak.xlsx", `${entry}.map`];
for (const file of files) {
  const target = join(functionDir, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, file), target, { dereference: true });
}

await writeFile(join(functionDir, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x",
  handler: entry,
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
}, null, 2));

// 4. Routing.
const toFunction = "/api?__pathname=$1";
await writeFile(join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "^/assets/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
    { src: "^(/api(?:/.*)?)$", dest: toFunction },
    // "/" picks a language; signed-out app pages redirect to /login.
    { src: "^(/)$", dest: toFunction },
    { src: "^(/(?:en|sq)(?:/.*)?)$", missing: [{ type: "cookie", key: "targeti_session" }], dest: toFunction },
    { handle: "filesystem" },
    { src: "^/.*$", dest: "/index.html", headers: { "Cache-Control": "no-cache" } },
  ],
}, null, 2));

console.log(`Vercel output written to .vercel/output (${files.length} function files).`);
