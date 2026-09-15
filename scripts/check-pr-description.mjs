#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TLDR_HEADING_RE = /^##\s+tl;dr\s*$/;
const PROBLEM_HEADING_RE = /^##\s+The Problem\s*$/;
const SOLUTION_HEADING_RE = /^##\s+The Solution\s*$/;
const H2_HEADING_RE = /^##\s/;
const CHECKLIST_HEADING_RE = /^##\s+Ship Checklist\s*$/;
// Review bots append their own summary section to the body; it is not authored here.
const BOT_SUMMARY_HEADING_RE = /^##\s+Summary by\b/i;
const PLACEHOLDER_RE =
  /\[(?:Two to four plain sentences|Describe the problem|Explain how this PR solves|One line per check|List commands and results)/;
const CODE_BLOCK_MARKER = "PR_DESCRIPTION_FENCED_CODE";
const INLINE_CODE_MARKER = "PR_DESCRIPTION_INLINE_CODE";
const TLDR_WORD_LIMIT = 80;
const BODY_WORD_LIMIT = 400;

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

function previousLineIsBlank(body, lineStart) {
  if (lineStart === 0) return true;
  const previousLineEnd = lineStart - 1;
  const previousLineStart = body.lastIndexOf("\n", previousLineEnd - 1) + 1;
  return /^\s*$/.test(body.slice(previousLineStart, previousLineEnd));
}

function isIndentedCodeLine(line) {
  return /^(?: {4}|\t)/.test(line);
}

function maskNonStructuralMarkdown(body) {
  let output = "";
  let cursor = 0;
  let inComment = false;
  let inIndentedCode = false;
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

      if (inIndentedCode) {
        if (/^\s*$/.test(line) || isIndentedCodeLine(line)) {
          if (!/^\s*$/.test(line)) output += CODE_BLOCK_MARKER;
          if (newline !== -1) output += "\n";
          cursor = newline === -1 ? body.length : newline + 1;
          continue;
        }
        inIndentedCode = false;
      }

      if (isIndentedCodeLine(line) && previousLineIsBlank(body, cursor)) {
        inIndentedCode = true;
        output += CODE_BLOCK_MARKER;
        if (newline !== -1) output += "\n";
        cursor = newline === -1 ? body.length : newline + 1;
        continue;
      }

      const opening = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
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
  return linesOf(body).filter((line) => H2_HEADING_RE.test(line));
}

// Fenced and indented code are replaced by a marker line, so dropping the
// marker drops the whole block. One inline-code span stays as a single word.
function countWords(text) {
  return text
    .replaceAll(CODE_BLOCK_MARKER, " ")
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function tldrSection(structure) {
  const lines = linesOf(structure);
  const start = lines.findIndex((line) => TLDR_HEADING_RE.test(line));
  if (start === -1) return "";

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => H2_HEADING_RE.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The ceiling measures what the author wrote: the ship checklist, HTML
// comments, code, and bot-appended summary sections do not count.
function authoredBody(structure) {
  const kept = [];
  let skipping = false;

  for (const line of linesOf(structure)) {
    if (H2_HEADING_RE.test(line)) {
      skipping =
        CHECKLIST_HEADING_RE.test(line) || BOT_SUMMARY_HEADING_RE.test(line);
    }
    if (!skipping) kept.push(line);
  }

  return kept.join("\n");
}

export function validatePrDescription(body) {
  if (body.trim() === "") {
    return {
      ok: false,
      message:
        "PR description is empty. It must start with '## tl;dr', then '## The Problem' and '## The Solution'.",
    };
  }

  // A single state machine preserves Markdown precedence: fenced/indented
  // code and inline code mask comment-like text only when they begin outside
  // an HTML comment.
  const { body: structure, hasUnclosedFence } = maskNonStructuralMarkdown(body);

  if (hasUnclosedFence) {
    return {
      ok: false,
      message:
        "PR description contains an unclosed fenced code block. Close it before the required sections.",
    };
  }

  if (PLACEHOLDER_RE.test(structure)) {
    return {
      ok: false,
      message:
        "PR description still contains template placeholders. Replace each bracketed prompt with real content.",
    };
  }

  const firstLine = firstNonBlankLine(structure);
  if (!TLDR_HEADING_RE.test(firstLine)) {
    return {
      ok: false,
      message:
        "PR description must start with '## tl;dr' as its first section, written exactly like that. Only HTML comments may precede it.",
    };
  }

  const headings = h2Headings(structure);
  if (
    !PROBLEM_HEADING_RE.test(headings[1] ?? "") ||
    !SOLUTION_HEADING_RE.test(headings[2] ?? "")
  ) {
    return {
      ok: false,
      message:
        "PR description must place exact '## The Problem' then '## The Solution' headings as the two sections after '## tl;dr'.",
    };
  }

  const tldrWords = countWords(tldrSection(structure));
  if (tldrWords === 0) {
    return {
      ok: false,
      message:
        "tl;dr section is empty. Write two to four plain-language sentences under '## tl;dr'.",
    };
  }

  if (tldrWords > TLDR_WORD_LIMIT) {
    return {
      ok: false,
      message: `tl;dr is ${tldrWords} words; keep it to ${TLDR_WORD_LIMIT}.`,
    };
  }

  const bodyWords = countWords(authoredBody(structure));
  if (bodyWords > BODY_WORD_LIMIT) {
    return {
      ok: false,
      message: `PR description is ${bodyWords} authored words; the ceiling is ${BODY_WORD_LIMIT} (checklist, comments, code and bot summaries excluded).`,
    };
  }

  return {
    ok: true,
    message: `PR description OK: it starts with '## tl;dr' (${tldrWords} words), then '## The Problem' and '## The Solution', runs ${bodyWords} authored words, and has no template placeholders.`,
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
