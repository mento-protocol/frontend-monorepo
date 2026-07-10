#!/usr/bin/env node
/* eslint-env node */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "../src/theme.css");
const outputPath = path.join(__dirname, "../dist/theme.css");

function copyThemeCss() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);
}

copyThemeCss();

fs.watch(sourcePath, { persistent: true }, (eventType) => {
  if (eventType !== "change") return;
  copyThemeCss();
});

process.on("SIGINT", () => {
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});
