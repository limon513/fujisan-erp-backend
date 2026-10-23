import config from "#config/index.js";
import { createLocalDriver } from "./local.driver.js";
import { createS3Driver } from "./s3.driver.js";

/**
 * Storage driver chosen by STORAGE_DRIVER. Interface:
 *   put(key, buffer, contentType)  get(key) → readable stream  remove(key)
 */
const storage =
  config.storage.driver === "s3"
    ? createS3Driver(config.storage.s3)
    : createLocalDriver(config.storage);

export default storage;
