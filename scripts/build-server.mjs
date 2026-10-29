import ts from "typescript";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const target = new URL("../server/generated/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ["domain", "progress-model"]) {
  const source = await readFile(
    new URL(`../src/${name}.ts`, import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });
  await writeFile(
    new URL(`${name}.mjs`, target),
    outputText.replaceAll('"./domain"', '"./domain.mjs"'),
  );
}
