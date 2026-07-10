#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "../src/theme.css");
const sourceDir = path.dirname(sourcePath);
const sourceFile = path.basename(sourcePath);
const outputPath = path.join(__dirname, "../dist/theme.css");
let copyTimeout;

function copyThemeCss() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);
}

function scheduleCopyThemeCss() {
  clearTimeout(copyTimeout);
  copyTimeout = setTimeout(() => {
    if (fs.existsSync(sourcePath)) {
      copyThemeCss();
    }
  }, 25);
}

copyThemeCss();

const watcher = fs.watch(sourceDir, { persistent: true }, (eventType, file) => {
  if (file && file.toString() !== sourceFile) return;
  if (eventType !== "change" && eventType !== "rename") return;
  scheduleCopyThemeCss();
});

function shutdown() {
  clearTimeout(copyTimeout);
  watcher.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
