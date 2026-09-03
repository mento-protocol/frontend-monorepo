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
 * Render one API-supplied name for Markdown: strip control and format
 * characters, collapse whitespace, cap the length, and escape the Markdown
 * specials. Names come from workflow files on the default branch, so this
 * guards against accident and against a name being read as body structure —
 * above all against a forged marker line.
 */
export function renderField(value, fallback = "") {
  const flattened = String(value ?? "")
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length === 0) return fallback;
  const capped =
    flattened.length > MAX_FIELD_CHARS
      ? `${flattened.slice(0, MAX_FIELD_CHARS)}…`
      : flattened;
  return capped.replace(MARKDOWN_ESCAPE_PATTERN, "\\$1");
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

/**
 * Does `body` carry `marker` as a line of its own, outside any fenced block?
 * Substring matching would let any quoted text route a later failure into the
 * wrong issue, so the marker only counts where the notifier writes it.
 */
export function bodyCarriesMarker(body, marker) {
  if (typeof body !== "string") return false;
  let inFence = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line === marker) return true;
  }
  return false;
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

function failedStepNamesFor(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return steps
    .filter((step) => FAILURE_CONCLUSIONS.has(step?.conclusion))
    .slice(0, MAX_REPORTED_STEPS)
    .map((step, index) => renderField(step?.name, `step ${index + 1}`));
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
  const jobs = reported.map((job) => ({
    name: renderField(job?.name, "unnamed job"),
    url: safeJobUrl(job?.html_url),
    failedSteps: failedStepNamesFor(job),
  }));

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
  if (job.failedSteps.length === 0) {
    return `- **${job.name}** — no failed step reported${link}`;
  }
  const label = job.failedSteps.length === 1 ? "failed step" : "failed steps";
  const steps = job.failedSteps.map((step) => `\`${step}\``).join(", ");
  return `- **${job.name}** — ${label}: ${steps}${link}`;
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
    "These are GitHub's own job and step names. This issue never quotes job log output, because a failing job can print anything into its log; open the linked jobs for the failing lines. Scheduled OSV scans also publish their findings to this repository's code-scanning alerts.",
    "",
    "This issue is managed by the CI Failure Notifier. It is updated for repeated failures and closed automatically after a newer successful run.",
    "",
    marker,
  ];
  const rows = evidence.jobs.map((job) => renderFailedJob(job));

  const assemble = (visible, dropped) => {
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
      ...footer,
    ].join("\n");
  };

  let visible = rows;
  let dropped = 0;
  let body = assemble(visible, dropped);
  while (byteLength(body) > BODY_MAX_BYTES && visible.length > 0) {
    visible = visible.slice(0, -1);
    dropped += 1;
    body = assemble(visible, dropped);
  }
  return body;
}

/**
 * Append the recovery note while keeping the marker the last line, so the
 * routing rule stays "the marker sits on its own line" for closed issues too.
 */
function recoveryBody(existingBody, run, targetRef, marker) {
  const lines = String(existingBody ?? "")
    .trim()
    .split(/\r?\n/);
  const markerIndex = lines.findLastIndex((line) => line.trim() === marker);
  const head = (markerIndex === -1 ? lines : lines.slice(0, markerIndex))
    .join("\n")
    .trimEnd();

  return [
    head,
    "",
    "## Recovery",
    "",
    `**${workflowNameFor(run)}** recovered for \`${targetRef}\` in ${runLink(run)}.`,
    "",
    marker,
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
