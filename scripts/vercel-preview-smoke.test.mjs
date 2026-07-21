import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyNativePreviewEvent,
  smokePreviewHttp,
  validatePreviewSmokeTuple,
} from "./vercel-preview-smoke.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const VERCEL_ACTOR = { login: "vercel[bot]", id: 35_613_825, type: "Bot" };
const URLS = {
  app: "https://appmento-abc123-mentolabs.vercel.app/",
  governance: "https://governancemento-abc123-mentolabs.vercel.app/",
  reserve: "https://reservemento-abc123-mentolabs.vercel.app/",
  ui: "https://uimento-abc123-mentolabs.vercel.app/",
};

function controllerTuple(target, overrides = {}) {
  return {
    logicalTarget: target,
    deploymentUrl: URLS[target],
    commitSha: SHA,
    pullRequestNumber: "520",
    githubDeploymentId: "1234",
    verificationMode: "controller",
    verificationKey: `vercel-preview:v1:pr:520:target:${target}:sha:${SHA}`,
    vercelDeploymentId: "dpl_Abc123",
    nextDeploymentId: `m-${target}-0123456789abcdef012`,
    expectedProjectId: `prj_${target}`,
    metadataLogicalTarget: target,
    metadataProjectId: `prj_${target}`,
    metadataTarget: "preview",
    metadataRepository: "mento-protocol/frontend-monorepo",
    metadataRef: "feature/multi-app-preview",
    metadataSha: SHA,
    metadataUrl: URLS[target],
    metadataEnvironment: "",
    metadataActorLogin: "",
    metadataActorId: "",
    metadataActorType: "",
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    eventName: "deployment_status",
    repository: "mento-protocol/frontend-monorepo",
    actor: "vercel[bot]",
    actorId: "35613825",
    triggeringActor: "vercel[bot]",
    triggeringActorId: "35613825",
    ...overrides,
  };
}

function nativeEvent(target = "app", overrides = {}) {
  const domain = target === "app" ? "app.mento.org" : "governance.mento.org";
  const project = target === "app" ? "appmento" : "governancemento";
  const environment = `Preview – ${domain}`;
  const url = `https://${project}-abc123-mentolabs.vercel.app`;
  return {
    repository: { full_name: "mento-protocol/frontend-monorepo" },
    sender: { ...VERCEL_ACTOR },
    deployment: {
      id: 1234,
      sha: SHA,
      ref: "feature/native-preview",
      task: "deploy",
      environment,
      production_environment: false,
      transient_environment: false,
      payload: {},
      creator: { ...VERCEL_ACTOR },
    },
    deployment_status: {
      state: "success",
      description: "Deployment has completed",
      environment,
      environment_url: url,
      log_url: url,
      creator: { ...VERCEL_ACTOR },
    },
    ...overrides,
  };
}

test("controller smoke tuple is target, project, SHA, and build-ID bound for all four targets", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const tuple = validatePreviewSmokeTuple(controllerTuple(target));
    assert.equal(tuple.logicalTarget, target);
    assert.equal(tuple.expectedProjectId, `prj_${target}`);
    assert.equal(tuple.nextDeploymentId, `m-${target}-0123456789abcdef012`);
    assert.throws(
      () =>
        validatePreviewSmokeTuple(
          controllerTuple(target, { metadataProjectId: "prj_wrong" }),
        ),
      /project ID mismatch/,
    );
    assert.throws(
      () =>
        validatePreviewSmokeTuple(
          controllerTuple(target, {
            nextDeploymentId: `${target === "ui" ? "m-app" : "m-ui"}-0123456789abcdef012`,
          }),
        ),
      /Next\.js deployment ID is missing or invalid/,
    );
  }
});

