import superjson from "superjson";

/**
 * Client side of a server action. The Vite plugin replaces each export of a
 * "use server" module with one of these, which calls POST /api/rpc/:module/:action.
 */
export function createServerAction(moduleName: string, actionName: string) {
  const url = `/api/rpc/${moduleName}/${actionName}`;
  return async (...args: unknown[]) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: superjson.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = "";
      try { message = (JSON.parse(text) as { error?: string }).error ?? ""; } catch { /* non-JSON error body */ }
      throw new Error(message || `Request failed with status ${response.status}.`);
    }
    return superjson.parse(text);
  };
}
