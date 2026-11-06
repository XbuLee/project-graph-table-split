import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { encode, decode } from "@msgpack/msgpack";
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const metadata = JSON.parse(await readFile(join(root, "metadata.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${manifest.version}`) {
  throw new Error("Release 标签必须与 package.json 中的版本一致");
}
for (const [key, expected] of Object.entries({ id: manifest.name, name: manifest.displayName, version: manifest.version, description: manifest.description, author: manifest.author })) {
  if (metadata.extension[key] !== expected) throw new Error(`package.json 与 metadata.json 的 ${key} 不一致`);
}
const bytes = encode(metadata);
await writeFile(join(root, "metadata.msgpack"), bytes);
const writer = new ZipWriter(new Uint8ArrayWriter());
for (const name of ["metadata.msgpack", "extension.js", "README.md", "LICENSE"]) {
  await writer.add(name, new Uint8ArrayReader(await readFile(join(root, name))));
}
await mkdir(join(root, "dist"), { recursive: true });
const output = join(root, "dist", `${metadata.extension.id}.prg`);
const versionedOutput = join(root, "dist", `${metadata.extension.id}-v${metadata.extension.version}.prg`);
await writeFile(output, await writer.close());
await copyFile(output, versionedOutput);
const reader = new ZipReader(new Uint8ArrayReader(await readFile(output)));
try {
  const entries = await reader.getEntries();
  const entry = entries.find((item) => item.filename === "metadata.msgpack");
  const decoded = decode(await entry.getData(new Uint8ArrayWriter()));
  if (decoded.extension.id !== manifest.name || decoded.extension.version !== manifest.version) throw new Error("安装包元数据校验失败");
  if (entries.length !== 4 || entries.some((item) => item.filename.includes("/"))) throw new Error("安装包根目录结构不符合扩展规范");
} finally {
  await reader.close();
}
console.log(output);
console.log(versionedOutput);
const sourceFiles = [
  ".gitignore", ".github/workflows/release.yml", "package.json", "package-lock.json",
  "extension.js", "metadata.json", "metadata.msgpack", "package.mjs", "test.mjs",
  "README.md", "PUBLISHING.md", "CHANGELOG.md", "LICENSE",
];
const sourceWriter = new ZipWriter(new Uint8ArrayWriter());
for (const name of sourceFiles) {
  await sourceWriter.add(name, new Uint8ArrayReader(await readFile(join(root, name))));
}
const sourceOutput = join(root, "dist", `project-graph-table-split-v${manifest.version}-source.zip`);
await writeFile(sourceOutput, await sourceWriter.close());
console.log(sourceOutput);