test("controller smoke rejects cross-target keys and lookalike project hosts", () => {
  assert.throws(
    () =>
      validatePreviewSmokeTuple(
        controllerTuple("reserve", {
          verificationKey: `vercel-preview:v1:pr:520:target:app:sha:${SHA}`,
        }),
      ),
    /Controller verification key does not match/,
  );
  assert.throws(
    () =>
      validatePreviewSmokeTuple(
        controllerTuple("app", {
          deploymentUrl: "https://appmentoevil-abc123-mentolabs.vercel.app/",
        }),
      ),
    /immutable target preview URL/,
  );
});

test("native classifier accepts only the exact Vercel actor and App or Governance preview success", () => {
  for (const target of ["app", "governance"]) {
    const classification = classifyNativePreviewEvent(
      nativeEvent(target),
      runtime(),
    );
    assert.equal(classification.eligible, true);
    assert.equal(classification.logicalTarget, target);
    assert.match(
      classification.verificationKey,
      /^vercel-native-preview:v1:deployment:1234:url-sha256:[0-9a-f]{64}$/,
    );
    const tuple = validatePreviewSmokeTuple({
      logicalTarget: classification.logicalTarget,
      deploymentUrl: classification.deploymentUrl,
      commitSha: classification.expectedSha,
      githubDeploymentId: classification.githubDeploymentId,
      verificationMode: classification.verificationMode,
      verificationKey: classification.verificationKey,
      metadataLogicalTarget: classification.metadataLogicalTarget,
      metadataTarget: classification.metadataTarget,
      metadataRepository: classification.metadataRepository,
      metadataRef: classification.metadataRef,
      metadataSha: classification.metadataSha,
      metadataUrl: classification.metadataUrl,
      metadataEnvironment: classification.metadataEnvironment,
      metadataActorLogin: classification.metadataActorLogin,
      metadataActorId: classification.metadataActorId,
      metadataActorType: classification.metadataActorType,
      pullRequestNumber: "",
      expectedProjectId: "",
      metadataProjectId: "",
      vercelDeploymentId: "",
      nextDeploymentId: "",
    });
    assert.equal(tuple.vercelDeploymentId, null);
    assert.equal(tuple.nextDeploymentId, null);
  }
});

test("native classifier rejects production, inactive, main, controller, and actor-lookalike events", () => {
  const production = nativeEvent("app");
  // Vercel's live GitHub metadata reports this boolean as false even for its
  // named Production/v3 Deployments. Exact environment names own routing.
  production.deployment.production_environment = false;
  production.deployment.environment = "v3 – app.mento.org";
  production.deployment_status.environment = "v3 – app.mento.org";
  assert.equal(
    classifyNativePreviewEvent(production, runtime()).eligible,
    false,
  );

  const inactive = nativeEvent("app");
  inactive.deployment_status.state = "inactive";
  inactive.deployment_status.description = "Skipped - Not affected";
  assert.equal(classifyNativePreviewEvent(inactive, runtime()).eligible, false);

  const main = nativeEvent("governance");
  main.deployment.ref = "main";
  assert.equal(classifyNativePreviewEvent(main, runtime()).eligible, false);

  const controller = nativeEvent("app");
  controller.deployment.payload = {
    controller_schema: "mento-vercel-prebuilt/v1",
  };
  assert.equal(
    classifyNativePreviewEvent(controller, runtime()).eligible,
    false,
  );

  const wrongActor = nativeEvent("app");
  wrongActor.deployment_status.creator = { ...VERCEL_ACTOR, id: 1 };
  assert.equal(
    classifyNativePreviewEvent(wrongActor, runtime()).eligible,
    false,
  );
  assert.equal(
    classifyNativePreviewEvent(nativeEvent("app"), runtime({ actor: "vercel" }))
      .eligible,
    false,
  );

  const misleadingBoolean = nativeEvent("governance");
  misleadingBoolean.deployment.production_environment = true;
  assert.equal(
    classifyNativePreviewEvent(misleadingBoolean, runtime()).eligible,
    true,
  );
});

function fakeResponse(url, body, { status = 200, headers = {} } = {}) {
  const normalizedHeaders = new Headers(headers);
  const encoded = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: String(url),
    headers: normalizedHeaders,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    async text() {
      return body;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
  };
}

