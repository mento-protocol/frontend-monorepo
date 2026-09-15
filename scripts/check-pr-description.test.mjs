import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validatePrDescription } from "./check-pr-description.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const relativeScriptPath = relative(
  repoRoot,
  fileURLToPath(new URL("./check-pr-description.mjs", import.meta.url)),
);
const pullRequestTemplate = readFileSync(
  new URL("../.github/pull_request_template.md", import.meta.url),
  "utf8",
);

function validBody(extra = "") {
  return `## tl;dr

Reviewers had no quick summary at the top of a PR. Every description now opens with a short plain-language recap.

## The Problem

- Reviewers need consistent context for every change.

## The Solution

- Validate the two required opening sections in CI.
${extra}`;
}

function filler(words) {
  return Array.from({ length: words }, () => "word").join(" ");
}

function bodyWithFiller(words) {
  return validBody(`
## Details

${filler(words)}
`);
}

// The validator reports the authored word count in both its pass and its
// over-ceiling message, so these fixtures size themselves against the real
// counter instead of hard-coding a count that drifts with the sample text.
function authoredWordCount(body) {
  const { message } = validatePrDescription(body);
  const match = /(\d+) authored words/.exec(message);
  assert.ok(match, `expected an authored word count in: ${message}`);
  return Number(match[1]);
}

const fillerForCeiling = 400 - (authoredWordCount(bodyWithFiller(1)) - 1);

function assertPass(body) {
  const result = validatePrDescription(body);
  assert.equal(result.ok, true, result.message);
}

function assertFail(body, expected) {
  const result = validatePrDescription(body);
  assert.equal(result.ok, false, "expected validation to fail");
  assert.match(result.message, expected);
}

test("passes the required headings followed by optional sections", () => {
  assertPass(
    validBody(`
## Validation

- node scripts/check-pr-description.test.mjs
`),
  );
});

test("keeps the repository template aligned with the validator", () => {
  assertFail(pullRequestTemplate, /template placeholders/);
  assertPass(
    pullRequestTemplate
      .replace(
        "[Two to four plain sentences: who had which problem, what changes, what to expect. About 60 words, no identifiers.]",
        "Reviewers had no quick summary at the top of a PR. Every description now opens with a short plain-language recap.",
      )
      .replace(
        "[Describe the problem, user impact, or maintenance risk this PR addresses.]",
        "Existing PR descriptions do not provide consistent context.",
      )
      .replace(
        "[Explain how this PR solves the problem in plain English.]",
        "Validate the required opening sections in CI.",
      )
      .replace(
        "[One line per check. Group passes: `pnpm test` 42 ✓, `pnpm lint` ✓. Skipped, failed, or not-proven items each get their own line.]",
        "node scripts/check-pr-description.test.mjs",
      ),
  );
});

test("allows HTML comments before the opening heading", () => {
  assertPass(`<!-- markdownlint-disable MD041 -->\n\n${validBody()}`);
});

test("allows trailing heading whitespace and CRLF newlines", () => {
  assertPass(
    validBody()
      .replaceAll("\n", "\r\n")
      .replace("tl;dr\r", "tl;dr  \r")
      .replace("Problem\r", "Problem  \r"),
  );
});

test("fails an empty body", () => {
  assertFail(" \n", /PR description is empty/);
});

test("fails unfilled template placeholders", () => {
  for (const placeholder of [
    "- [Two to four plain sentences: who had which problem, what changes, what to expect. About 60 words, no identifiers.]",
    "- [One line per check. Group passes: `pnpm test` 42 ✓, `pnpm lint` ✓. Skipped, failed, or not-proven items each get their own line.]",
    "- [List commands and results, plus any manual verification.]",
  ]) {
    assertFail(validBody(`\n${placeholder}\n`), /template placeholders/);
  }
});

test("allows template prompt text when rendered as code or hidden in a comment", () => {
  assertPass(
    validBody(`
## Validation

- Example: \`[One line per check. Group passes: 42 ✓.]\`

\`\`\`md
[Describe the problem, user impact, or maintenance risk this PR addresses.]
\`\`\`

<!-- [Explain how this PR solves the problem in plain English.] -->
`),
  );
});

