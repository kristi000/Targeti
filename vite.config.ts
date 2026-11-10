import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const actionsDir = fileURLToPath(new URL("./src/server/actions/", import.meta.url)).replaceAll("\\", "/");
const apiPort = Number(process.env.API_PORT) || 9003;
// Keep the browser's Host header so the API's same-origin (CSRF) checks pass.
const apiProxy = { "/api": { target: `http://localhost:${apiPort}`, changeOrigin: false } };

/**
 * Lets client code import server actions the way Next.js did.
 *
 * - A client import of a src/server/actions file that starts with "use server"
 *   becomes a stub whose exports call POST /api/rpc/<file>/<export>.
 * - Any client import of "server-only" fails the build, so server code (and
 *   secrets) can never end up in the browser bundle.
 */
function serverActions(): Plugin {
  return {
    name: "targeti:server-actions",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (source !== "server-only") return null;
      // Vite's dependency scanner walks the real files; let it pass.
      if ((options as { scan?: boolean }).scan) return { id: "server-only", external: true };
      this.error(`Server-only module imported into client code by ${importer ?? "an unknown module"}.`);
    },
    load(id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.startsWith(actionsDir) || !/\.tsx?$/.test(file)) return null;
      const code = readFileSync(file, "utf8");
      if (!/^﻿?\s*["']use server["']/.test(code)) return null;
      if (/^export\s+(default\b|\{|\*)/m.test(code)) {
        this.error(`${file}: "use server" files may only export functions with "export async function" or "export const".`);
      }
      const moduleName = basename(file).replace(/\.tsx?$/, "");
      const names = [...code.matchAll(/^export\s+(?:async\s+function\s*\*?|function\s*\*?|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
      return [
        `import { createServerAction } from "@/lib/server-action-client";`,
        ...names.map(name => `export const ${name} = createServerAction(${JSON.stringify(moduleName)}, ${JSON.stringify(name)});`),
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [serverActions(), react()],
  resolve: { alias: { "@": srcDir } },
  server: {
    port: 9002,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 9002,
    proxy: apiProxy,
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
});
