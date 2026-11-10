type RefreshHandler = () => unknown;

const handlers = new Set<RefreshHandler>();

/** Registers work to run when the app asks for fresh server data. */
export function onAppRefresh(handler: RefreshHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/** Refetches server data for everything on screen (like Next's router.refresh). */
export function refreshAppData() {
  handlers.forEach(handler => { void handler(); });
}