test("fails a body without a tl;dr", () => {
  assertFail(
    `## The Problem

- Reviewers need consistent context for every change.

## The Solution

- Validate the two required opening sections in CI.
`,
    /must start with '## tl;dr'/,
  );
});

test("fails a tl;dr that is not the first section", () => {
  assertFail(
    `## The Problem

- Reviewers need consistent context for every change.

## tl;dr

Plain summary of the change.

## The Solution

- Validate the two required opening sections in CI.
`,
    /must start with '## tl;dr'/,
  );
});

test("fails content before the tl;dr", () => {
  assertFail(`# Summary\n\n${validBody()}`, /must start with '## tl;dr'/);
});

test("fails near-miss tl;dr headings", () => {
  for (const heading of [
    "### tl;dr",
    "# tl;dr",
    "## TL;DR",
    "## tl;dr:",
    "## tldr",
  ]) {
    assertFail(
      validBody().replace("## tl;dr", heading),
      /must start with '## tl;dr'/,
    );
  }
});

test("fails an empty tl;dr section", () => {
  assertFail(
    `## tl;dr

<!-- nothing written yet -->

## The Problem

- Reviewers need consistent context for every change.

## The Solution

- Validate the two required opening sections in CI.
`,
    /tl;dr section is empty/,
  );
});

test("fails a tl;dr over 80 words", () => {
  assertFail(
    validBody().replace(
      "Reviewers had no quick summary at the top of a PR. Every description now opens with a short plain-language recap.",
      filler(81),
    ),
    /tl;dr is 81 words; keep it to 80/,
  );
});

test("passes a body at exactly the 400-word ceiling", () => {
  const body = bodyWithFiller(fillerForCeiling);
  assert.equal(authoredWordCount(body), 400);
  assertPass(body);
});

test("fails a body one word over the 400-word ceiling", () => {
  assertFail(
    bodyWithFiller(fillerForCeiling + 1),
    /is 401 authored words; the ceiling is 400/,
  );
});

test("excludes the ship checklist and bot summaries from the word count", () => {
  const body = `${bodyWithFiller(fillerForCeiling)}
## Ship Checklist

- [ ] ${filler(200)}

## Summary by CodeRabbit

- ${filler(200)}
`;
  assert.equal(authoredWordCount(body), 400);
  assertPass(body);
});

test("counts a casing variant of the bot-summary heading", () => {
  const body = `${bodyWithFiller(fillerForCeiling)}
## summary by coderabbit

${filler(200)}
`;
  assert.equal(authoredWordCount(body), 603);
  assertFail(body, /is 603 authored words; the ceiling is 400/);
});

test("counts a section that only looks like a bot summary", () => {
  const body = `${bodyWithFiller(fillerForCeiling)}
## Summary by me

${filler(200)}
`;
  assert.equal(authoredWordCount(body), 603);
  assertFail(body, /is 603 authored words; the ceiling is 400/);
});

test("excludes blockquoted fenced code from the word count", () => {
  const body = `${bodyWithFiller(fillerForCeiling)}
> \`\`\`text
> ${filler(200)}
> \`\`\`
`;
  assert.equal(authoredWordCount(body), 400);
  assertPass(body);
});

test("excludes blockquoted indented code from the word count", () => {
  const afterPlainBlankLine = `${bodyWithFiller(fillerForCeiling)}
>     ${filler(200)}
`;
  assert.equal(authoredWordCount(afterPlainBlankLine), 400);
  assertPass(afterPlainBlankLine);

  // The blank line that opens the block carries the blockquote marker too.
  // Two filler words make room for the quoted lead-in line.
  const afterQuotedBlankLine = `${bodyWithFiller(fillerForCeiling - 2)}
> Quoted log:
>
>     ${filler(200)}
`;
  assert.equal(authoredWordCount(afterQuotedBlankLine), 400);
  assertPass(afterQuotedBlankLine);
});

test("does not count a blockquoted fenced heading as The Solution", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context.

> \`\`\`md
> ## The Solution
> \`\`\`

## Validation

- Tests pass.
`,
    /then '## The Solution'/,
  );
});

test("counts an inline-code span as one word, not its contents", () => {
  const plain = authoredWordCount(validBody("\n## Details\n\nalpha\n"));
  const spanned = authoredWordCount(
    validBody("\n## Details\n\n`alpha beta gamma`\n"),
  );
  assert.equal(spanned, plain);
});

