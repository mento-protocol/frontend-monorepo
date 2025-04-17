#!/usr/bin/env node
/* eslint-env node */

import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "../dist");

// Get all files in the dist directory
function getFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  let result = [];
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      result = result.concat(getFiles(fullPath));
    } else {
      const stats = fs.statSync(fullPath);
      result.push({
        path: fullPath.replace(distDir, ""),
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
      });
    }
  }

  return result;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(2) + " KB";
  const mb = kb / 1024;
  return mb.toFixed(2) + " MB";
}

// Main function
function analyze() {
  console.log("📦 Analyzing build output...\n");

  if (!fs.existsSync(distDir)) {
    console.error("❌ Dist directory not found. Run a build first.");
    process.exit(1);
  }

  const files = getFiles(distDir);

  // Sort by size (largest first)
  files.sort((a, b) => b.size - a.size);

  console.log("📊 Build output size breakdown:");
  console.log("==============================\n");

  let totalSize = 0;

  files.forEach((file) => {
    console.log(`${file.sizeFormatted.padEnd(10)} ${file.path}`);
    totalSize += file.size;
  });

  console.log("\n==============================");
  console.log(`📦 Total size: ${formatSize(totalSize)}`);
}

analyze();
