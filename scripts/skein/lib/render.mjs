#!/usr/bin/env node
// Render a template: node render.mjs <in> <out> KEY=value ...  ({{KEY}} placeholders).
// Unknown placeholders are left as-is so a template can carry literal braces.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const [input, output, ...pairs] = process.argv.slice(2);
if (!input || !output) { console.error("usage: render.mjs <in> <out> KEY=value ..."); process.exit(2); }
const vars = Object.fromEntries(pairs.map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)]; }));
let text = readFileSync(input, "utf8");
text = text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, text);
