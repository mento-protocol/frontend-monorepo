const TRACKED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
]);
const NOTIFIER_WORKFLOW_NAME = "CI Failure Notifier";
const TAG_PUSH_WORKFLOW_NAMES = new Set(["Publish UI Package"]);

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

function markerFor(run) {
  return `<!-- managed-ci-failure:${run.workflow_id} -->`;
}

function runLink(run) {
  return `[run #${run.run_number}, attempt ${run.run_attempt ?? 1}](${run.html_url})`;
}

function issueTitle(run, targetRef) {
  return `CI: ${run.name} is failing (${targetRef})`.slice(0, 255);
}

function failureBody(run, targetRef) {
  return [
    `The **${run.name}** workflow failed for \`${targetRef}\`.`,
    "",
    `- Conclusion: \`${run.conclusion}\``,
    `- Trigger: \`${run.event}\``,
    `- Latest failure: ${runLink(run)}`,
    "",
    "This issue is managed by the CI Failure Notifier. It is updated for repeated failures and closed automatically after a newer successful run.",
    "",
    markerFor(run),
  ].join("\n");
}

function recoveryBody(existingBody, run, targetRef) {
  return [
    existingBody.trim(),
    "",
    "## Recovery",
    "",
    `**${run.name}** recovered for \`${targetRef}\` in ${runLink(run)}.`,
  ].join("\n");
}

function isRelevantRun(run, defaultBranch) {
  const isOperationalPush =
    run.event === "push" &&
    (run.head_branch === defaultBranch ||
      TAG_PUSH_WORKFLOW_NAMES.has(run.name));

  return (
    TRACKED_EVENTS.has(run.event) &&
    (isOperationalPush || run.head_branch === defaultBranch) &&
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

function findLatestDecisiveRun(runs, defaultBranch) {
  const seen = new Set();

  return runs
    .filter(
      (candidate) =>
        isRelevantRun(candidate, defaultBranch) && isDecisiveRun(candidate),
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

  if (!run || !defaultBranch || !isRelevantRun(run, defaultBranch)) {
    core?.info(
      "Ignoring a non-default-branch or non-operational workflow run.",
    );
    return { action: "ignored", reason: "untracked-run" };
  }

  if (!isDecisiveRun(run)) {
    core?.info(`Ignoring workflow conclusion: ${run.conclusion}`);
    return { action: "ignored", reason: "neutral-conclusion" };
  }

  const completedRuns = await listCompletedWorkflowRuns(
    github,
    repo,
    run.workflow_id,
    run,
  );
  const effectiveRun = findLatestDecisiveRun(
    [run, ...completedRuns],
    defaultBranch,
  );
  if (!effectiveRun) {
    return { action: "ignored", reason: "no-decisive-run" };
  }
  if (runIdentity(effectiveRun) !== runIdentity(run)) {
    core?.info(
      `Reconciling callback run ${run.run_number} to latest decisive run ${effectiveRun.run_number}.`,
    );
  }

  const targetRef =
    effectiveRun.head_branch ||
    (effectiveRun.event === "push" ? "release tag" : defaultBranch);
  const marker = markerFor(effectiveRun);
  const existing = await findManagedIssue(github, repo, marker);

  if (FAILURE_CONCLUSIONS.has(effectiveRun.conclusion)) {
    const body = failureBody(effectiveRun, targetRef);
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
