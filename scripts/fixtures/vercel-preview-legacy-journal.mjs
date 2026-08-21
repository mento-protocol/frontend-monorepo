const LEGACY_PREVIEW_REPOSITORY = "mento-protocol/frontend-monorepo";
const LEGACY_PREVIEW_TARGETS = ["app", "governance", "reserve", "ui"];
const LEGACY_PREVIEW_JOURNAL_MARKER = "<!-- vercel-preview-journal:v2 -->";
const LEGACY_COMMENT_EXPLANATION =
  "**No reviewer action is required.** This repository builds pull request previews in GitHub Actions and deploys them to Vercel. This record lets the preview automation handle overlapping pushes and recover safely from retries. [How previews work](https://github.com/mento-protocol/frontend-monorepo/blob/main/docs/vercel-deployments.md#event-status-and-batching-contract).";
const LEGACY_COMMENT_DETAILS_SUMMARY =
  "Show machine-readable preview automation record";

function legacyTerminalResultUrl(result) {
  if (result?.vercel_deployment_url) {
    return String(result.vercel_deployment_url).replace(/\/$/, "");
  }
  if (result?.worker_run_id) {
    return `https://github.com/${LEGACY_PREVIEW_REPOSITORY}/actions/runs/${result.worker_run_id}`;
  }
  return null;
}

function legacyReviewerOutcomeUrl(value, target, outcome) {
  const targetState = value.state?.targets?.[target];
  if (!targetState) return null;
  if (["deployed", "runtime-equivalent"].includes(outcome)) {
    return targetState.last_successful_runtime_url ?? null;
  }
  if (outcome === "pending") return targetState.active?.html_url ?? null;
  if (!["failed", "error"].includes(outcome)) return null;
  const terminal = [...targetState.terminal_history]
    .reverse()
    .find(
      (candidate) =>
        candidate.sha === targetState.latest_desired_sha &&
        (outcome === "failed"
          ? candidate.state === "failure" ||
            (candidate.state === "error" &&
              candidate.terminal_reason === "worker-cancelled")
          : candidate.state === "error" &&
            candidate.terminal_reason !== "worker-cancelled"),
    );
  return legacyTerminalResultUrl(terminal);
}

function legacyReviewerOutcomeSummary(value) {
  const latestDecision = value.state?.status_decisions?.at(-1) ?? null;
  const rows = LEGACY_PREVIEW_TARGETS.map((target) => {
    const outcome =
      latestDecision?.targets?.[target] ?? "awaiting reconciliation";
    const url = legacyReviewerOutcomeUrl(value, target, outcome);
    return `| \`${target}\` | \`${outcome}\`${url ? ` ([open](${url}))` : ""} |`;
  });
  return [
    "**Preview outcomes**",
    "",
    "| Target | Outcome |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

// This fixture intentionally duplicates the retired two-space representation.
// Do not source any Markdown or JSON bytes from the production renderers.
export function legacyPreviewJournalBody(value) {
  return `${LEGACY_PREVIEW_JOURNAL_MARKER}\n\n${LEGACY_COMMENT_EXPLANATION}\n\n${legacyReviewerOutcomeSummary(value)}\n\n<details>\n<summary>${LEGACY_COMMENT_DETAILS_SUMMARY}</summary>\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n</details>\n`;
}
