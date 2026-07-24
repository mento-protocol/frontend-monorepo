import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  assertMainDeploymentPlan,
  createMainPlanGitAdapter,
  MAIN_DEPLOYMENT_TARGETS,
  MainActivationStateError,
  planMainDeployments,
} from "./vercel-main-plan.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function fixture() {
  return JSON.parse(readFileSync(fixtureUrl, "utf8"));
}

function setTargetSha(input, target, sha) {
  for (const state of input.priorStates[target].states) {
    state.git.sha = sha;
  }
}

function setAllTargetShas(input, sha) {
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    setTargetSha(input, target, sha);
  }
}

function plannerOutput(base, head, deployments, reason) {
  return { base, head, deployments, reason };
}

function createGitFixture(
  input,
  {
    firstParent = input.firstParent,
    firstParentError = false,
    nonAncestors = [],
    unresolvable = [],
  } = {},
) {
  const calls = [];
  const nonAncestorSet = new Set(nonAncestors);
  const unresolvableSet = new Set(unresolvable);
  return {
    calls,
    adapter: {
      firstParent(head) {
        calls.push(["firstParent", head]);
        if (firstParentError) throw new Error("fixture first-parent failure");
        return firstParent;
      },
      isAncestor(base, head) {
        calls.push(["isAncestor", base, head]);
        return !nonAncestorSet.has(base);
      },
      resolveCommit(sha) {
        calls.push(["resolveCommit", sha]);
        if (unresolvableSet.has(sha)) {
          throw new Error("fixture resolution failure");
        }
        return sha.toLowerCase();
      },
    },
  };
}

function createPlannerFixture(responses = new Map()) {
  const calls = [];
  return {
    calls,
    runPlanner({ base, head }) {
      calls.push({ base, head });
      const response = responses.get(base);
      if (response instanceof Error) throw response;
      if (typeof response === "function") return response({ base, head });
      if (response !== undefined) return structuredClone(response);
      return plannerOutput(base, head, [], "non-runtime-only");
    },
  };
}

function runFixture(input, options = {}) {
  const git = options.git ?? createGitFixture(input);
  const planner = options.planner ?? createPlannerFixture();
  return {
    git,
    planner,
    plan: planMainDeployments({
      mode: input.mode,
      deploySha: input.deploySha,
      projectIds: input.projectIds,
      priorStates: input.priorStates,
      gitAdapter: git.adapter,
      runPlanner: planner.runPlanner,
    }),
  };
}

function assertActivationError(callback, target, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof MainActivationStateError);
    assert.equal(error.target, target);
    assert.equal(error.code, code);
    return true;
  });
}

