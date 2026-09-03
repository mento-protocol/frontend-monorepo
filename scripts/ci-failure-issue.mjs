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

// Evidence budget. GitHub rejects an issue body over 65536 characters, so each
// job excerpt is bounded before assembly and the assembled body is re-checked
// against a lower ceiling that leaves room for the recovery footer.
const JOB_EXCERPT_MAX_LINES = 40;
const JOB_EXCERPT_MAX_BYTES = 4096;
const BODY_MAX_BYTES = 60 * 1024;
const MAX_REPORTED_JOBS = 10;
const ERROR_CONTEXT_LINES = 12;
const MAX_LINE_CHARS = 500;
const TRUNCATION_RESERVE_BYTES = 64;
// The notifier job is capped at five minutes. Stop downloading logs well before
// that so a pathologically large log cannot turn evidence into a timeout.
const EVIDENCE_DEADLINE_MS = 90_000;

// Runner logs arrive as `<ISO timestamp> <ANSI-coloured text>`. Matching the
// escape characters is the point here, so the control-character rule is off for
// this one declaration.
/* eslint-disable no-control-regex */
const ANSI_PATTERN =
  /\x1B\[[0-9;:<=>?]*[\x20-\x2F]*[\x40-\x7E]|\x1B[\x40-\x5F]/g;
/* eslint-enable no-control-regex */
const RUNNER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z ?/;
// Defensive only: the notifier writes into a public issue, so a line that
// merely looks like it carries a credential is dropped rather than trimmed.
const SECRET_PATTERN =
  /token|secret|password|passwd|bearer|authorization|ghp_|ghs_|gho_|ghu_|ghr_|github_pat_|-----BEGIN/i;
const REDACTED_LINE = "[redacted: line matched the secret guard]";
const ELISION_LINE = "[…]";
const OSV_FINDING_PATTERN = /^\|\s*https:\/\/osv\.dev\//;
const OSV_TOTAL_PATTERN = /^Total\s+\d+\s+packages?\s+affected/i;
const TABLE_LINE_PATTERN = /^[|+]/;
const ERROR_MARKER_PATTERN = /##\[error\]/;

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

function workflowNameFor(run) {
  return run.name;
}

function issueTitle(run, targetRef) {
  const workflowName = workflowNameFor(run);
  return `CI: ${workflowName} is failing (${targetRef}; ${run.event})`.slice(
    0,
    255,
  );
}

/**
 * Normalize a raw runner log into printable lines: strip ANSI colouring and the
 * per-line ISO timestamp, cap absurdly long lines, drop group markers, and
 * replace anything that looks like a credential with a fixed redaction line.
 */
export function sanitizeLogLines(text) {
  const cleaned = [];

  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const stripped = raw
      .replace(ANSI_PATTERN, "")
      .replace(RUNNER_TIMESTAMP_PATTERN, "")
      .replace(/\r/g, "")
      .trimEnd();
    if (stripped === "##[endgroup]") continue;

    let line = stripped;
    if (line.length > MAX_LINE_CHARS) {
      line = `${line.slice(0, MAX_LINE_CHARS)}…`;
    }
    if (SECRET_PATTERN.test(line)) line = REDACTED_LINE;

    const previous = cleaned.at(-1);
    if (line === REDACTED_LINE && previous === REDACTED_LINE) continue;
    if (line === "" && previous === "") continue;
    cleaned.push(line);
  }

  while (cleaned.length > 0 && cleaned.at(-1) === "") cleaned.pop();
  while (cleaned.length > 0 && cleaned[0] === "") cleaned.shift();
  return cleaned;
}

/**
 * Pull the OSV-Scanner findings table out of sanitized log lines: every
 * contiguous `+---+` / `| … |` block holding at least one `https://osv.dev/`
 * row, preceded by its `Total N packages affected …` headline when present.
 * Returns an empty array when the log holds no OSV findings.
 */
export function extractOsvFindings(lines) {
  const blocks = [];
  let current = null;

  lines.forEach((line, index) => {
    if (TABLE_LINE_PATTERN.test(line)) {
      current ??= { start: index, lines: [] };
      current.lines.push(line);
      return;
    }
    if (current) {
      blocks.push(current);
      current = null;
    }
  });
  if (current) blocks.push(current);

  const findingBlocks = blocks.filter((block) =>
    block.lines.some((line) => OSV_FINDING_PATTERN.test(line)),
  );
  if (findingBlocks.length === 0) return [];

  const excerpt = [];
  for (const block of findingBlocks) {
    const lookbackStart = Math.max(0, block.start - 4);
    for (let index = block.start - 1; index >= lookbackStart; index -= 1) {
      if (OSV_TOTAL_PATTERN.test(lines[index])) {
        excerpt.push(lines[index]);
        break;
      }
    }
    excerpt.push(...block.lines);
  }
  return excerpt;
}

