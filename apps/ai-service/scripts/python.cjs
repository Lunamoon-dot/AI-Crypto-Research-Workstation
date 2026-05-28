#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const projectDir = path.resolve(__dirname, "..");
const cwd = process.cwd();
const isWindows = process.platform === "win32";

function requestedModule() {
  const moduleFlagIndex = args.indexOf("-m");
  if (moduleFlagIndex === -1) {
    return null;
  }
  return args[moduleFlagIndex + 1] || null;
}

function buildCandidates() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push({ command: process.env.PYTHON, prefix: [] });
  }

  const venvPython = isWindows
    ? path.join(projectDir, ".venv", "Scripts", "python.exe")
    : path.join(projectDir, ".venv", "bin", "python");
  if (existsSync(venvPython)) {
    candidates.push({ command: venvPython, prefix: [] });
  }

  if (isWindows) {
    candidates.push({ command: "py", prefix: ["-3.12"] });
    candidates.push({ command: "py", prefix: ["-3"] });
    return candidates;
  }

  candidates.push({ command: "python3", prefix: [] });
  candidates.push({ command: "python", prefix: [] });
  return candidates;
}

function canRun(candidate, moduleName) {
  const probeScript = moduleName
    ? `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(
        moduleName,
      )}) else 42)`
    : "import sys";
  const probe = spawnSync(candidate.command, [...candidate.prefix, "-c", probeScript], {
    cwd,
    encoding: "utf8",
  });
  return probe.status === 0;
}

const moduleName = requestedModule();
const candidate = buildCandidates().find((item) => canRun(item, moduleName));

if (!candidate) {
  const moduleHint = moduleName ? ` with module "${moduleName}"` : "";
  console.error(`Unable to find a usable Python interpreter${moduleHint}.`);
  console.error("Set PYTHON to the desired interpreter or install the project dev dependencies.");
  process.exit(1);
}

const result = spawnSync(candidate.command, [...candidate.prefix, ...args], {
  cwd,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(typeof result.status === "number" ? result.status : 1);
