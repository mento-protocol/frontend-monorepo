#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROBLEM_HEADING_RE = /^##\s+The Problem\s*$/;
const SOLUTION_HEADING_RE = /^##\s+The Solution\s*$/;
const PLACEHOLDER_RE =
  /\[(?:Describe the problem|Explain how this PR solves|List commands and results)/;

function linesOf(body) {
  return body.split(/\r?\n/);
}

function stripHtmlComments(body) {
  let inComment = false;
  const kept = [];

  for (const originalLine of linesOf(body)) {
    let line = originalLine;
    let output = "";
    let strippedComment = false;

    while (line !== "") {
      if (inComment) {
        const close = line.indexOf("-->");
        if (close === -1) break;
        inComment = false;
        strippedComment = true;
        line = line.slice(close + 3);
        continue;
      }

      const open = line.indexOf("<!--");
      if (open === -1) {
        output += line;
        break;
      }

      output += line.slice(0, open);
      strippedComment = true;
      const close = line.indexOf("-->", open + 4);
      if (close === -1) {
        inComment = true;
        break;
      }
      line = line.slice(close + 3);
    }

    if (strippedComment && output.trim() === "") continue;
    kept.push(strippedComment ? output.trimStart() : output);
  }

  return kept.join("\n");
}

function stripFencedBlocks(body) {
  let fence = null;
  const kept = [];

  for (const line of linesOf(body)) {
    if (fence === null) {
      const opening = /^\s*(`{3,}|~{3,})/.exec(line);
      if (opening) {
        fence = { character: opening[1][0], length: opening[1].length };
        continue;
      }
      kept.push(line);
      continue;
    }

    const escaped = fence.character === "`" ? "`" : "~";
    const closing = new RegExp(`^\\s*${escaped}{${fence.length},}\\s*$`);
    if (closing.test(line)) fence = null;
  }

  return { body: kept.join("\n"), hasUnclosedFence: fence !== null };
}

function firstNonBlankLine(body) {
  return linesOf(body).find((line) => line.trim() !== "") ?? "";
}

function h2Headings(body) {
  return linesOf(body).filter((line) => /^##\s/.test(line));
}

export function validatePrDescription(body) {
  if (body.trim() === "") {
    return {
      ok: false,
      message:
        "PR description is empty. It must start with '## The Problem' then '## The Solution'.",
    };
  }

  if (PLACEHOLDER_RE.test(body)) {
    return {
      ok: false,
      message:
        "PR description still contains template placeholders. Replace each bracketed prompt with real content.",
    };
  }

  const commentStripped = stripHtmlComments(body);
  const firstLine = firstNonBlankLine(commentStripped);
  const { body: fenceStripped, hasUnclosedFence } =
    stripFencedBlocks(commentStripped);

  if (hasUnclosedFence) {
    return {
      ok: false,
      message:
        "PR description contains an unclosed fenced code block. Close it before the required sections.",
    };
  }

  const secondHeading = h2Headings(fenceStripped)[1] ?? "";
  if (
    !PROBLEM_HEADING_RE.test(firstLine) ||
    !SOLUTION_HEADING_RE.test(secondHeading)
  ) {
    return {
      ok: false,
      message:
        "PR description must start with exact '## The Problem' then '## The Solution' headings as its first two sections. Only HTML comments may precede '## The Problem'.",
    };
  }

  return {
    ok: true,
    message:
      "PR description OK: it starts with '## The Problem' then '## The Solution' and has no template placeholders.",
  };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  // Workflow-local input, not a Turbo task dependency.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const result = validatePrDescription(process.env.PR_BODY ?? "");
  if (result.ok) {
    console.log(result.message);
  } else {
    console.log(`::error::${result.message}`);
    process.exitCode = 1;
  }
}
