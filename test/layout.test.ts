import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

type Import = { file: string; specifier: string; target: string | null };

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") visit(child);
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(relative(ROOT, child));
      }
    }
  };
  visit(join(ROOT, dir));
  return files;
}

/** Every import under `dir`, type-only ones included; `target` is set for relative imports. */
function importsUnder(dir: string): Import[] {
  return sourceFiles(dir).flatMap((file) =>
    ts.preProcessFile(readFileSync(join(ROOT, file), "utf-8"), true, true).importedFiles.map(({ fileName }) => ({
      file,
      specifier: fileName,
      target: fileName.startsWith(".") ? relative(ROOT, resolve(ROOT, dirname(file), fileName)) : null,
    })),
  );
}

const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);
const describeImport = ({ file, specifier }: Import): string => `${file} imports ${specifier}`;

// Shared code runs in pi and in bb, so it may use only Node and other files in src/.
const breaksSrcRule = ({ specifier, target }: Import): boolean =>
  target !== null ? !inside(target, "src") : !isBuiltin(specifier);

// pi loads the extension from the package, where only declared dependencies resolve: no zod, no bb SDK.
const breaksPiRule = ({ specifier, target }: Import): boolean => {
  if (target !== null) return !inside(target, "extensions/pi") && !inside(target, "src");
  return specifier === "zod" || specifier.startsWith("@get-bb/") || specifier.startsWith("pi-burn");
};

const breaksBbRule = ({ specifier, target }: Import): boolean => {
  if (target !== null) return !inside(target, "extensions/bb") && !inside(target, "src");
  return specifier.startsWith("@earendil-works/") || specifier.startsWith("pi-burn");
};

describe("repository layout", () => {
  it("keeps shared src/ on Node built-ins and its own files", () => {
    expect(importsUnder("src").filter(breaksSrcRule).map(describeImport)).toEqual([]);
  });

  it("keeps the pi extension off zod, the bb SDK and extensions/bb", () => {
    expect(importsUnder("extensions/pi").filter(breaksPiRule).map(describeImport)).toEqual([]);
  });

  it("keeps the bb plugin off pi's packages and extensions/pi", () => {
    expect(importsUnder("extensions/bb").filter(breaksBbRule).map(describeImport)).toEqual([]);
  });

  it("points the manifests at files that exist in their extension", () => {
    const entries: [string, string][] = [
      ...manifest.pi.extensions.map((entry: string) => [entry, "extensions/pi"] as [string, string]),
      [manifest.bb.server, "extensions/bb"],
      [manifest.bb.app, "extensions/bb"],
    ];
    for (const [entry, dir] of entries) {
      const path = join(ROOT, entry);
      expect(existsSync(path) && statSync(path).isFile(), entry).toBe(true);
      expect(inside(relative(ROOT, path), dir), entry).toBe(true);
    }
  });

  it("ships only src and the pi extension in the npm package", () => {
    const files = (manifest.files as string[]).map((entry) => entry.replace(/^\.\//, ""));
    expect(files).toEqual(expect.arrayContaining(["src/", "extensions/pi/"]));
    expect(files.filter((entry) => /^(extensions\/?$|extensions\/bb|test)/.test(entry))).toEqual([]);
  });

  it("gives extensions/bb no index file that pi could load as an extension", () => {
    expect(readdirSync(join(ROOT, "extensions/bb")).filter((name) => /^index\.[cm]?[jt]sx?$/.test(name))).toEqual([]);
  });

  it("keeps zod the only runtime dependency", () => {
    expect(Object.keys(manifest.dependencies)).toEqual(["zod"]);
  });
});
