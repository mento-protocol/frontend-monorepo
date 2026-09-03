import process from "node:process";

import { collectOsvFindings } from "./osv-findings.mjs";

const TRACKED_EVENTS = new Set([
  "push",
  "schedule",
  "workflow_dispatch",
  "workflow_run",
]);
const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
]);
const NOTIFIER_WORKFLOW_NAME = "CI Failure Notifier";
const TAG_PUSH_WORKFLOW_NAMES = new Set(["Publish UI Package"]);
const VERCEL_MAIN_WORKFLOW_NAME = "Vercel Main Deployment";

// The managed issue reports GitHub's own structured job and step names and
// never quotes job log output. Log text is attacker-influenceable: a failing
// job can print whatever a dependency, a test fixture, or an environment dump
// puts in front of it, and no line-level redaction survives a credential value
// that carries no keyword of its own or is split across lines. Line-based
// selectors are just as weak: a runner's error annotations and a scanner's
// table syntax are printable by the same job, so choosing lines by that
// structure lets the job choose what gets published. Nothing read from a log
// reaches this issue. `scripts/ci-failure-issue.test.mjs` pins that on source.
//
// Naming the vulnerable package is the one exception, and it is not an
// exception to that rule: the findings table below comes from the scanner's own
// `--format=json` artifact via `./osv-findings.mjs`, which reads no log either.
// That module hands back only scalar fields, and every one of them is
// sanitized and quoted here, by the same helpers every other field uses.
const MAX_REPORTED_JOBS = 10;
const MAX_REPORTED_STEPS = 10;
const MAX_FIELD_CHARS = 200;
const BODY_MAX_BYTES = 60 * 1024;
// The notifier job is capped at five minutes; the job listing is the only
// evidence call left, and a stalled one must not consume that budget.
const JOB_LIST_DEADLINE_MS = 20_000;

// Applied only to a degradation reason, which is the one free-text field an
// external system can still put in the body.
const SECRET_PATTERN =
  /token|secret|password|passwd|bearer|authorization|ghp_|ghs_|gho_|ghu_|ghr_|github_pat_|-----BEGIN/i;
