#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROBLEM_HEADING_RE = /^##\s+The Problem\s*$/;
const SOLUTION_HEADING_RE = /^##\s+The Solution\s*$/;
const PLACEHOLDER_RE =
  /\[(?:Describe the problem|Explain how this PR solves|List commands and results)/;
const CODE_BLOCK_MARKER = "PR_DESCRIPTION_FENCED_CODE";
const INLINE_CODE_MARKER = "PR_DESCRIPTION_INLINE_CODE";

function linesOf(body) {
  return body.split(/\r?\n/);
}

function backtickRunLength(body, start) {
  let end = start;
  while (body[end] === "`") end += 1;
  return end - start;
}

function isInlineBlockBoundary(line) {
  return (
    /^\s*$/.test(line) ||
    /^[ \t]{0,3}(?:#{1,6}(?:[ \t]+|$)|`{3,}|~{3,}|>|<!--)/.test(line) ||
    /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(line)
  );
}

function inlineBlockEnd(body, start) {
  let newline = body.indexOf("\n", start);

  while (newline !== -1) {
    const nextLineStart = newline + 1;
    const nextNewline = body.indexOf("\n", nextLineStart);
    const nextLineEnd = nextNewline === -1 ? body.length : nextNewline;
    const rawLine = body.slice(nextLineStart, nextLineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (isInlineBlockBoundary(line)) return newline;
    newline = nextNewline;
  }

  return body.length;
}

function findClosingBackticks(body, start, length, end) {
  let cursor = start;

  while (cursor < end) {
    const candidate = body.indexOf("`", cursor);
    if (candidate === -1 || candidate >= end) return -1;
    const candidateLength = backtickRunLength(body, candidate);
    if (candidateLength === length) return candidate;
    cursor = candidate + candidateLength;
  }

  return -1;
}

function maskNonStructuralMarkdown(body) {
  let output = "";
  let cursor = 0;
  let inComment = false;
  let fence = null;

  while (cursor < body.length) {
    if (fence !== null) {
      const newline = body.indexOf("\n", cursor);
      const lineEnd = newline === -1 ? body.length : newline;
      const rawLine = body.slice(cursor, lineEnd);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const closing = new RegExp(
        `^[ \\t]{0,3}${fence.character}{${fence.length},}[ \\t]*$`,
      );
      if (closing.test(line)) fence = null;
      if (newline !== -1) output += "\n";
      cursor = newline === -1 ? body.length : newline + 1;
      continue;
    }

    if (inComment) {
      if (body.startsWith("-->", cursor)) {
        inComment = false;
        cursor += 3;
      } else {
        if (body[cursor] === "\n") output += "\n";
        cursor += 1;
      }
      continue;
    }

    const atLineStart = cursor === 0 || body[cursor - 1] === "\n";
    if (atLineStart) {
      const newline = body.indexOf("\n", cursor);
      const lineEnd = newline === -1 ? body.length : newline;
      const rawLine = body.slice(cursor, lineEnd);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const opening = /^[ \\t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (opening) {
        fence = { character: opening[1][0], length: opening[1].length };
        output += CODE_BLOCK_MARKER;
        if (newline !== -1) output += "\n";
        cursor = newline === -1 ? body.length : newline + 1;
        continue;
      }
    }

    if (body.startsWith("<!--", cursor)) {
      inComment = true;
      cursor += 4;
      continue;
    }

    if (body[cursor] !== "`") {
      output += body[cursor];
      cursor += 1;
      continue;
    }

    const openingLength = backtickRunLength(body, cursor);
    const contentStart = cursor + openingLength;
    const closing = findClosingBackticks(
      body,
      contentStart,
      openingLength,
      inlineBlockEnd(body, contentStart),
    );
    if (closing === -1) {
      output += "`".repeat(openingLength);
      cursor = contentStart;
      continue;
    }

    const codeContent = body.slice(contentStart, closing);
    output += INLINE_CODE_MARKER;
    output += "\n".repeat(codeContent.split("\n").length - 1);
    cursor = closing + openingLength;
  }

  return { body: output, hasUnclosedFence: fence !== null };
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

  // A single state machine preserves Markdown precedence: fences and inline
  // code mask comment-like text only when they begin outside an HTML comment.
  const { body: structure, hasUnclosedFence } = maskNonStructuralMarkdown(body);

  if (hasUnclosedFence) {
    return {
      ok: false,
      message:
        "PR description contains an unclosed fenced code block. Close it before the required sections.",
    };
  }

  const firstLine = firstNonBlankLine(structure);
  const secondHeading = h2Headings(structure)[1] ?? "";
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

function readCliBody() {
  // Workflow-local input, not a Turbo task dependency.

  if (Object.hasOwn(process.env, "PR_BODY")) {
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    return process.env.PR_BODY ?? "";
  }

  return process.stdin.isTTY ? "" : readFileSync(0, "utf8");
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const result = validatePrDescription(readCliBody());
  if (result.ok) {
    console.log(result.message);
  } else {
    console.log(`::error::${result.message}`);
    process.exitCode = 1;
  }
}