/**
 * Pull the lines leading up to each `##[error]` annotation. With no annotation
 * at all, fall back to the tail of the log, which is where a runner records the
 * step that ended the job.
 */
export function extractErrorContext(
  lines,
  { contextLines = ERROR_CONTEXT_LINES, maxLines = JOB_EXCERPT_MAX_LINES } = {},
) {
  const markers = [];
  lines.forEach((line, index) => {
    if (ERROR_MARKER_PATTERN.test(line)) markers.push(index);
  });
  if (markers.length === 0) return lines.slice(-maxLines);

  const kept = new Set();
  for (const marker of markers.slice(-maxLines)) {
    const start = Math.max(0, marker - contextLines);
    for (let index = start; index <= marker; index += 1) kept.add(index);
  }

  const excerpt = [];
  let previous = null;
  for (const index of [...kept].sort((left, right) => left - right)) {
    if (previous !== null && index > previous + 1) excerpt.push(ELISION_LINE);
    excerpt.push(lines[index]);
    previous = index;
  }
  return excerpt;
}

/**
 * Bound one job excerpt by line count and byte size. `keep` selects which end
 * survives: `head` for a findings table whose header carries the meaning,
 * `tail` for error context whose last lines carry the failure.
 */
export function capExcerpt(
  lines,
  {
    keep = "tail",
    maxLines = JOB_EXCERPT_MAX_LINES,
    maxBytes = JOB_EXCERPT_MAX_BYTES,
  } = {},
) {
  let kept = [...lines];
  let dropped = 0;

  if (kept.length > maxLines) {
    dropped = kept.length - maxLines;
    kept = keep === "head" ? kept.slice(0, maxLines) : kept.slice(-maxLines);
  }

  const budget = Math.max(0, maxBytes - TRUNCATION_RESERVE_BYTES);
  while (kept.length > 0 && byteLength(kept.join("\n")) > budget) {
    if (keep === "head") kept.pop();
    else kept.shift();
    dropped += 1;
  }

  if (dropped > 0) {
    const marker = `[… ${dropped} more log line${dropped === 1 ? "" : "s"} truncated]`;
    if (keep === "head") kept.push(marker);
    else kept.unshift(marker);
  }
  return kept;
}

function degradationReason(error) {
  const raw =
    (error?.status ? `HTTP ${error.status}` : "") ||
    error?.message ||
    String(error);
  const flattened = String(raw).replace(/\s+/g, " ").trim().slice(0, 200);
  if (flattened.length === 0) return "unknown error";
  return SECRET_PATTERN.test(flattened) ? "redacted error" : flattened;
}

function decodeLogPayload(payload) {
  if (typeof payload === "string") return payload;
  if (payload instanceof ArrayBuffer) return new TextDecoder().decode(payload);
  if (ArrayBuffer.isView(payload)) return new TextDecoder().decode(payload);
  throw new Error("the job log response carried no readable text");
}

/**
 * The workflow-jobs API exposes no step output, so the log is normally the only
 * source. Honour a structured summary when a caller hands one over (the
 * associated check run carries `output.summary`/`output.text`) so no log has to
 * be downloaded for it.
 */
function structuredSummaryFor(job) {
  for (const candidate of [job?.output?.summary, job?.output?.text]) {
    if (typeof candidate !== "string") continue;
    const lines = sanitizeLogLines(candidate);
    if (lines.length > 0) return lines;
  }
  return [];
}

function failedStepNameFor(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return steps.find((step) => FAILURE_CONCLUSIONS.has(step?.conclusion))?.name;
}

async function jobExcerpt(github, repo, job, deadline) {
  const summary = structuredSummaryFor(job);
  if (summary.length > 0) {
    return { source: "summary", lines: capExcerpt(summary, { keep: "head" }) };
  }

  if (Date.now() > deadline) {
    return {
      source: "log",
      lines: [],
      note: "log excerpt unavailable: the evidence deadline passed",
    };
  }

  try {
    const response = await github.rest.actions.downloadJobLogsForWorkflowRun({
      ...repo,
      job_id: job.id,
    });
    const lines = sanitizeLogLines(decodeLogPayload(response?.data));
    if (lines.length === 0) {
      return {
        source: "log",
        lines: [],
        note: "log excerpt unavailable: the job log was empty",
      };
    }

    const findings = extractOsvFindings(lines);
    if (findings.length > 0) {
      return { source: "log", lines: capExcerpt(findings, { keep: "head" }) };
    }
    return {
      source: "log",
      lines: capExcerpt(extractErrorContext(lines), { keep: "tail" }),
    };
  } catch (error) {
    return {
      source: "log",
      lines: [],
      note: `log excerpt unavailable: ${degradationReason(error)}`,
    };
  }
}