test("counts inline-code spans left adjacent by a comment as two words", () => {
  const one = authoredWordCount(validBody("\n## Details\n\n`alpha`\n"));
  const two = authoredWordCount(
    validBody("\n## Details\n\n`alpha`<!-- note -->`beta`\n"),
  );
  assert.equal(two - one, 1);
});

test("fails when The Solution is not the third H2 section", () => {
  assertFail(
    validBody().replace(
      "## The Solution",
      "## Background\n\nContext.\n\n## The Solution",
    ),
    /then '## The Solution'/,
  );
});

test("fails swapped opening sections", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Solution

First.

## The Problem

Second.
`,
    /'## The Problem' then '## The Solution'/,
  );
});

test("fails near-miss required headings", () => {
  for (const heading of [
    "# The Problem",
    "## the Problem",
    "## The Problem:",
    "### The Problem",
  ]) {
    assertFail(
      validBody().replace("## The Problem", heading),
      /'## The Problem' then '## The Solution'/,
    );
  }
});

test("does not count a fenced heading as The Solution", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context.

\`\`\`md
## The Solution
\`\`\`

## Validation

- Tests pass.
`,
    /then '## The Solution'/,
  );
});

test("does not treat a t-prefixed fence as fenced code", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context.

t\`\`\`md
## Background
\`\`\`

## The Solution

Implementation.
`,
    /unclosed fenced code block/,
  );
});

test("does not treat HTML comment markers rendered as inline code as comments", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context.

\`<!--\`

## Background

More context.

\`-->\`

## The Solution

Implementation.
`,
    /then '## The Solution'/,
  );
});

test("does not pair inline-code delimiters across Markdown blocks", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context \`

## Background

Details \`

## The Solution

Implementation.
`,
    /then '## The Solution'/,
  );
});

test("allows inline code to span soft line breaks within one block", () => {
  assertPass(
    `## tl;dr

Plain summary of the change.

## The Problem

\`<!--
still rendered as code -->\`

## The Solution

Implementation.
`,
  );
});

test("allows inline code to span an indented paragraph continuation", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

\`code begins
    <!--
still rendered as code\`

## Background

\`-->\`

## The Solution

Implementation.
`,
    /then '## The Solution'/,
  );
});

test("does not interpret comment markers in indented code as HTML comments", () => {
  assertFail(
    `## tl;dr

Plain summary of the change.

## The Problem

Context.

    <!--

## Background

    -->

## The Solution

Implementation.
`,
    /then '## The Solution'/,
  );
});

test("closes HTML comments before interpreting backticks inside them", () => {
  assertFail(
    `<!--
\`-->\`

## Background

-->

${validBody()}`,
    /must start with '## tl;dr'/,
  );
});

test("ignores HTML comment markers and headings inside fenced code", () => {
  assertPass(
    validBody(`
## Details

\`\`\`md
<!--
## Example heading
-->
\`\`\`
`),
  );
});

test("fails an unclosed fenced block", () => {
  assertFail(
    validBody(`
## Details

\`\`\`text
unfinished
`),
    /unclosed fenced code block/,
  );
});

test("ignores required headings inside HTML comments", () => {
  assertFail(
    `<!--
## tl;dr
## The Problem
## The Solution
-->

## Summary
`,
    /must start with '## tl;dr'/,
  );
});

test("CLI guard rejects an invalid body from a relative script path", () => {
  let error;
  try {
    execFileSync(process.execPath, [relativeScriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PR_BODY: "# Summary\n" },
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error, "expected CLI validation to fail");
  assert.match(error.stdout, /must start with '## tl;dr'/);
});

test("CLI guard accepts a valid body from a relative script path", () => {
  const output = execFileSync(process.execPath, [relativeScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PR_BODY: validBody() },
  });
  assert.match(output, /PR description OK/);
});

test("CLI guard accepts a valid body from stdin", () => {
  const environment = { ...process.env };
  delete environment.PR_BODY;
  const output = execFileSync(process.execPath, [relativeScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: environment,
    input: validBody(),
  });
  assert.match(output, /PR description OK/);
});
