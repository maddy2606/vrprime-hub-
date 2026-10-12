// Run with: npm test
//
// A file that runs on the server must not import a value (a list, a setting, a function) from a file
// marked "use client": it receives a placeholder instead of the value and crashes once deployed
// (this took down the All posts page, and nearly the Stock page). Components and types are fine.
// So the rule: from a client file, a server file may import only Components (PascalCase) and types.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const SRC = resolve(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const isClientFile = (source: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);

function resolveImport(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(SRC, spec.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

test("server files only import components and types from client files", () => {
  const problems: string[] = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    if (isClientFile(source)) continue;
    for (const match of source.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      const target = resolveImport(match[2]);
      if (!target || !isClientFile(readFileSync(target, "utf8"))) continue;
      for (const part of match[1].split(",")) {
        const name = part.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        // Components are PascalCase. ALL_CAPS, camelCase and hooks are values that would arrive as stubs.
        if (!/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name)) {
          problems.push(`${file.slice(SRC.length + 1)} imports "${name}" from the client file ${match[2]}`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], "Move these into a plain module (no \"use client\") and import them from there");
});