test("groups distinct served bases, accumulates ranges, and unions targets in canonical order", () => {
  const input = fixture();
  const planner = createPlannerFixture(
    new Map([
      [
        "a".repeat(40),
        plannerOutput(
          "a".repeat(40),
          input.deploySha,
          ["governance"],
          "affected-packages",
        ),
      ],
      [
        "b".repeat(40),
        plannerOutput(
          "b".repeat(40),
          input.deploySha,
          ["app", "reserve"],
          "affected-packages",
        ),
      ],
      [
        "c".repeat(40),
        plannerOutput("c".repeat(40), input.deploySha, [], "non-runtime-only"),
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });

  assert.deepEqual(planner.calls, [
    { base: "a".repeat(40), head: input.deploySha },
    { base: "b".repeat(40), head: input.deploySha },
    { base: "c".repeat(40), head: input.deploySha },
  ]);
  assert.deepEqual(
    plan.ranges.map(({ base, targets, deployments, reason }) => ({
      base,
      targets,
      deployments,
      reason,
    })),
    [
      {
        base: "a".repeat(40),
        targets: ["app"],
        deployments: ["governance"],
        reason: "affected-packages",
      },
      {
        base: "b".repeat(40),
        targets: ["governance", "reserve"],
        deployments: ["app", "reserve"],
        reason: "affected-packages",
      },
      {
        base: "c".repeat(40),
        targets: ["ui"],
        deployments: [],
        reason: "non-runtime-only",
      },
    ],
  );
  assert.deepEqual(plan.plan, ["app", "governance", "reserve"]);
  assert.deepEqual(
    plan.priors.map(({ target, deploymentId, deploymentUrl, servedSha }) => ({
      target,
      deploymentId,
      deploymentUrl,
      servedSha,
    })),
    [
      {
        target: "app",
        deploymentId: "dpl_appA123",
        deploymentUrl: "https://app-main-a.vercel.app",
        servedSha: "a".repeat(40),
      },
      {
        target: "governance",
        deploymentId: "dpl_governanceB123",
        deploymentUrl: "https://governance-main-b.vercel.app",
        servedSha: "b".repeat(40),
      },
      {
        target: "reserve",
        deploymentId: "dpl_reserveB123",
        deploymentUrl: "https://reserve-main-b.vercel.app",
        servedSha: "b".repeat(40),
      },
      {
        target: "ui",
        deploymentId: "dpl_uiC123",
        deploymentUrl: "https://ui-main-c.vercel.app",
        servedSha: "c".repeat(40),
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(plan),
    /creatorUsername|projectId|projectName|readyState|customEnvironmentSlug/,
  );
});

test("a served base accumulates changes across skipped or superseded pushes", () => {
  const input = fixture();
  input.mode = "active";
  setAllTargetShas(input, input.deploySha);
  setTargetSha(input, "app", "a".repeat(40));
  const planner = createPlannerFixture(
    new Map([
      [
        "a".repeat(40),
        plannerOutput(
          "a".repeat(40),
          input.deploySha,
          ["app"],
          "affected-packages",
        ),
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(planner.calls, [
    { base: "a".repeat(40), head: input.deploySha },
  ]);
  assert.deepEqual(plan.plan, ["app"]);
  assert.equal(plan.ranges[0].base, "a".repeat(40));
  assert.equal(plan.ranges[0].head, input.deploySha);
});

test("a valid non-runtime result for every served range is an explained no-op", () => {
  const input = fixture();
  input.mode = "active";
  const { plan } = runFixture(input);
  assert.deepEqual(plan.plan, []);
  assert.deepEqual(plan.reasons, []);
  assert.equal(plan.ranges.length, 3);
  assert.ok(plan.ranges.every((range) => range.reason === "non-runtime-only"));
});

test("one valid global build-input range preserves the all-target planner result", () => {
  const input = fixture();
  input.mode = "active";
  const planner = createPlannerFixture(
    new Map([
      [
        "a".repeat(40),
        plannerOutput(
          "a".repeat(40),
          input.deploySha,
          [...MAIN_DEPLOYMENT_TARGETS],
          "global-build-input",
        ),
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, MAIN_DEPLOYMENT_TARGETS);
  assert.equal(plan.reasons[0].reason, "global-build-input");
});

test("App always plans from its reviewed v3 aliases and never legacy v2", () => {
  const input = fixture();
  input.mode = "active";
  const planner = createPlannerFixture();
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.priors[0].aliases, [
    "app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
  ]);
  assert.equal(planner.calls[0].base, "a".repeat(40));

  const v2Environment = fixture();
  for (const state of v2Environment.priorStates.app.states) {
    state.target = "production";
    state.customEnvironmentSlug = null;
    state.git.ref = "v2";
  }
  assertActivationError(
    () => runFixture(v2Environment),
    "app",
    "environment-identity-ambiguous",
  );

  const v2Alias = fixture();
  v2Alias.priorStates.app.states[1].alias = "v2-app.mento.org";
  assertActivationError(
    () => runFixture(v2Alias),
    "app",
    "alias-set-ambiguous",
  );
});

for (const [name, mutate, expectedReason, expectedServedSha] of [
  [
    "missing",
    (input) => {
      for (const state of input.priorStates.app.states) delete state.git;
    },
    "served-git-metadata-missing",
    null,
  ],
  [
    "malformed",
    (input) => {
      input.priorStates.app.states[0].git.sha = "main";
      input.priorStates.app.states[1].git.sha = "main";
    },
    "served-git-metadata-malformed",
    null,
  ],
  [
    "conflicting",
    (input) => {
      input.priorStates.app.states[1].git.sha = "9".repeat(40);
    },
    "served-git-metadata-conflicting",
    null,
  ],
  [
    "wrong repository",
    (input) => {
      for (const state of input.priorStates.app.states) {
        state.git.repo = "other-repository";
      }
    },
    "served-git-metadata-wrong-source",
    "a".repeat(40),
  ],
  [
    "wrong ref",
    (input) => {
      for (const state of input.priorStates.app.states) state.git.ref = "v2";
    },
    "served-git-metadata-wrong-source",
    "a".repeat(40),
  ],
]) {
  test(`${name} planning metadata selects only its affected target`, () => {
    const input = fixture();
    input.mode = "active";
    setTargetSha(input, "governance", input.deploySha);
    setTargetSha(input, "reserve", input.deploySha);
    setTargetSha(input, "ui", input.deploySha);
    mutate(input);
    const { plan, planner } = runFixture(input);
    assert.deepEqual(plan.plan, ["app"]);
    assert.deepEqual(plan.reasons, [
      {
        target: "app",
        reason: expectedReason,
        base: expectedServedSha,
      },
    ]);
    assert.equal(plan.priors[0].servedSha, expectedServedSha);
    assert.equal(planner.calls.length, 0);
  });
}

for (const [name, gitOptions, reason] of [
  [
    "unresolvable",
    { unresolvable: ["a".repeat(40)] },
    "served-git-sha-unresolvable",
  ],
  [
    "non-ancestor",
    { nonAncestors: ["a".repeat(40)] },
    "served-git-sha-not-ancestor",
  ],
]) {
  test(`${name} served SHA proof selects the affected target`, () => {
    const input = fixture();
    input.mode = "active";
    setTargetSha(input, "governance", input.deploySha);
    setTargetSha(input, "reserve", input.deploySha);
    setTargetSha(input, "ui", input.deploySha);
    const git = createGitFixture(input, gitOptions);
    const { plan } = runFixture(input, { git });
    assert.deepEqual(plan.plan, ["app"]);
    assert.deepEqual(plan.reasons, [
      { target: "app", reason, base: "a".repeat(40) },
    ]);
  });
}

test("planner execution failure selects every target that uses that served base", () => {
  const input = fixture();
  input.mode = "active";
  setTargetSha(input, "app", input.deploySha);
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([["b".repeat(40), new Error("private fixture error")]]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, ["governance", "reserve"]);
  assert.deepEqual(plan.ranges[1], {
    kind: "served",
    base: "b".repeat(40),
    head: input.deploySha,
    targets: ["governance", "reserve"],
    deployments: ["governance", "reserve"],
    reason: "planner-execution-failed",
  });
  assert.doesNotMatch(JSON.stringify(plan), /private fixture error/);
});

test("known fail-closed planner output selects only targets sharing the failed range", () => {
  const input = fixture();
  input.mode = "active";
  setTargetSha(input, "app", input.deploySha);
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([
      [
        "b".repeat(40),
        plannerOutput(
          "b".repeat(40),
          input.deploySha,
          [...MAIN_DEPLOYMENT_TARGETS],
          "turbo-planning-failed",
        ),
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, ["governance", "reserve"]);
  assert.equal(plan.ranges[1].reason, "turbo-planning-failed");
});

test("an unknowable affected set selects all four targets", () => {
  const input = fixture();
  input.mode = "active";
  setTargetSha(input, "governance", input.deploySha);
  setTargetSha(input, "reserve", input.deploySha);
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([
      [
        "a".repeat(40),
        {
          base: "a".repeat(40),
          head: input.deploySha,
          deployments: ["unknown"],
          reason: "affected-packages",
        },
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, MAIN_DEPLOYMENT_TARGETS);
  assert.equal(plan.ranges[0].reason, "planner-affected-set-unknown");
});

for (const [name, response] of [
  [
    "extra output fields",
    ({ base, head }) => ({
      ...plannerOutput(base, head, ["app"], "affected-packages"),
      rawVercelResponse: "must-not-cross",
    }),
  ],
  [
    "duplicate target output",
    ({ base, head }) =>
      plannerOutput(base, head, ["app", "app"], "affected-packages"),
  ],
  [
    "wrong range",
    ({ head }) =>
      plannerOutput("9".repeat(40), head, ["app"], "affected-packages"),
  ],
  [
    "non-runtime with a target",
    ({ base, head }) => plannerOutput(base, head, ["app"], "non-runtime-only"),
  ],
]) {
  test(`${name} is treated as malformed planner output`, () => {
    const input = fixture();
    input.mode = "active";
    setTargetSha(input, "governance", input.deploySha);
    setTargetSha(input, "reserve", input.deploySha);
    setTargetSha(input, "ui", input.deploySha);
    const planner = createPlannerFixture(new Map([["a".repeat(40), response]]));
    const { plan } = runFixture(input, { planner });
    assert.deepEqual(plan.plan, ["app"]);
    assert.equal(plan.ranges[0].reason, "planner-output-malformed");
    assert.doesNotMatch(
      JSON.stringify(plan),
      /rawVercelResponse|must-not-cross/,
    );
  });
}

test("shadow mode uses the first-parent delta when native Vercel already serves DEPLOY_SHA", () => {
  const input = fixture();
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([
      [
        input.firstParent,
        plannerOutput(
          input.firstParent,
          input.deploySha,
          ["ui"],
          "affected-packages",
        ),
      ],
    ]),
  );
  const { plan, git } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, ["ui"]);
  assert.deepEqual(plan.ranges.at(-1), {
    kind: "shadow-first-parent",
    base: input.firstParent,
    head: input.deploySha,
    targets: ["ui"],
    deployments: ["ui"],
    reason: "affected-packages",
  });
  assert.deepEqual(plan.reasons.at(-1), {
    target: "ui",
    reason: "shadow-native-already-current",
    base: input.firstParent,
  });
  assert.ok(
    git.calls.some(
      (call) => call[0] === "firstParent" && call[1] === input.deploySha,
    ),
  );
});

test("the shadow head-delta can select a target whose own served base differs", () => {
  const input = fixture();
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([
      [
        input.firstParent,
        plannerOutput(
          input.firstParent,
          input.deploySha,
          ["governance"],
          "affected-packages",
        ),
      ],
    ]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, ["governance"]);
  assert.deepEqual(plan.reasons.at(-1), {
    target: "governance",
    reason: "shadow-native-already-current",
    base: input.firstParent,
  });
});

test("active mode has no first-parent fallback for an already-current target", () => {
  const input = fixture();
  input.mode = "active";
  setAllTargetShas(input, input.deploySha);
  const { plan, git, planner } = runFixture(input);
  assert.deepEqual(plan.plan, []);
  assert.equal(planner.calls.length, 0);
  assert.equal(
    git.calls.some((call) => call[0] === "firstParent"),
    false,
  );
  assert.deepEqual(plan.ranges, [
    {
      kind: "served",
      base: input.deploySha,
      head: input.deploySha,
      targets: [...MAIN_DEPLOYMENT_TARGETS],
      deployments: [],
      reason: "served-sha-already-current",
    },
  ]);
});

test("an unresolvable first parent selects all four only in shadow mode", () => {
  const input = fixture();
  setTargetSha(input, "app", input.deploySha);
  const git = createGitFixture(input, { firstParentError: true });
  const { plan } = runFixture(input, { git });
  assert.deepEqual(plan.plan, MAIN_DEPLOYMENT_TARGETS);
  assert.equal(plan.ranges.at(-1).reason, "shadow-first-parent-unresolved");
  assert.deepEqual(
    plan.reasons.slice(-4).map((reason) => reason.reason),
    Array(4).fill("shadow-first-parent-unresolved"),
  );
});

test("a malformed shadow fallback plan selects its current-base target and keeps the required label", () => {
  const input = fixture();
  setTargetSha(input, "ui", input.deploySha);
  const planner = createPlannerFixture(
    new Map([[input.firstParent, new Error("fixture planner failure")]]),
  );
  const { plan } = runFixture(input, { planner });
  assert.deepEqual(plan.plan, ["ui"]);
  assert.equal(plan.ranges.at(-1).reason, "planner-execution-failed");
  assert.deepEqual(plan.reasons.at(-1), {
    target: "ui",
    reason: "shadow-native-already-current",
    base: input.firstParent,
  });
});

const activationAmbiguities = [
  {
    name: "missing protected alias",
    target: "governance",
    code: "alias-set-ambiguous",
    mutate(input) {
      input.priorStates.governance.states.pop();
    },
  },
  {
    name: "duplicated protected alias",
    target: "reserve",
    code: "alias-set-ambiguous",
    mutate(input) {
      input.priorStates.reserve.states[1].alias = "reserve.mento.org";
    },
  },
  {
    name: "unexpected protected alias",
    target: "ui",
    code: "alias-set-ambiguous",
    mutate(input) {
      input.priorStates.ui.states[1].alias = "unexpected.vercel.app";
    },
  },
  {
    name: "deployment alias disagreement",
    target: "governance",
    code: "alias-set-ambiguous",
    mutate(input) {
      input.priorStates.governance.states[1].aliases = [
        "governance.mento.org",
        "governancementoorg-mentolabs.vercel.app",
        "unexpected.vercel.app",
      ];
    },
  },
  {
    name: "wrong project ID",
    target: "app",
    code: "project-identity-ambiguous",
    mutate(input) {
      input.priorStates.app.states[0].projectId = "prj_wrong123";
    },
  },
  {
    name: "conflicting project name",
    target: "reserve",
    code: "project-identity-ambiguous",
    mutate(input) {
      input.priorStates.reserve.states[1].projectName = "other-project";
    },
  },
  {
    name: "wrong production environment",
    target: "ui",
    code: "environment-identity-ambiguous",
    mutate(input) {
      input.priorStates.ui.states[0].target = "preview";
    },
  },
  {
    name: "wrong app custom environment",
    target: "app",
    code: "environment-identity-ambiguous",
    mutate(input) {
      input.priorStates.app.states[1].customEnvironmentSlug = "preview";
    },
  },
  {
    name: "non-ready deployment",
    target: "governance",
    code: "prior-readiness-ambiguous",
    mutate(input) {
      input.priorStates.governance.states[0].readyState = "BUILDING";
    },
  },
  {
    name: "failed public health",
    target: "reserve",
    code: "prior-health-ambiguous",
    mutate(input) {
      input.priorStates.reserve.health = "failed";
    },
  },
  {
    name: "conflicting rollback deployment ID",
    target: "ui",
    code: "rollback-target-ambiguous",
    mutate(input) {
      input.priorStates.ui.states[1].deploymentId = "dpl_other123";
    },
  },
  {
    name: "conflicting rollback deployment URL",
    target: "app",
    code: "rollback-target-ambiguous",
    mutate(input) {
      input.priorStates.app.states[1].deploymentUrl =
        "https://other-app.vercel.app";
    },
  },
  {
    name: "malformed rollback deployment ID",
    target: "governance",
    code: "rollback-target-ambiguous",
    mutate(input) {
      input.priorStates.governance.states[0].deploymentId = "latest";
    },
  },
  {
    name: "non-Vercel rollback URL",
    target: "reserve",
    code: "rollback-target-ambiguous",
    mutate(input) {
      input.priorStates.reserve.states[0].deploymentUrl =
        "https://reserve.mento.org";
    },
  },
  {
    name: "raw Vercel field",
    target: "ui",
    code: "prior-state-forbidden-fields",
    mutate(input) {
      input.priorStates.ui.states[0].protectionBypass = "secret-must-not-cross";
    },
  },
];

for (const scenario of activationAmbiguities) {
  test(`activation-state ambiguity aborts before planning: ${scenario.name}`, () => {
    const input = fixture();
    let gitCalled = false;
    let plannerCalled = false;
    const gitAdapter = {
      firstParent() {
        gitCalled = true;
      },
      isAncestor() {
        gitCalled = true;
      },
      resolveCommit(value) {
        gitCalled = true;
        return value;
      },
    };
    scenario.mutate(input);
    assertActivationError(
      () =>
        planMainDeployments({
          mode: input.mode,
          deploySha: input.deploySha,
          projectIds: input.projectIds,
          priorStates: input.priorStates,
          gitAdapter,
          runPlanner: () => {
            plannerCalled = true;
          },
        }),
      scenario.target,
      scenario.code,
    );
    assert.equal(plannerCalled, false);
    assert.equal(
      gitCalled,
      true,
      "only immutable DEPLOY_SHA resolution may precede state validation",
    );
  });
}

test("invalid global input fails before any served-range planning", () => {
  const input = fixture();
  for (const override of [
    { mode: "preview" },
    { deploySha: "main" },
    {
      projectIds: {
        app: "prj_app123",
        governance: "prj_governance123",
        reserve: "prj_reserve123",
      },
    },
  ]) {
    assert.throws(() =>
      planMainDeployments({
        mode: input.mode,
        deploySha: input.deploySha,
        projectIds: input.projectIds,
        priorStates: input.priorStates,
        gitAdapter: createGitFixture(input).adapter,
        runPlanner: () => assert.fail("planner must remain inert"),
        ...override,
      }),
    );
  }
});

test("DEPLOY_SHA resolution failure aborts globally", () => {
  const input = fixture();
  const git = createGitFixture(input, {
    unresolvable: [input.deploySha],
  });
  assert.throws(
    () => runFixture(input, { git }),
    /DEPLOY_SHA cannot be resolved/,
  );
});

test("the default Git adapter uses immutable rev-parse and ancestry commands", () => {
  const calls = [];
  const head = "d".repeat(40);
  const parent = "c".repeat(40);
  const adapter = createMainPlanGitAdapter({
    repoRoot: "/trusted/repository",
    spawn(command, argumentsList, options) {
      calls.push({ command, argumentsList, options });
      if (argumentsList[0] === "merge-base") {
        return { status: 0, stdout: "" };
      }
      return {
        status: 0,
        stdout: `${argumentsList[2].includes("^1") ? parent : head}\n`,
      };
    },
  });
  assert.equal(adapter.resolveCommit(head), head);
  assert.equal(adapter.isAncestor(parent, head), true);
  assert.equal(adapter.firstParent(head), parent);
  assert.deepEqual(
    calls.map(({ command, argumentsList }) => [command, ...argumentsList]),
    [
      ["git", "rev-parse", "--verify", `${head}^{commit}`],
      ["git", "merge-base", "--is-ancestor", parent, head],
      ["git", "rev-parse", "--verify", `${head}^1^{commit}`],
    ],
  );
  assert.ok(
    calls.every(({ options }) => options.cwd === "/trusted/repository"),
  );
});

test("canonical output validation rejects appended machine or provider fields", () => {
  const input = fixture();
  input.mode = "active";
  const { plan } = runFixture(input);
  assert.equal(assertMainDeploymentPlan(plan), plan);
  assert.throws(
    () =>
      assertMainDeploymentPlan({
        ...plan,
        rawVercelResponse: { token: "must-not-cross" },
      }),
    /forbidden fields/,
  );
  assert.throws(
    () =>
      assertMainDeploymentPlan({
        ...plan,
        priors: [
          { ...plan.priors[0], protectionBypass: "must-not-cross" },
          ...plan.priors.slice(1),
        ],
      }),
    /forbidden fields/,
  );
});

test("the same canonical evidence produces byte-identical JSON", () => {
  const input = fixture();
  input.mode = "active";
  const first = runFixture(structuredClone(input)).plan;
  const second = runFixture(structuredClone(input)).plan;
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});
