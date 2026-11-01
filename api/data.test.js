const assert = require("node:assert/strict");
const {test} = require("node:test");

process.env.GITHUB_OWNER = "test-owner";
process.env.GITHUB_REPO = "test-repo";
process.env.GITHUB_BRANCH = "main";
process.env.GITHUB_TOKEN = "test-token";

const handler = require("./data");
function todayInIndia() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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

test("GET reports inaccessible repositories instead of treating them as empty", async t => {
  t.mock.method(global, "fetch", async () => ({status: 404, ok: false}));

  const response = await invoke("GET");

  assert.equal(response.statusCode, 500);
  assert.match(response.body.error, /Cannot access GitHub repository test-owner\/test-repo \(404\)/);
});

test("GET reports a missing data file instead of returning empty records", async t => {
  t.mock.method(global, "fetch", async url => {
    if (url.startsWith("https://api.github.com/repos/test-owner/test-repo/contents/"))
      return {status: 404, ok: false};
    return {status: 200, ok: true};
  });

  const response = await invoke("GET");

  assert.equal(response.statusCode, 500);
  assert.match(response.body.error, /GitHub cannot read data\/data\.json on branch main/);
  assert.match(response.body.error, /Contents: Read and write permission/);
});

test("POST writes today's update and preserves existing records", async t => {
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
    date: todayInIndia(),
    taskId: "exercise",
    status: "missed",
    reason: "Rain"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.records["2026-11-01"].wake.status, "done");
  assert.equal(response.body.data.records[todayInIndia()].exercise.status, "missed");
  assert.equal(response.body.data.records[todayInIndia()].exercise.reason, "Rain");
  assert.equal(JSON.parse(Buffer.from(written.content, "base64").toString("utf8"))
    .records[todayInIndia()].exercise.reason, "Rain");
});

test("POST explains missing GitHub contents write permission", async t => {
  const existing = {version: 1, records: {}};
  t.mock.method(global, "fetch", async (url, options = {}) => {
    if (options.method === "PUT") {
      return {
        ok: false,
        status: 403,
        text: async () => '{"message":"Resource not accessible by personal access token"}'
      };
    }
    return githubFile(existing, "sha-1");
  });

  const response = await invoke("POST", {
    date: todayInIndia(),
    taskId: "wake",
    status: "done"
  });

  assert.equal(response.statusCode, 500);
  assert.match(response.body.error, /Contents: Read and write permission/);
  assert.match(response.body.error, /Resource not accessible by personal access token/);
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
    date: todayInIndia(),
    taskId: "exercise",
    status: "done"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(response.body.data.records["2026-11-01"].sleep.reason, "Late");
  assert.equal(response.body.data.records[todayInIndia()].exercise.status, "done");
});

test("POST rejects updates for any date other than today before accessing GitHub", async t => {
  let requests = 0;
  t.mock.method(global, "fetch", async () => { requests++; });
  const yesterday = new Date(`${todayInIndia()}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const response = await invoke("POST", {
    date: yesterday.toISOString().slice(0, 10),
    taskId: "wake",
    status: "done"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Tasks can only be updated for today.");
  assert.equal(requests, 0);
});

test("POST rejects the removed volleyball task", async t => {
  let requests = 0;
  t.mock.method(global, "fetch", async () => { requests++; });

  const response = await invoke("POST", {
    date: todayInIndia(),
    taskId: "volleyball",
    status: "done"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Unknown task.");
  assert.equal(requests, 0);
});
