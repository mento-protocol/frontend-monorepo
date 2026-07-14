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
  return `## The Problem

- Reviewers need consistent context for every change.

## The Solution

- Validate the two required opening sections in CI.
${extra}`;
}

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
        "[Describe the problem, user impact, or maintenance risk this PR addresses.]",
        "Existing PR descriptions do not provide consistent context.",
      )
      .replace(
        "[Explain how this PR solves the problem in plain English.]",
        "Validate the required opening sections in CI.",
      )
      .replace(
        "[List commands and results, plus any manual verification.]",
        "node scripts/check-pr-description.test.mjs",
      ),
  );
});

test("allows HTML comments before the opening heading", () => {
  assertPass(`<!-- markdownlint-disable MD041 -->\n\n${validBody()}`);
});

test("allows trailing heading whitespace and CRLF newlines", () => {
  assertPass(
    validBody().replaceAll("\n", "\r\n").replace("Problem\r", "Problem  \r"),
  );
});

test("fails an empty body", () => {
  assertFail(" \n", /PR description is empty/);
});

test("fails unfilled template placeholders", () => {
  assertFail(
    validBody(`

- [List commands and results, plus any manual verification.]
`),
    /template placeholders/,
  );
});

test("allows template prompt text when rendered as code or hidden in a comment", () => {
  assertPass(
    validBody(`

## Validation

- Example: \`[List commands and results, plus any manual verification.]\`

\`\`\`md
[Describe the problem, user impact, or maintenance risk this PR addresses.]
\`\`\`

<!-- [Explain how this PR solves the problem in plain English.] -->
`),
  );
});

test("fails content before The Problem", () => {
  assertFail(
    `# Summary\n\n${validBody()}`,
    /must start with exact '## The Problem'/,
  );
});

test("fails when The Solution is not the second H2 section", () => {
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
    `## The Solution\n\nFirst.\n\n## The Problem\n\nSecond.\n`,
    /must start with exact '## The Problem'/,
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
      /must start with exact '## The Problem'/,
    );
  }
});

test("does not count a fenced heading as The Solution", () => {
  assertFail(
    `## The Problem

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
    `## The Problem

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
    `## The Problem

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
    `## The Problem

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
    `## The Problem

\`<!--
still rendered as code -->\`

## The Solution

Implementation.
`,
  );
});

test("allows inline code to span an indented paragraph continuation", () => {
  assertFail(
    `## The Problem

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
    `## The Problem

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
    /must start with exact '## The Problem'/,
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
## The Problem
## The Solution
-->

## Summary
`,
    /must start with exact '## The Problem'/,
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
  assert.match(error.stdout, /must start with exact '## The Problem'/);
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
