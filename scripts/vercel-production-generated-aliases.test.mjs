import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertOnlyExpectedProductionGeneratedAliases,
  PRODUCTION_GENERATED_ALIAS_CONTRACTS,
  PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES,
} from "./vercel-production-generated-aliases.mjs";

const ORDINARY_TARGETS = ["governance", "reserve", "ui"];
const CREATOR_USERNAME = "fixture-author";

function creatorAlias(target, creatorUsername = CREATOR_USERNAME) {
  const { generatedProjectSlug, generatedScopeSlug } =
    PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
  return `${generatedProjectSlug}-${creatorUsername}-${generatedScopeSlug}.vercel.app`;
}

function subsets(values) {
  return values
    .flatMap((_, index) =>
      subsets(values.slice(index + 1)).map((subset) => [
        values[index],
        ...subset,
      ]),
    )
    .concat([[]]);
}

test("served-prior mode accepts every exact reviewed generated-alias subset", () => {
  for (const logicalTarget of ORDINARY_TARGETS) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[logicalTarget];
    for (const aliases of subsets([
      contract.generatedProjectAlias,
      contract.generatedProjectDefaultAlias,
      creatorAlias(logicalTarget),
      contract.generatedGitMainAlias,
    ])) {
      const canonicalAliases = aliases.toSorted();
      assert.deepEqual(
        assertOnlyExpectedProductionGeneratedAliases({
          aliases: canonicalAliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget,
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
        }),
        canonicalAliases,
        `${logicalTarget}: ${JSON.stringify(canonicalAliases)}`,
      );
    }
  }
});

test("candidate mode requires the project alias and permits only the exact creator alias", () => {
  for (const logicalTarget of ORDINARY_TARGETS) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[logicalTarget];
    for (const aliases of [
      [contract.generatedProjectAlias],
      [contract.generatedProjectAlias, creatorAlias(logicalTarget)].toSorted(),
    ]) {
      assert.deepEqual(
        assertOnlyExpectedProductionGeneratedAliases({
          aliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget,
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
        }),
        aliases,
      );
    }
  }
});

test("reused-candidate mode permits only the surviving candidate alias subset", () => {
  for (const logicalTarget of ORDINARY_TARGETS) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[logicalTarget];
    for (const aliases of subsets([
      contract.generatedProjectAlias,
      creatorAlias(logicalTarget),
    ])) {
      const canonicalAliases = aliases.toSorted();
      assert.deepEqual(
        assertOnlyExpectedProductionGeneratedAliases({
          aliases: canonicalAliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget,
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.REUSED_CANDIDATE,
        }),
        canonicalAliases,
        `${logicalTarget}: ${JSON.stringify(canonicalAliases)}`,
      );
    }
  }
});

// A served prior is provider state this pipeline does not own. Promoting a
// deployment gives it every production domain its project has, retired and
// redirect-configured ones included, so an exact generated-alias set is not a
// property a prior can be held to. Malformed evidence still fails closed.
test("served-prior mode tolerates unowned project domains but rejects malformed evidence", () => {
  const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance;
  for (const [name, aliases] of [
    [
      "retired custom-environment alias",
      ["appmentoorg-env-v3-mentolabs.vercel.app"],
    ],
    ["retired legacy domain", ["v2-app.mento.org"]],
    ["operator-added project domain", ["governance-preview.mento.org"]],
    [
      "unreviewed Git branch",
      [
        `${contract.generatedProjectSlug}-git-feature-${contract.generatedScopeSlug}.vercel.app`,
      ],
    ],
    [
      "creator near miss",
      [
        `${contract.generatedProjectSlug}-fixture-author2-${contract.generatedScopeSlug}.vercel.app`,
      ],
    ],
  ]) {
    assert.deepEqual(
      assertOnlyExpectedProductionGeneratedAliases({
        aliases,
        creatorUsername: CREATOR_USERNAME,
        logicalTarget: "governance",
        mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
      }),
      aliases,
      name,
    );
  }
  // Malformed alias evidence is still inadmissible: the prior's alias list has
  // to be a canonical, deduplicated, sorted hostname set.
  for (const [name, aliases] of [
    [
      "duplicate",
      [contract.generatedProjectAlias, contract.generatedProjectAlias],
    ],
    [
      "unsorted",
      [contract.generatedProjectAlias, contract.generatedGitMainAlias],
    ],
    ["malformed hostname", ["https://attacker.invalid/path"]],
  ]) {
    assert.throws(
      () =>
        assertOnlyExpectedProductionGeneratedAliases({
          aliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget: "governance",
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
        }),
      /generated-alias topology is malformed/,
      name,
    );
  }
});

