import type { Context } from "hono";
import { getContext, tryGetContext } from "hono/context-storage";
import { getCookie } from "hono/cookie";

/** Reads a cookie from the request currently being handled. */
export function requestCookie(name: string): string | undefined {
  return getCookie(getContext(), name);
}

const requestCaches = new WeakMap<Context, Map<unknown, unknown>>();
const RESULT = Symbol("result");

/**
 * Memoizes a function for the lifetime of one request, like React's `cache`.
 * Arguments are compared by identity. Outside a request it calls through.
 */
export function cache<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  return (...args: Args) => {
    const context = tryGetContext();
    if (!context) return fn(...args);
    let store = requestCaches.get(context);
    if (!store) requestCaches.set(context, store = new Map());
    let node = store.get(fn) as Map<unknown, unknown> | undefined;
    if (!node) store.set(fn, node = new Map());
    for (const argument of args) {
      let next = node.get(argument) as Map<unknown, unknown> | undefined;
      if (!next) node.set(argument, next = new Map());
      node = next;
    }
    if (!node.has(RESULT)) node.set(RESULT, fn(...args));
    return node.get(RESULT) as Result;
  };
}
