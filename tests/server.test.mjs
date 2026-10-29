import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { createPracticeServer } from "../server.mjs";
import {
  emptyProgress,
  recordGrade,
} from "../server/generated/progress-model.mjs";

let app, directory, base, bank;
async function start() {
  app = await createPracticeServer({ dataDirectory: directory });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
}
async function request(route, body, device, extra = {}) {
  const response = await fetch(base + route, {
    method:
      body === undefined ? "GET" : route === "/api/progress" ? "PUT" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(device ? { Cookie: device.cookie, "X-Account-Id": device.id } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
}
async function login(username = "test_learner", register = false) {
  const result = await request(`/api/auth/${register ? "register" : "login"}`, {
    username,
    password: "example-password-821",
  });
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly/);
  return { cookie: result.cookie.split(";")[0], id: result.body.user.id };
}
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hcip-backend-"));
  bank = JSON.parse(
    await readFile(new URL("../public/bank.json", import.meta.url), "utf8"),
  );
  await start();
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});
let first, second, saved;
test("same-origin backend and reverse-proxy Host work; unauthenticated data is protected", async () => {
  const page = await fetch(base + "/", {
    headers: { Host: "practice.example.com" },
  });
  assert.equal(page.status, 200);
  assert.equal((await request("/api/progress")).status, 401);
  const blocked = await request(
    "/api/auth/register",
    { username: "cross_site", password: "password-821" },
    undefined,
    { Origin: "https://other.example.com" },
  );
  assert.equal(blocked.status, 403);
  assert.equal((await request("/api/unknown")).status, 404);
  assert.equal((await fetch(base + "/data/store.json")).status, 404);
});
test("registers and signs in on a second device without sharing cookies", async () => {
  first = await login("test_learner", true);
  second = await login();
  assert.equal(first.id, second.id);
  assert.notEqual(first.cookie, second.cookie);
  assert.deepEqual((await request("/api/progress", undefined, first)).body, {
    revision: 0,
    progress: null,
  });
  assert.equal(
    (
      await request("/api/auth/login", {
        username: "test_learner",
        password: "wrong-password",
      })
    ).status,
    401,
  );
});
test("saves answers, bookmarks, chapter and cursor, then reads them on another device", async () => {
  const p = emptyProgress(bank);
  p.session.answers["821-Q003"] = "D";
  saved = recordGrade(p, "821-Q003", "correct");
  saved.session.cursor = 4;
  saved.favoriteIds = ["821-Q003"];
  assert.equal(
    (await request("/api/progress", { revision: 0, progress: saved }, first))
      .status,
    200,
  );
  const other = await request("/api/progress", undefined, second);
  assert.equal(other.body.revision, 1);
  assert.deepEqual(other.body.progress, saved);
});
test("rejects stale writes and concurrent saves instead of losing an answer", async () => {
  const stale = await request(
    "/api/progress",
    { revision: 0, progress: emptyProgress(bank) },
    second,
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.progress, saved);
  const writes = await Promise.all(
    [first, second].map((device) =>
      request("/api/progress", { revision: 1, progress: saved }, device),
    ),
  );
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
});
test("separates user accounts and rejects a cookie changed to another user", async () => {
  const third = await login("separate_learner", true);
  assert.equal(
    (await request("/api/progress", undefined, third)).body.progress,
    null,
  );
  assert.equal(
    (
      await request(
        "/api/progress",
        { revision: 0, progress: saved },
        { ...third, id: first.id },
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/api/progress", undefined, first)).body.progress.records[
      "821-Q003"
    ].correct,
    1,
  );
});
test("validates imported progress using the same grading rules as the browser", async () => {
  const invalid = structuredClone(saved);
  invalid.session.answers["821-Q003"] = "A";
  const result = await request(
    "/api/progress",
    { revision: 2, progress: invalid },
    first,
  );
  assert.equal(result.status, 400);
  assert.equal(
    (await request("/api/progress", undefined, first)).body.revision,
    2,
  );
});
test("persists users, hashed passwords, sessions and progress across a server restart", async () => {
  await app.close();
  const disk = await readFile(path.join(directory, "store.json"), "utf8");
  assert.ok(!disk.includes("example-password-821"));
  assert.ok(!disk.includes(first.cookie.split("=")[1]));
  await start();
  const restored = await request("/api/progress", undefined, second);
  assert.equal(restored.body.revision, 2);
  assert.deepEqual(restored.body.progress, saved);
});
test("logout revokes only this device's session and preserves the other device", async () => {
  assert.equal((await request("/api/auth/logout", {}, first)).status, 200);
  assert.equal((await request("/api/progress", undefined, first)).status, 401);
  assert.equal((await request("/api/progress", undefined, second)).status, 200);
});

test("supports HTTPS proxy headers and issues a Secure session cookie", async () => {
  const proxyApp = await createPracticeServer({
    dataDirectory: path.join(directory, "proxy"),
    trustProxy: true,
  });
  await new Promise((resolve) =>
    proxyApp.server.listen(0, "127.0.0.1", resolve),
  );
  try {
    // Native HTTP keeps the exact upstream Host header used by Nginx.
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port: proxyApp.server.address().port,
          path: "/api/auth/register",
          method: "POST",
          headers: {
            Host: "quiz.example.com",
            Origin: "https://quiz.example.com",
            "X-Forwarded-Proto": "https",
            "Content-Type": "application/json",
          },
        },
        (result) => {
          result.resume();
          result.on("end", () => resolve(result));
        },
      );
      request.on("error", reject);
      request.end(
        JSON.stringify({
          username: "proxy_learner",
          password: "test-password-821",
        }),
      );
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["set-cookie"][0], /; Secure/);
  } finally {
    await proxyApp.close();
  }
});

test("refuses concurrent processes for one data directory", async () => {
  await assert.rejects(
    () => createPracticeServer({ dataDirectory: directory }),
    /already in use/,
  );
});
