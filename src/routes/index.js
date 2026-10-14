import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Router } from "express";
import config from "#config/index.js";
import logger from "#core/utils/logger.js";

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../modules");

/**
 * Discovers every `src/modules/<name>/<name>.module.js` manifest (enabled or not).
 *
 * Manifest shape:
 *   { name, basePath, router, permissions?: Permission[], dependsOn?: string[], core?: boolean }
 * (`permissions` is built with `definePermissions()` from #core/rbac/permissions.js)
 */
export async function discoverModules() {
  const entries = await readdir(modulesDir, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(modulesDir, entry.name, `${entry.name}.module.js`);
    if (!existsSync(file)) continue;
    const { default: manifest } = await import(pathToFileURL(file).href);
    manifests.push(manifest);
  }

  return manifests;
}

/**
 * Enabled modules: `core` modules (auth, health, ...) are always on; others follow ENABLED_MODULES.
 */
export async function loadModules() {
  const manifests = await discoverModules();

  const enabled = manifests.filter(
    (m) => m.core || config.enabledModules === "*" || config.enabledModules.includes(m.name),
  );
  const enabledNames = new Set(enabled.map((m) => m.name));

  for (const m of enabled) {
    const missing = (m.dependsOn ?? []).filter((dep) => !enabledNames.has(dep));
    if (missing.length) {
      throw new Error(`Module "${m.name}" requires disabled module(s): ${missing.join(", ")}`);
    }
  }

  return enabled;
}

export async function buildApiRouter() {
  const router = Router();
  const modules = await loadModules();

  for (const m of modules) {
    router.use(m.basePath, m.router);
  }

  logger.info(`Modules loaded: ${modules.map((m) => m.name).join(", ")}`);
  return { router, modules };
}
