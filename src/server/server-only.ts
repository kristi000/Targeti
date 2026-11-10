// Marks a module as server-only. Node resolves this empty module via tsconfig
// paths; the Vite client build rejects any import of "server-only".
export {};
