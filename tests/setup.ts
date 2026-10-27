/**
 * Every test file gets a data folder of its own, so a refresh in a test never
 * writes to the token store a real login on this machine uses, and one test's
 * saved tokens never reach another file's.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TIKTOK_DATA_DIR = mkdtempSync(join(tmpdir(), "tiktok-data-"));