// Control and format characters are removed rather than escaped: a newline in a
// rendered field could otherwise forge the managed marker on its own line.
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/gu;
const MARKDOWN_ESCAPE_PATTERN = /([\\`*_[\]<>])/g;

const textEncoder = new TextEncoder();

function byteLength(text) {
  return textEncoder.encode(text).length;
}

function runPosition(run) {
  return [run.run_number ?? 0, run.run_attempt ?? 1];
}

function compareRuns(left, right) {
  const [leftNumber, leftAttempt] = runPosition(left);
  const [rightNumber, rightAttempt] = runPosition(right);
  return leftNumber - rightNumber || leftAttempt - rightAttempt;
}

function isDecisiveRun(run) {
  return (
    run.conclusion === "success" || FAILURE_CONCLUSIONS.has(run.conclusion)
  );
}

function runIdentity(run) {
  const runId = run.id ?? `${run.workflow_id}:${run.run_number ?? 0}`;
  return `${runId}:${run.run_attempt ?? 1}`;
}

function targetRefFor(run, defaultBranch) {
  return (
    run.head_branch || (run.event === "push" ? "release tag" : defaultBranch)
  );
}

function partitionIdentity(run, defaultBranch) {
  return [run.workflow_id, run.event, targetRefFor(run, defaultBranch)]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

function markerFor(run, defaultBranch) {
  return `<!-- managed-ci-failure:${partitionIdentity(run, defaultBranch)} -->`;
}

function runLink(run) {
  return `[run #${run.run_number}, attempt ${run.run_attempt ?? 1}](${run.html_url})`;
}

/**
 * A workflow name is set by a workflow file, the same trust class as the job
 * and step names it sits beside, so it is sanitized the same way. The issue
 * title takes this plain form because GitHub renders a title as text; the body
 * quotes it with `codeSpan`.
 */
function workflowNameFor(run) {
  return sanitizeField(run.name, "unnamed workflow");
}

function issueTitle(run, targetRef) {
  const workflowName = workflowNameFor(run);
  return `CI: ${workflowName} is failing (${targetRef}; ${run.event})`.slice(
    0,
    255,
  );
}

/**
 * Flatten one API-supplied name onto a single capped line: strip the control
 * and format characters, collapse the whitespace, and cap the length. Dropping
 * the control characters is what stops a name forging the managed marker on a
 * line of its own. The result still carries its literal Markdown specials, so
 * it is safe only where Markdown is not interpreted, or where the caller
 * quotes it.
 */
function sanitizeField(value, fallback = "") {
  const flattened = String(value ?? "")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length === 0) return fallback;
  return flattened.length > MAX_FIELD_CHARS
    ? `${flattened.slice(0, MAX_FIELD_CHARS)}…`
    : flattened;
}

/**
 * Render one API-supplied value as Markdown text: sanitize it, then escape the
 * Markdown specials. Only the degradation note uses this; every name is quoted
 * with `codeSpan` instead, because escaping leaves a mention, an autolink and
 * a bare URL live, and a backslash is literal inside a code span anyway.
 */
export function renderField(value, fallback = "") {
  return sanitizeField(value, fallback).replace(
    MARKDOWN_ESCAPE_PATTERN,
    "\\$1",
  );
}

/**
 * Quote already-sanitized text as a code span, which renders it verbatim and
 * leaves no mention, autolink or emphasis live. CommonMark closes a span at
 * the first backtick run as long as the one that opened it, and a backslash is
 * literal in between, so the delimiter has to be longer than every run in the
 * text. Text that starts or ends with a backtick also takes one space of
 * padding, which the renderer strips back off.
 */
function codeSpan(text) {
  const value = String(text);
  const longestRun = (value.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const delimiter = "`".repeat(longestRun + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

/** Only an https GitHub URL from the API is ever linked. */
function safeJobUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// A fence delimiter, opener and closer alike, is a line indented by at most
// three ASCII spaces, exactly as GitHub reads one. A deeper indent is not the
// conservative direction here, because it inverts the fence state rather than
// widening it: given a four-space delimiter, then a bare one, then the marker,
// GitHub reads the first line as indented code and the second as the real
// opener, leaving the marker inside a block, while a scanner that opens on the
// first line closes on the second and reads the marker at root level.
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// GFM allows only spaces and tabs after a closing delimiter. Unicode blanks
// such as U+00A0 leave the fence open, which is the fail-closed direction.
const ASCII_BLANK_PATTERN = /^[ \t]*$/;
// Raw HTML, refused rather than parsed. GFM has seven HTML block types with
// their own interruption rules, and a marker quoted inside <pre>, <div>,
// <table> or a comment that spans lines renders as text while a line scanner
// still sees it at root level. The notifier writes no line that opens with
// `<` except the marker itself, so refusing every other one costs nothing.
const HTML_LINE_PATTERN = /^[^\S\r\n]*</;

/**
 * Read one line as a CommonMark fence delimiter, or `undefined` when it is not
 * one. A backtick opener may not carry a backtick in its info string, and only
 * a bare delimiter closes a fence, so a line with trailing text is content.
 */
function fenceOn(line) {
  const match = FENCE_LINE_PATTERN.exec(line);
  if (match === null) return undefined;
  const [, run, rest] = match;
  if (run.startsWith("`") && rest.includes("`")) return undefined;
  return {
    character: run[0],
    length: run.length,
    closes: ASCII_BLANK_PATTERN.test(rest),
  };
}

/** The split above already consumed the CR that ended a CRLF line. */
function stripCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Does `body` carry `marker` as a line of its own, outside any fenced block?
 * Substring matching would let any quoted text route a later failure into the
 * wrong issue, so the marker only counts where the notifier writes it: as an
 * exact root-level line. The notifier never indents or pads it, while GFM reads
 * an indented copy as a list-item continuation or an indented code block, so
 * anything but an exact match is a quotation.
 */
export function markerLineIndex(body, marker) {
  if (typeof body !== "string") return -1;
  const lines = body.split(/\r?\n/).map(stripCarriageReturn);

  // Any raw HTML anywhere fails the whole body closed, wherever it sits
  // relative to the marker: an unclosed block reaches forward, and a comment
  // that opens on one line swallows every line until it ends.
  if (lines.some((line) => line !== marker && HTML_LINE_PATTERN.test(line))) {
    return -1;
  }

  let open;
  for (const [index, line] of lines.entries()) {
    const fence = fenceOn(line);
    if (open === undefined) {
      if (fence !== undefined) {
        open = fence;
        continue;
      }
      if (line === marker) return index;
      continue;
    }
    // Only the opener's own character, at its own length or longer, closes it.
    // Any other delimiter is content, so a `~~~` line inside a backtick fence
    // cannot hand the marker back out.
    if (
      fence !== undefined &&
      fence.closes &&
      fence.character === open.character &&
      fence.length >= open.length
    ) {
      open = undefined;
    }
  }
  return -1;
}

export function bodyCarriesMarker(body, marker) {
  return markerLineIndex(body, marker) !== -1;
}

function degradationReason(error) {
  const raw =
    (error?.status ? `HTTP ${error.status}` : "") ||
    error?.message ||
    String(error);
  // Scan the whole flattened message before shortening it: truncating first
  // would drop a keyword past the cap and publish a value that sat before it.
  const flattened = String(raw)
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length === 0) return "unknown error";
  if (SECRET_PATTERN.test(flattened)) return "redacted error";
  return renderField(flattened.slice(0, MAX_FIELD_CHARS), "unknown error");
}

function failedStepsFor(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const failed = steps.filter((step) =>
    FAILURE_CONCLUSIONS.has(step?.conclusion),
  );
  return {
    // `renderFailedJob` quotes these as code spans, so they keep their literal
    // Markdown specials: escaping here would only print the backslashes.
    names: failed
      .slice(0, MAX_REPORTED_STEPS)
      .map((step, index) => sanitizeField(step?.name, `step ${index + 1}`)),
    // Counted, never silently dropped: a job with many failing `if: always()`
    // cleanup steps would otherwise read as a complete list.
    omitted: Math.max(0, failed.length - MAX_REPORTED_STEPS),
  };
}

/**
 * Collect the failed jobs of `run` from the workflow-jobs API. This reads only
 * GitHub's own structure — job names, step names, conclusions — and downloads
 * no logs. Every failure degrades into a note on the issue; the notifier itself
 * never fails because evidence could not be read.
 */
export async function collectFailureEvidence(
  github,
  repo,
  run,
  core,
  { listDeadlineMs = JOB_LIST_DEADLINE_MS } = {},
) {
  if (!run?.id) {
    return { jobs: [], note: "the failed run exposed no job list" };
  }

  let allJobs;
  try {
    allJobs = await github.paginate(
      github.rest.actions.listJobsForWorkflowRun,
      {
        ...repo,
        run_id: run.id,
        // Not `latest`: GitHub defines that as the newest execution, so a rerun
        // that starts before this callback reconciles would hand back the new
        // attempt's jobs while the issue names the completed one. Ask for every
        // attempt and select the reconciled one below.
        filter: "all",
        per_page: 100,
        // A stalled listing would otherwise consume the whole job before the
        // deadline is ever consulted, and no issue would be written at all.
        request: { signal: AbortSignal.timeout(listDeadlineMs) },
      },
    );
  } catch (error) {
    core?.warning?.(`Could not list jobs for run ${run.id}.`);
    return {
      jobs: [],
      note: `job list unavailable: ${degradationReason(error)}`,
    };
  }

  // A job that carries no `run_attempt` is taken as belonging to this attempt;
  // one that names a different attempt is another execution's job.
  const attempt = run.run_attempt ?? 1;
  const failedJobs = (Array.isArray(allJobs) ? allJobs : []).filter(
    (job) =>
      (job?.run_attempt ?? attempt) === attempt &&
      FAILURE_CONCLUSIONS.has(job?.conclusion),
  );
  const reported = failedJobs.slice(0, MAX_REPORTED_JOBS);
  const jobs = reported.map((job) => {
    const steps = failedStepsFor(job);
    return {
      name: sanitizeField(job?.name, "unnamed job"),
      url: safeJobUrl(job?.html_url),
      failedSteps: steps.names,
      omittedSteps: steps.omitted,
    };
  });

  const omitted = failedJobs.length - reported.length;
  return {
    jobs,
    note:
      omitted > 0
        ? `${omitted} further failed job${omitted === 1 ? " is" : "s are"} not listed here.`
        : undefined,
  };
}

function renderFailedJob(job) {
  const link = job.url ? ` ([job log](${job.url}))` : "";
  const name = codeSpan(job.name);
  if (job.failedSteps.length === 0) {
    return `- ${name} — no failed step reported${link}`;
  }
  const label = job.failedSteps.length === 1 ? "failed step" : "failed steps";
  const steps = job.failedSteps.map((step) => codeSpan(step)).join(", ");
  const omitted = job.omittedSteps ?? 0;
  const more =
    omitted > 0
      ? `, and ${omitted} more failed step${omitted === 1 ? "" : "s"} not shown`
      : "";
  return `- ${name} — ${label}: ${steps}${more}${link}`;
}

/**
 * Quote one already-sanitized value as a table cell. GFM splits a row on
 * unescaped pipes before it parses inline content, so a pipe inside a code span
 * still ends the cell — `\|` is the documented way to carry one, and a
 * backslash immediately before a pipe always escapes it, so this holds for a
 * value that already contained a backslash too.
 */
function tableCell(text) {
  return codeSpan(text).replaceAll("|", "\\|");
}

const FINDINGS_COLUMNS = [
  "Advisory",
  "Package",
  "Installed",
  "Fixed in",
  "Lockfile",
  "Summary",
];

/**
 * Render the scanner's structured findings as a fixed six-column table.
 *
 * Only the allowlisted scalar fields `./osv-findings.mjs` returns are rendered,
 * each sanitized to one capped line and quoted as a code span, so no
 * scanner-supplied text can open an autolink, a mention, an image, raw HTML or
 * a fence — or forge the managed marker on a line of its own.
 */
function renderOsvFindings(findings) {
  const header = [
    `| ${FINDINGS_COLUMNS.join(" | ")} |`,
    `| ${FINDINGS_COLUMNS.map(() => "---").join(" | ")} |`,
  ];
  const rows = findings.map((finding) => {
    const cells = [
      sanitizeField(finding.id, "unknown advisory"),
      sanitizeField(finding.packageName, "unknown package"),
      sanitizeField(finding.version, "unknown version"),
      sanitizeField(finding.fixedVersion, "no fix listed"),
      sanitizeField(finding.lockfile, "unknown lockfile"),
      sanitizeField(finding.summary, "no summary"),
    ];
    return `| ${cells.map((cell) => tableCell(cell)).join(" | ")} |`;
  });
  return [...header, ...rows].join("\n");
}

export function failureBody(
  run,
  targetRef,
  marker,
  evidence = { jobs: [] },
  osvFindings,
) {
  const workflowName = workflowNameFor(run);
  const header = [
    `The ${codeSpan(workflowName)} workflow failed for ${codeSpan(sanitizeField(targetRef))}.`,
    "",
    `- Conclusion: \`${run.conclusion}\``,
    `- Trigger: \`${run.event}\``,
    `- Latest failure: ${runLink(run)}`,
    "",
    "## What failed",
    "",
  ];
  const footer = [
    "",
    [
      "These are GitHub's own job and step names.",
      osvFindings === undefined
        ? ""
        : " Any findings table above is rendered from the scanner's own structured results artifact for this run.",
      " This issue never quotes job log output, because a failing job can print anything into its log; open the linked jobs for the failing lines. Scheduled OSV scans also publish their findings to this repository's code-scanning alerts.",
    ].join(""),
    "",
    "This issue is managed by the CI Failure Notifier. It is updated for repeated failures and closed automatically after a newer successful run.",
    "",
    marker,
  ];
  const rows = evidence.jobs.map((job) => renderFailedJob(job));
  const allFindings = osvFindings?.findings ?? [];

  // Present only when a findings artifact was expected for this run, so every
  // other workflow's issue reads exactly as it did before.
  const findingsSection = (visibleFindings, droppedFindings) => {
    if (osvFindings === undefined) return [];
    const omitted = (osvFindings.omitted ?? 0) + droppedFindings;
    // Each note is rendered on its own, never joined first: `renderField` caps
    // at 200 characters, and concatenated notes would lose the last one.
    const notes = (osvFindings.notes ?? []).map(
      (note) => `_${renderField(note)}_`,
    );
    if (omitted > 0) {
      notes.push(
        `_${omitted} further finding${omitted === 1 ? " is" : "s are"} not listed here._`,
      );
    }
    const middle =
      visibleFindings.length > 0
        ? renderOsvFindings(visibleFindings)
        : (notes.shift() ??
          "_No vulnerability was reported for this run's scanned lockfiles._");
    return [
      "",
      "## Findings",
      "",
      middle,
      ...(notes.length > 0 ? ["", notes.join("\n\n")] : []),
    ];
  };

  const assemble = (visible, dropped, visibleFindings, droppedFindings) => {
    const notes = [];
    if (evidence.note) notes.push(`_${evidence.note}_`);
    if (dropped > 0) {
      notes.push(
        `_${dropped} further failed job${dropped === 1 ? " was" : "s were"} dropped to keep this issue under GitHub's size limit._`,
      );
    }
    const middle =
      visible.length > 0
        ? visible.join("\n")
        : (notes.shift() ??
          "_No failed job was reported for this run. Open the run for details._");
    return [
      ...header,
      middle,
      ...(notes.length > 0 ? ["", notes.join("\n\n")] : []),
      ...findingsSection(visibleFindings, droppedFindings),
      ...footer,
    ].join("\n");
  };

  let visible = rows;
  let dropped = 0;
  let visibleFindings = allFindings;
  let droppedFindings = 0;
  let body = assemble(visible, dropped, visibleFindings, droppedFindings);
  // Findings go first: they are supplementary evidence, while the job and step
  // list is what the issue has always had to carry.
  while (byteLength(body) > BODY_MAX_BYTES && visibleFindings.length > 0) {
    visibleFindings = visibleFindings.slice(0, -1);
    droppedFindings += 1;
    body = assemble(visible, dropped, visibleFindings, droppedFindings);
  }
  while (byteLength(body) > BODY_MAX_BYTES && visible.length > 0) {
    visible = visible.slice(0, -1);
    dropped += 1;
    body = assemble(visible, dropped, visibleFindings, droppedFindings);
  }
  return body;
}

/**
 * Append the recovery note while keeping the marker the last line, so the
 * routing rule stays "the marker sits on its own line" for closed issues too.
 */
function recoveryBody(existingBody, run, targetRef, marker) {
  const trimmed = String(existingBody ?? "").trim();
  const lines = trimmed.split(/\r?\n/);
  // The parser that routed the issue chooses the cut, so the recovery note can
  // never land after a quoted copy of the marker. Both split the same string
  // the same way, so the index lines up.
  const markerIndex = markerLineIndex(trimmed, marker);
  const head = (markerIndex === -1 ? lines : lines.slice(0, markerIndex))
    .join("\n")
    .trimEnd();

  return [
    head,
    "",
    "## Recovery",
    "",
    `The ${codeSpan(workflowNameFor(run))} workflow recovered for ${codeSpan(sanitizeField(targetRef))} in ${runLink(run)}.`,
    "",
    marker,
  ].join("\n");
}

/**
 * The structured findings the notifier workflow downloaded for this exact run,
 * or `undefined` when none was expected.
 *
 * `OSV_FINDINGS_DIR` is set only for the workflow that uploads a findings
 * artifact, so every other workflow's issue keeps its previous shape. The run
 * ids must match: the download step runs before this script and can only
 * address the callback run, while reconciliation may settle on a later decisive
 * run, and rendering one run's advisories under another run's failure would
 * attribute them to a scan that never reported them.
 */
function osvFindingsFor(run, core, env) {
  const directory = env.OSV_FINDINGS_DIR;
  if (typeof directory !== "string" || directory.length === 0) return undefined;

  const downloadedRunId = Number(env.OSV_FINDINGS_RUN_ID);
  if (!Number.isSafeInteger(downloadedRunId) || downloadedRunId !== run.id) {
    core?.info?.(
      `The findings artifact was downloaded for run ${env.OSV_FINDINGS_RUN_ID}, not the reconciled run ${run.id}.`,
    );
    return {
      findings: [],
      omitted: 0,
      notes: [
        "The findings artifact available here belongs to a different run than the one reported above, so no package is named.",
      ],
    };
  }

  try {
    return collectOsvFindings({ directory });
  } catch (error) {
    core?.warning?.("Could not read the OSV findings artifact.");
    return {
      findings: [],
      omitted: 0,
      notes: [`Findings artifact unavailable: ${degradationReason(error)}.`],
    };
  }
}

function isRelevantRun(run, defaultBranch, repositoryFullName) {
  const isOperationalPush =
    run.event === "push" &&
    (run.head_branch === defaultBranch ||
      TAG_PUSH_WORKFLOW_NAMES.has(run.name));
  const isOperationalRun =
    run.event === "schedule" ||
    isOperationalPush ||
    (run.event === "workflow_dispatch" && run.head_branch === defaultBranch) ||
    (run.event === "workflow_run" &&
      run.name === VERCEL_MAIN_WORKFLOW_NAME &&
      run.head_branch === defaultBranch &&
      run.head_repository?.full_name === repositoryFullName);

  return (
    TRACKED_EVENTS.has(run.event) &&
    isOperationalRun &&
    run.name !== NOTIFIER_WORKFLOW_NAME
  );
}

async function findManagedIssue(github, repo, marker) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...repo,
    state: "all",
    per_page: 100,
  });

  return issues
    .filter(
      (issue) =>
        issue.pull_request === undefined &&
        issue.user?.login === "github-actions[bot]",
    )
    .sort((left, right) => right.number - left.number)
    .find((issue) => bodyCarriesMarker(issue.body, marker));
}

