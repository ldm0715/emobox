#!/usr/bin/env node
/**
 * 生成应用内自动更新的清单 latest.json（Phase 27）。
 *
 * 前置：`npm run tauri build` 已产出 NSIS 安装包；CHANGES.md 已有本版本段落。
 *
 * 用法：
 *   node scripts/make-release-manifest.mjs [--out <path>] [--notes-file <path>]
 *
 * 步骤：
 *   1. 读 src-tauri/tauri.conf.json 的 version；
 *   2. 在 src-tauri/target/release/bundle/nsis/ 找 *-setup.exe（取唯一/最新）；
 *   3. 计算 SHA-256 与字节大小；
 *   4. 从 CHANGES.md 提取 `## vX.Y.Z` 段落作为 notes（markdown；缺失时告警并留空）；
 *   5. 写出 latest.json（url 指向 GitHub Release 下载直链）。
 *
 * 之后在 GitHub 上以 tag v{version} 发 Release，上传 setup.exe 与 latest.json。
 * 镜像源无需任何配置——应用按「镜像前缀 + 本文件里的 URL」拼接加速下载。
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONF_PATH = join(ROOT, "src-tauri", "tauri.conf.json");
const NSIS_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
const CHANGELOG_PATH = join(ROOT, "CHANGES.md");
const GITHUB_OWNER = "ldm0715";
const GITHUB_REPO = "emobox";

/** 解析简单的 `--key value` 命令行参数。 */
function parseArgs(argv) {
  const args = { out: null, notesFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i] ?? null;
    if (argv[i] === "--notes-file") args.notesFile = argv[++i] ?? null;
  }
  return args;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从 CHANGES.md 提取 `## vX.Y.Z` 段落（到下一个 `## ` 标题或文件尾）。 */
function extractNotes(changelog, version) {
  const heading = new RegExp(`^##\\s+v?${escapeRegExp(version)}(?:\\s|（|$)`, "m");
  const start = changelog.search(heading);
  if (start < 0) return null;
  const headingEnd = changelog.indexOf("\n", start);
  if (headingEnd < 0) return "";
  const next = changelog.slice(headingEnd + 1).search(/^##\s/m);
  const body =
    next < 0 ? changelog.slice(headingEnd + 1) : changelog.slice(headingEnd + 1, headingEnd + 1 + next);
  return body.trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));
  const version = conf.version;
  if (!version) throw new Error(`无法从 ${CONF_PATH} 读取 version`);

  let candidates;
  try {
    candidates = readdirSync(NSIS_DIR)
      .filter((name) => name.endsWith("-setup.exe"))
      .map((name) => join(NSIS_DIR, name))
      .filter((path) => statSync(path).isFile());
  } catch {
    throw new Error(`找不到 NSIS 产物目录：${NSIS_DIR}\n先运行 npm run tauri build`);
  }
  if (candidates.length === 0) {
    throw new Error(`${NSIS_DIR} 里没有 *-setup.exe；先运行 npm run tauri build`);
  }
  if (candidates.length > 1) {
    console.warn(`[warn] 发现 ${candidates.length} 个安装包，使用文件名包含 ${version} 的，否则用第一个`);
  }
  const setupPath =
    candidates.find((path) => path.includes(version)) ?? candidates[0];
  const setupName = setupPath.split(/[\\/]/).pop();

  const bytes = readFileSync(setupPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const size = bytes.length;

  let notes;
  if (args.notesFile) {
    notes = readFileSync(args.notesFile, "utf8").trim();
    console.log(`[info] notes 来自 --notes-file：${args.notesFile}`);
  } else {
    const extracted = extractNotes(readFileSync(CHANGELOG_PATH, "utf8"), version);
    if (extracted == null) {
      console.warn(
        `[warn] CHANGES.md 里没有 v${version} 段落（应为 "## v${version}（YYYY-MM-DD）"），notes 留空`,
      );
      notes = "";
    } else {
      notes = extracted;
    }
  }

  const manifest = {
    version,
    pubDate: new Date().toISOString(),
    notes,
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${setupName}`,
        sha256,
        size,
      },
    },
  };

  const outPath = args.out
    ? resolve(args.out)
    : join(NSIS_DIR, "latest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`[ok] 安装包：${setupName}（${(size / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`[ok] SHA-256：${sha256}`);
  console.log(`[ok] latest.json 已写出：${outPath}`);
  console.log(`[next] 在 GitHub 发布 tag v${version}，上传 ${setupName} 与 latest.json`);
}

main();