test("common HTTP smoke checks target marker, headers, assets, and controller build identity", async () => {
  const values = controllerTuple("reserve");
  const requested = [];
  const html = `<title>Mento Reserve</title>
    <script src="/_next/static/app.js?dpl=${values.nextDeploymentId}"></script>
    <link rel="stylesheet" href="/_next/static/app.css?dpl=${values.nextDeploymentId}">
    <link rel="preload" href="/_next/static/font.woff2?dpl=${values.nextDeploymentId}">`;
  const fetchImplementation = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed.toString());
    if (parsed.pathname.startsWith("/_next/static/"))
      return fakeResponse(parsed, "asset");
    return fakeResponse(parsed, html, {
      headers: {
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
      },
    });
  };

  assert.deepEqual(await smokePreviewHttp({ values, fetchImplementation }), {
    logicalTarget: "reserve",
    deploymentUrl: values.deploymentUrl,
    commitSha: SHA,
    githubDeploymentId: 1234,
    checkedAssets: 3,
  });
  assert.equal(requested.length, 4);
});

test("common HTTP smoke fails closed on missing headers and mixed deployment assets", async () => {
  const values = controllerTuple("ui");
  const html = `<h1>Basic Components</h1>
    <script src="/_next/static/app.js?dpl=${values.nextDeploymentId}"></script>
    <link rel="stylesheet" href="/_next/static/app.css?dpl=wrong">
    <link rel="preload" href="/_next/static/font.woff2?dpl=${values.nextDeploymentId}">`;
  const response = (headers) => async (url) =>
    new URL(url).pathname.startsWith("/_next/static/")
      ? fakeResponse(url, "asset")
      : fakeResponse(url, html, { headers });

  await assert.rejects(
    smokePreviewHttp({ values, fetchImplementation: response({}) }),
    /content-security-policy/,
  );
  await assert.rejects(
    smokePreviewHttp({
      values,
      fetchImplementation: response({
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
      }),
    }),
    /target-bound build ID/,
  );
});

test("common HTTP smoke rejects representative assets redirected off the immutable origin", async () => {
  const values = controllerTuple("app");
  const html = `<title>Mento App</title>
    <script src="/_next/static/app.js?dpl=${values.nextDeploymentId}"></script>
    <link rel="stylesheet" href="/_next/static/app.css?dpl=${values.nextDeploymentId}">
    <link rel="preload" href="/_next/static/font.woff2?dpl=${values.nextDeploymentId}">`;
  const fetchImplementation = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/_next/static/")) {
      return fakeResponse(
        new URL(parsed.pathname, "https://assets.example.invalid"),
        "asset",
      );
    }
    return fakeResponse(parsed, html, {
      headers: {
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
      },
    });
  };

  await assert.rejects(
    smokePreviewHttp({ values, fetchImplementation }),
    /asset escaped the immutable deployment origin/,
  );
});

test("common HTTP smoke aborts a streaming response as soon as it exceeds 5 MiB", async () => {
  const values = controllerTuple("governance");
  let emittedChunks = 0;
  let observedSignal;
  const fetchImplementation = async (url, options) => {
    observedSignal = options.signal;
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: new Headers(),
      body: new ReadableStream({
        pull(controller) {
          emittedChunks += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
      }),
      async text() {
        throw new Error("response.text() must not buffer the stream");
      },
      async arrayBuffer() {
        throw new Error("response.arrayBuffer() must not buffer the stream");
      },
    };
  };

  await assert.rejects(
    smokePreviewHttp({ values, fetchImplementation }),
    /Preview response is too large/,
  );
  // Web streams may prefetch one chunk, but the reader stops immediately at
  // the first chunk that crosses the cap instead of draining the body.
  assert.ok(emittedChunks >= 6 && emittedChunks <= 7);
  assert.equal(observedSignal.aborted, true);
});