// The one thing a served prior may never carry is another main target's
// reviewed protected domain: that would mean the reviewed mappings had crossed.
test("served-prior mode fails closed on another target's reviewed protected domain", () => {
  for (const [name, aliases] of [
    ["one foreign reviewed domain", ["app.mento.org"]],
    ["several foreign reviewed domains", ["app.mento.org", "ui.mento.org"]],
    [
      "foreign reviewed domain beside a legitimate project domain",
      ["app.mento.org", "governancementoorg.vercel.app"],
    ],
  ]) {
    assert.throws(
      () =>
        assertOnlyExpectedProductionGeneratedAliases({
          aliases: [...aliases].toSorted(),
          creatorUsername: CREATOR_USERNAME,
          logicalTarget: "governance",
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
          foreignProtectedAliases: [
            "app.mento.org",
            "reserve.mento.org",
            "ui.mento.org",
          ],
        }),
      /carries another target's reviewed protected domain/,
      name,
    );
  }
  // The target's own reviewed domain is never foreign to itself.
  assert.deepEqual(
    assertOnlyExpectedProductionGeneratedAliases({
      aliases: ["governance.mento.org"],
      creatorUsername: CREATOR_USERNAME,
      logicalTarget: "governance",
      mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR,
      foreignProtectedAliases: [
        "app.mento.org",
        "reserve.mento.org",
        "ui.mento.org",
      ],
    }),
    ["governance.mento.org"],
  );
});

// Candidate validation is untouched: a fresh upload that carries anything
// beyond its project alias and creator alias still fails closed.
test("candidate mode still rejects every alias a served prior now tolerates", () => {
  for (const alias of [
    "appmentoorg-env-v3-mentolabs.vercel.app",
    "v2-app.mento.org",
    "governance-preview.mento.org",
    PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance.generatedGitMainAlias,
    PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance
      .generatedProjectDefaultAlias,
  ]) {
    for (const mode of [
      PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
      PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.REUSED_CANDIDATE,
    ]) {
      assert.throws(
        () =>
          assertOnlyExpectedProductionGeneratedAliases({
            aliases: [
              alias,
              PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance
                .generatedProjectAlias,
            ].toSorted(),
            creatorUsername: CREATOR_USERNAME,
            logicalTarget: "governance",
            mode,
          }),
        /generated-alias topology mismatch/,
        `${mode} ${alias}`,
      );
    }
  }
});

test("candidate mode rejects missing-base and non-candidate generated aliases", () => {
  const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance;
  for (const [name, aliases] of [
    ["empty", []],
    ["creator only", [creatorAlias("governance")]],
    ["git-main only", [contract.generatedGitMainAlias]],
    ["project-default only", [contract.generatedProjectDefaultAlias]],
    [
      "base plus git-main",
      [contract.generatedGitMainAlias, contract.generatedProjectAlias],
    ],
    [
      "base plus project-default",
      [contract.generatedProjectAlias, contract.generatedProjectDefaultAlias],
    ],
    [
      "unreviewed Git branch",
      [
        contract.generatedProjectAlias,
        `${contract.generatedProjectSlug}-git-feature-${contract.generatedScopeSlug}.vercel.app`,
      ].toSorted(),
    ],
    [
      "custom",
      [
        contract.generatedProjectAlias,
        "governance-preview.mento.org",
      ].toSorted(),
    ],
    [
      "wrong target",
      [
        contract.generatedProjectAlias,
        PRODUCTION_GENERATED_ALIAS_CONTRACTS.reserve.generatedProjectAlias,
      ].toSorted(),
    ],
    [
      "creator near miss",
      [
        contract.generatedProjectAlias,
        `${contract.generatedProjectSlug}-fixture-author2-${contract.generatedScopeSlug}.vercel.app`,
      ].toSorted(),
    ],
  ]) {
    assert.throws(
      () =>
        assertOnlyExpectedProductionGeneratedAliases({
          aliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget: "governance",
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
        }),
      /generated-alias topology mismatch/,
      name,
    );
  }
});

test("reused-candidate mode rejects aliases outside the finite candidate set", () => {
  const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance;
  for (const [name, aliases] of [
    ["git-main", [contract.generatedGitMainAlias]],
    ["project-default", [contract.generatedProjectDefaultAlias]],
    ["protected", ["governance.mento.org"]],
    ["unknown", ["governance-preview.mento.org"]],
    [
      "wrong target",
      [PRODUCTION_GENERATED_ALIAS_CONTRACTS.reserve.generatedProjectAlias],
    ],
    [
      "creator near miss",
      [
        `${contract.generatedProjectSlug}-fixture-author2-${contract.generatedScopeSlug}.vercel.app`,
      ],
    ],
  ]) {
    assert.throws(
      () =>
        assertOnlyExpectedProductionGeneratedAliases({
          aliases,
          creatorUsername: CREATOR_USERNAME,
          logicalTarget: "governance",
          mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.REUSED_CANDIDATE,
        }),
      /reused-candidate generated-alias topology mismatch/,
      name,
    );
  }
});

test("creator aliases remain unavailable when creator identity cannot safely name them", () => {
  const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS.governance;
  for (const creatorUsername of [null, "git-main", "env-v3", "a".repeat(63)]) {
    assert.deepEqual(
      assertOnlyExpectedProductionGeneratedAliases({
        aliases: [contract.generatedProjectAlias],
        creatorUsername,
        logicalTarget: "governance",
        mode: PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.CANDIDATE,
      }),
      [contract.generatedProjectAlias],
    );
  }
});

test("generated-alias mode is mandatory and exact", () => {
  for (const mode of [undefined, null, "prior", "candidate "]) {
    assert.throws(
      () =>
        assertOnlyExpectedProductionGeneratedAliases({
          aliases: [],
          creatorUsername: null,
          logicalTarget: "ui",
          mode,
        }),
      /topology mode is malformed/,
    );
  }
});
