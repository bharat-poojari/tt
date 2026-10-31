// Vercel serverless function: persistent shared JSON file in GitHub.
const START = "2026-11-01";
const END = "2026-12-30";
const TASK_IDS = new Set([
  "wake","volleyball","morning-routine","exercise","general-knowledge-1","break",
  "kannada","lunch","general-knowledge-2","evening-routine","english","computer",
  "dinner","revision","sleep"
]);
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const branch = process.env.GITHUB_BRANCH || "main";
const path = process.env.DATA_FILE_PATH || "data/data.json";
const token = process.env.GITHUB_TOKEN;
const encodedPath = path.split("/").map(encodeURIComponent).join("/");
const repositoryApi = `https://api.github.com/repos/${owner}/${repo}`;
const api = `${repositoryApi}/contents/${encodedPath}`;
const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "daily-accountability-tracker"
};
function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
}
async function readFile() {
  const r = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, {headers});
  if (r.status === 404) {
    const repositoryResponse = await fetch(repositoryApi, {headers});
    if (!repositoryResponse.ok)
      throw new Error(
        `Cannot access GitHub repository ${owner}/${repo} (${repositoryResponse.status}). ` +
        "Check GITHUB_OWNER and GITHUB_REPO, and make sure the GitHub token is authorized for this repository."
      );
    return {data:{version:1,records:{}},sha:null};
  }
  if (!r.ok) throw new Error(`GitHub read failed (${r.status}): ${await r.text()}`);
  const item = await r.json();
  if (!item || typeof item.content !== "string" || typeof item.sha !== "string")
    throw new Error("GitHub returned an invalid data file response.");
  const decoded = Buffer.from(item.content.replace(/\n/g,""),"base64").toString("utf8");
  const data = JSON.parse(decoded);
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !data.records || typeof data.records !== "object" || Array.isArray(data.records))
    throw new Error("The shared data file has an invalid format.");
  return {data,sha:item.sha};
}
async function writeFile(data, sha) {
  const content = Buffer.from(JSON.stringify(data,null,2)+"\n").toString("base64");
  const body = {message:"Update shared daily schedule data",content,branch};
  if (sha) body.sha=sha;
  const r = await fetch(api,{method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if (!r.ok) {
    const detail = await r.text();
    if (r.status === 403)
      throw new Error(
        `GitHub denied the write (403). Give the fine-grained token access to ${owner}/${repo} ` +
        "with Contents: Read and write permission, then update GITHUB_TOKEN in Vercel and redeploy. " +
        `GitHub response: ${detail}`
      );
    throw new Error(`GitHub write failed (${r.status}): ${detail}`);
  }
}
module.exports = async (req,res) => {
  if (!owner || !repo || !token)
    return send(res,500,{error:"Missing GitHub environment variables. Configure GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN."});
  try {
    if (req.method === "GET") {
      const {data}=await readFile();
      return send(res,200,data);
    }
    if (req.method !== "POST") {
      res.setHeader("Allow","GET, POST");
      return send(res,405,{error:"Method not allowed."});
    }
    const {date,taskId,status,reason=""}=req.body||{};
    const parsedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00.000Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0,10)!==date || date<START || date>END)
      return send(res,400,{error:"Date is outside the tracking period."});
    if (!TASK_IDS.has(taskId)) return send(res,400,{error:"Unknown task."});
    if (!["done","missed"].includes(status)) return send(res,400,{error:"Status must be done or missed."});
    if (status==="missed" && (typeof reason!=="string" || !reason.trim()))
      return send(res,400,{error:"A reason is required for missed tasks."});
    if (status==="missed" && reason.trim().length>1000)
      return send(res,400,{error:"The reason must be 1000 characters or fewer."});
    // Re-read and retry if another browser commits at nearly the same time.
    let lastError;
    for (let attempt=0;attempt<4;attempt++) {
      const current=await readFile();
      const next=current.data && typeof current.data==="object" ? current.data : {version:1,records:{}};
      if (!next.records || typeof next.records!=="object") next.records={};
      if (!next.records[date]) next.records[date]={};
      next.records[date][taskId]={status,reason:status==="missed"?reason.trim():"",updatedAt:new Date().toISOString()};
      try {
        await writeFile(next,current.sha);
        return send(res,200,{ok:true,data:next});
      } catch(e) {
        lastError=e;
        if (!String(e.message).includes("(409)")) throw e;
      }
    }
    throw lastError || new Error("Could not save after concurrent updates. Please retry.");
  } catch(e) {
    return send(res,500,{error:e.message||"Unexpected server error."});
  }
};