/**
 * Collect one bounded excerpt per failed job of `run`. Every failure here
 * degrades into a note on the issue; the notifier itself never fails because
 * evidence could not be read.
 */
export async function collectFailureEvidence(
  github,
  repo,
  run,
  core,
  { deadlineMs = EVIDENCE_DEADLINE_MS } = {},
) {
  if (!run?.id) {
    return { jobs: [], note: "the failed run exposed no job list" };
  }
  const deadline = Date.now() + deadlineMs;

  let allJobs;
  try {
    allJobs = await github.paginate(
      github.rest.actions.listJobsForWorkflowRun,
      {
        ...repo,
        run_id: run.id,
        filter: "latest",
        per_page: 100,
      },
    );
  } catch (error) {
    core?.warning?.(`Could not list jobs for run ${run.id}.`);
    return {
      jobs: [],
      note: `job list unavailable: ${degradationReason(error)}`,
    };
  }

  const failedJobs = (Array.isArray(allJobs) ? allJobs : []).filter((job) =>
    FAILURE_CONCLUSIONS.has(job?.conclusion),
  );
  const reported = failedJobs.slice(0, MAX_REPORTED_JOBS);
  const jobs = [];

  for (const job of reported) {
    const excerpt = await jobExcerpt(github, repo, job, deadline);
    jobs.push({
      name: job?.name ?? "unnamed job",
      url: job?.html_url,
      failedStep: failedStepNameFor(job),
      ...excerpt,
    });
  }

  const omitted = failedJobs.length - reported.length;
  return {
    jobs,
    note:
      omitted > 0
        ? `${omitted} further failed job${omitted === 1 ? " is" : "s are"} not listed here.`
        : undefined,
  };
}

function fenceFor(text) {
  const longest = Math.max(
    0,
    ...[...String(text).matchAll(/`+/g)].map((match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function renderFailedJobSection(job) {
  const heading = job.url ? `[${job.name}](${job.url})` : job.name;
  const section = [`### ${heading}`, ""];
  if (job.failedStep) section.push(`Failed step: \`${job.failedStep}\``, "");
  if (job.lines.length > 0) {
    const excerpt = job.lines.join("\n");
    const fence = fenceFor(excerpt);
    section.push(`${fence}text`, excerpt, fence);
  } else {
    section.push(`_(${job.note ?? "no excerpt available"})_`);
  }
  return section.join("\n");
}

export function failureBody(run, targetRef, marker, evidence = { jobs: [] }) {
  const workflowName = workflowNameFor(run);
  const header = [
    `The **${workflowName}** workflow failed for \`${targetRef}\`.`,
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
    "This issue is managed by the CI Failure Notifier. It is updated for repeated failures and closed automatically after a newer successful run.",
    "",
    marker,
  ];
  const sections = evidence.jobs.map((job) => renderFailedJobSection(job));

  const assemble = (visible, dropped) => {
    const notes = [];
    if (evidence.note) notes.push(`_${evidence.note}_`);
    if (dropped > 0) {
      notes.push(
        `_Excerpts for ${dropped} further failed job${dropped === 1 ? "" : "s"} were dropped to keep this issue under GitHub's size limit._`,
      );
    }
    const middle =
      visible.length > 0
        ? visible.join("\n\n")
        : (notes.shift() ??
          "_No failed job was reported for this run. Open the run for details._");
    return [
      ...header,
      middle,
      ...(notes.length > 0 ? ["", notes.join("\n\n")] : []),
      ...footer,
    ].join("\n");
  };

  let visible = sections;
  let dropped = 0;
  let body = assemble(visible, dropped);
  while (byteLength(body) > BODY_MAX_BYTES && visible.length > 0) {
    visible = visible.slice(0, -1);
    dropped += 1;
    body = assemble(visible, dropped);
  }
  return body;
}

function recoveryBody(existingBody, run, targetRef) {
  const workflowName = workflowNameFor(run);
  return [
    existingBody.trim(),
    "",
    "## Recovery",
    "",
    `**${workflowName}** recovered for \`${targetRef}\` in ${runLink(run)}.`,
  ].join("\n");
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
    .find((issue) => issue.body?.includes(marker));
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

export async function reconcileCiFailureIssue({ github, context, core }) {
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
    const body = failureBody(effectiveRun, targetRef, marker, evidence);
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
    body: recoveryBody(existing.body ?? marker, effectiveRun, targetRef),
    state: "closed",
    state_reason: "completed",
  });
  return { action: "closed", issueNumber: existing.number };
}
