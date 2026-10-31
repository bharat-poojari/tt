const assert = require("node:assert/strict");
const {test} = require("node:test");

process.env.GITHUB_OWNER = "test-owner";
process.env.GITHUB_REPO = "test-repo";
process.env.GITHUB_BRANCH = "main";
process.env.GITHUB_TOKEN = "test-token";

const handler = require("./data");

function githubFile(data, sha) {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      content: Buffer.from(JSON.stringify(data)).toString("base64"),
      sha
    })
  };
}

async function invoke(method, body) {
  const response = {headers: {}, statusCode: 0, body: null};
  response.setHeader = (name, value) => { response.headers[name] = value; };
  response.end = value => { response.body = JSON.parse(value); };
  await handler({method, body}, response);
  return response;
}

test("GET returns the shared records without caching", async t => {
  const data = {version: 1, records: {"2026-11-01": {wake: {status: "done"}}}};
  t.mock.method(global, "fetch", async () => githubFile(data, "sha-1"));

  const response = await invoke("GET");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, data);
  assert.equal(response.headers["Cache-Control"], "no-store, max-age=0");
});

test("POST writes a valid update and preserves existing records", async t => {
  const existing = {version: 1, records: {"2026-11-01": {wake: {status: "done"}}}};
  let written;
  t.mock.method(global, "fetch", async (url, options = {}) => {
    if (options.method === "PUT") {
      written = JSON.parse(options.body);
      return {ok: true, status: 200};
    }
    return githubFile(existing, "sha-1");
  });

  const response = await invoke("POST", {
    date: "2026-11-02",
    taskId: "volleyball",
    status: "missed",
    reason: "Rain"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.records["2026-11-01"], existing.records["2026-11-01"]);
  assert.equal(response.body.data.records["2026-11-02"].volleyball.status, "missed");
  assert.equal(response.body.data.records["2026-11-02"].volleyball.reason, "Rain");
  assert.equal(JSON.parse(Buffer.from(written.content, "base64").toString("utf8"))
    .records["2026-11-02"].volleyball.reason, "Rain");
});

test("POST rejects impossible calendar dates before accessing GitHub", async t => {
  let requests = 0;
  t.mock.method(global, "fetch", async () => { requests++; });

  const response = await invoke("POST", {
    date: "2026-11-31",
    taskId: "wake",
    status: "done"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(requests, 0);
});

test("POST retries a GitHub content conflict using the latest file", async t => {
  const first = {version: 1, records: {"2026-11-01": {wake: {status: "done"}}}};
  const latest = {version: 1, records: {"2026-11-01": {sleep: {status: "missed", reason: "Late"}}}};
  let reads = 0;
  let writes = 0;
  t.mock.method(global, "fetch", async (url, options = {}) => {
    if (options.method === "PUT") {
      writes++;
      if (writes === 1) {
        return {ok: false, status: 409, text: async () => "conflict"};
      }
      return {ok: true, status: 200};
    }
    reads++;
    return reads === 1 ? githubFile(first, "sha-1") : githubFile(latest, "sha-2");
  });

  const response = await invoke("POST", {
    date: "2026-11-02",
    taskId: "volleyball",
    status: "done"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(response.body.data.records["2026-11-01"].sleep.reason, "Late");
  assert.equal(response.body.data.records["2026-11-02"].volleyball.status, "done");
});
