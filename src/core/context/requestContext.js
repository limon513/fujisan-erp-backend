import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context (request id, ip, device, and later the authenticated actor).
 * Lets deep code such as the audit log read "who/where" without passing req around.
 */
const storage = new AsyncLocalStorage();

export const runWithContext = (context, fn) => storage.run(context, fn);

export const getContext = () => storage.getStore() ?? {};

/** Merge values into the current request's context (e.g. after authentication). */
export const setContext = (values) => {
  const store = storage.getStore();
  if (store) Object.assign(store, values);
};
