import { useCallback, useSyncExternalStore } from "react";

/*
 * Manager mode is the phone-only app with Dashboard, Rankings, Bonuses and Reports tabs.
 * It is for the administrator account only. Choosing "Classic view" is remembered per browser.
 */

const CLASSIC_VIEW_KEY = "d-one:manager-classic-view";
const MANAGER_SHOP_KEY = "d-one:manager-shop";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CLASSIC_VIEW_KEY || event.key === MANAGER_SHOP_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // The choice still applies until the page reloads when storage is unavailable.
    memory.set(key, value);
  }
  listeners.forEach(listener => listener());
}

// Fallback so the choice holds for this visit when localStorage throws.
const memory = new Map<string, string | null>();

function readValue(key: string) {
  return memory.has(key) ? memory.get(key) ?? null : read(key);
}

export function useClassicViewPreference() {
  const classic = useSyncExternalStore(subscribe, () => readValue(CLASSIC_VIEW_KEY) === "1", () => false);
  const setClassic = useCallback((value: boolean) => write(CLASSIC_VIEW_KEY, value ? "1" : null), []);
  return [classic, setClassic] as const;
}

export function useStoredManagerShopId() {
  const shopId = useSyncExternalStore(subscribe, () => readValue(MANAGER_SHOP_KEY), () => null);
  const setShopId = useCallback((value: string) => write(MANAGER_SHOP_KEY, value), []);
  return [shopId, setShopId] as const;
}

/** True when the signed-in user is the administrator and has not switched to the classic view. */
export function useManagerModeEnabled(isAdmin: boolean) {
  const [classic] = useClassicViewPreference();
  return isAdmin && !classic;
}

export function managerBasePath(locale: string) {
  return `/${locale}/m`;
}

/** Today's date in the shops' time zone, as yyyy-mm-dd. */
export function todayInTirana(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Tirane" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
