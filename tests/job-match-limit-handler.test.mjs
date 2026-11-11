import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const run = spawnSync(process.execPath, ["--experimental-vm-modules",
  path.join(import.meta.dirname, "../test-support/job-match-limit-runner.mjs"),
], { encoding: "utf8", timeout: 30_000 });
if (run.error) throw run.error;
const results = JSON.parse(run.stdout || "null");
assert.ok(Array.isArray(results) && results.length > 0, run.stderr);
for (const result of results) test(result.name, () => assert.equal(result.passed, true, result.error));
test("Free-analysis handler checks completed successfully", () => assert.equal(run.status, 0, run.stderr));
