#!/usr/bin/env node
// Global launcher for the oversteer CLI.
// Resolves the project root from this file's real location (npm link follows
// the symlink to here), then runs the project-local tsx on the CLI source.
// Only requires `node` on PATH; project deps (drizzle/pg/tsx) are found in the
// project's own node_modules regardless of the caller's cwd.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tsx = join(root, "node_modules", ".bin", "tsx");
const cli = join(root, "src", "cli", "index.ts");

const child = spawn(tsx, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