async function listCompletedWorkflowRuns(
  github,
  repo,
  workflowId,
  callbackRun,
) {
  const runs = [];

  for await (const response of github.paginate.iterator(
    github.rest.actions.listWorkflowRuns,
    {
      ...repo,
      exclude_pull_requests: true,
      event: callbackRun.event,
      workflow_id: workflowId,
      status: "completed",
      per_page: 100,
    },
  )) {
    const page = Array.isArray(response.data)
      ? response.data
      : response.data?.workflow_runs;
    if (!Array.isArray(page)) {
      throw new Error("GitHub returned an invalid workflow-runs page.");
    }
    runs.push(...page);
    if (page.some((candidate) => compareRuns(candidate, callbackRun) <= 0)) {
      break;
    }
  }

  return runs;
}

function findLatestDecisiveRun(
  runs,
  defaultBranch,
  repositoryFullName,
  partition,
) {
  const seen = new Set();

  return runs
    .filter(
      (candidate) =>
        isRelevantRun(candidate, defaultBranch, repositoryFullName) &&
        isDecisiveRun(candidate) &&
        partitionIdentity(candidate, defaultBranch) === partition,
    )
    .filter((candidate) => {
      const identity = runIdentity(candidate);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => compareRuns(right, left))[0];
}

export async function reconcileCiFailureIssue({
  github,
  context,
  core,
  env = process.env,
}) {
  const run = context.payload.workflow_run;
  const defaultBranch = context.payload.repository.default_branch;
  const repo = context.repo;
  const repositoryFullName = `${repo.owner}/${repo.repo}`;

  if (
    !run ||
    !defaultBranch ||
    !isRelevantRun(run, defaultBranch, repositoryFullName)
  ) {
    core?.info(
      "Ignoring a non-default-branch or non-operational workflow run.",
    );
    return { action: "ignored", reason: "untracked-run" };
  }

  if (!isDecisiveRun(run)) {
    core?.info(`Ignoring workflow conclusion: ${run.conclusion}`);
    return { action: "ignored", reason: "neutral-conclusion" };
  }

  const partition = partitionIdentity(run, defaultBranch);
  const completedRuns = await listCompletedWorkflowRuns(
    github,
    repo,
    run.workflow_id,
    run,
  );
  const effectiveRun = findLatestDecisiveRun(
    [run, ...completedRuns],
    defaultBranch,
    repositoryFullName,
    partition,
  );
  if (!effectiveRun) {
    return { action: "ignored", reason: "no-decisive-run" };
  }
  if (runIdentity(effectiveRun) !== runIdentity(run)) {
    core?.info(
      `Reconciling callback run ${run.run_number} to latest decisive run ${effectiveRun.run_number}.`,
    );
  }

  const targetRef = targetRefFor(effectiveRun, defaultBranch);
  const marker = markerFor(effectiveRun, defaultBranch);
  const existing = await findManagedIssue(github, repo, marker);

  if (FAILURE_CONCLUSIONS.has(effectiveRun.conclusion)) {
    const evidence = await collectFailureEvidence(
      github,
      repo,
      effectiveRun,
      core,
    );
    const body = failureBody(
      effectiveRun,
      targetRef,
      marker,
      evidence,
      osvFindingsFor(effectiveRun, core, env),
    );
    if (existing) {
      await github.rest.issues.update({
        ...repo,
        issue_number: existing.number,
        title: issueTitle(effectiveRun, targetRef),
        body,
        state: "open",
      });
      return { action: "updated", issueNumber: existing.number };
    }

    const created = await github.rest.issues.create({
      ...repo,
      title: issueTitle(effectiveRun, targetRef),
      body,
    });
    return { action: "opened", issueNumber: created.data.number };
  }

  if (!existing || existing.state !== "open") {
    return { action: "ignored", reason: "nothing-to-close" };
  }

  await github.rest.issues.update({
    ...repo,
    issue_number: existing.number,
    body: recoveryBody(
      existing.body ?? marker,
      effectiveRun,
      targetRef,
      marker,
    ),
    state: "closed",
    state_reason: "completed",
  });
  return { action: "closed", issueNumber: existing.number };
}
