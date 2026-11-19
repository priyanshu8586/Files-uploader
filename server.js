const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/* ============================================================
   GITHUB SETTINGS  -  yahan apni repo ki details daalo
   ============================================================
   1. GitHub par ek repo banao (jaise "my-vault-files")
   2. GitHub > Settings > Developer settings > Personal access tokens
      > Fine-grained token banao, sirf usi repo ka access do,
      aur "Contents: Read and write" permission do.
   3. Neeche owner, repo aur token bharo.

   Token kisi ko mat dikhao aur is file ko GitHub par push mat karo.
   Behtar tareeka: token ko environment variable me rakho:
       GITHUB_TOKEN=ghp_xxx node server.js
   ============================================================ */
const GITHUB = {
  owner: process.env.GITHUB_OWNER || "priyanshu8586",
  repo: process.env.GITHUB_REPO || "private",
  branch: process.env.GITHUB_BRANCH || "main",
  folder: process.env.GITHUB_FOLDER || "uploads", // repo ke andar folder
  token: process.env.GITHUB_TOKEN || "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",
  maxBytes: 50 * 1024 * 1024, // GitHub API se is size tak ki file push hogi
};
const GITHUB_ON =
  !GITHUB.owner.startsWith(priyanshu8586) &&
  !GITHUB.repo.startsWith(private) &&
  !GITHUB.token.startsWith(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);

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- GitHub helpers ---------- */
const ghUrl = (name) =>
  `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/` +
  [GITHUB.folder, name].filter(Boolean).map(encodeURIComponent).join("/");

const ghHeaders = (extra = {}) => ({
  Authorization: `Bearer ${GITHUB.token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "my-vault-app",
  ...extra,
});

async function ghErrorText(res) {
  let msg = `HTTP ${res.status}`;
  try { msg += ": " + ((await res.json()).message || ""); } catch (_) {}
  if (res.status === 401) msg += " (token galat ya expire ho gaya)";
  if (res.status === 404) msg += " (repo ka naam/owner galat hai, ya token ko is repo ka access nahi)";
  if (res.status === 403) msg += " (token me Contents: Read and write permission nahi hai)";
  return msg;
}

async function pushToGitHub(filePath, name) {
  const size = fs.statSync(filePath).size;
  if (size > GITHUB.maxBytes) {
    return { ok: false, error: `File ${(size / 1048576).toFixed(0)} MB hai. GitHub API se sirf ${GITHUB.maxBytes / 1048576} MB tak push hoti hai.` };
  }
  const content = fs.readFileSync(filePath).toString("base64");
  const res = await fetch(ghUrl(name), {
    method: "PUT",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message: `Upload ${name}`, content, branch: GITHUB.branch }),
  });
  if (!res.ok) return { ok: false, error: await ghErrorText(res) };
  return { ok: true };
}

async function deleteFromGitHub(name) {
  const get = await fetch(ghUrl(name) + `?ref=${encodeURIComponent(GITHUB.branch)}`, { headers: ghHeaders() });
  if (get.status === 404) return { ok: true };
  if (!get.ok) return { ok: false, error: await ghErrorText(get) };
  const { sha } = await get.json();
  const del = await fetch(ghUrl(name), {
    method: "DELETE",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message: `Delete ${name}`, sha, branch: GITHUB.branch }),
  });
  return del.ok ? { ok: true } : { ok: false, error: await ghErrorText(del) };
}

// Server restart ke baad (jaise Render par) GitHub se missing files wapas laao
async function restoreFromGitHub() {
  try {
    const res = await fetch(ghUrl("") + `?ref=${encodeURIComponent(GITHUB.branch)}`, { headers: ghHeaders() });
    if (!res.ok) { console.log("GitHub restore skip:", await ghErrorText(res)); return; }
    const items = (await res.json()).filter((i) => i.type === "file");
    for (const item of items) {
      const dest = path.join(UPLOAD_DIR, path.basename(item.name));
      if (fs.existsSync(dest)) continue;
      const raw = await fetch(ghUrl(item.name) + `?ref=${encodeURIComponent(GITHUB.branch)}`, {
        headers: ghHeaders({ Accept: "application/vnd.github.raw+json" }),
      });
      if (raw.ok) {
        fs.writeFileSync(dest, Buffer.from(await raw.arrayBuffer()));
        console.log("GitHub se wapas aayi:", item.name);
      }
    }
  } catch (e) {
    console.log("GitHub restore error:", e.message);
  }
}

/* ---------- File storage ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const original = Buffer.from(file.originalname, "latin1").toString("utf8");
    const safe = path.basename(original).replace(/[^\w.\- ]/g, "_");
    const id = crypto.randomBytes(4).toString("hex");
    cb(null, `${Date.now()}-${id}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Upload: pehle server par save, phir GitHub repo me push
app.post("/upload", upload.array("files", 20), async (req, res) => {
  const results = [];
  for (const f of req.files) {
    if (!GITHUB_ON) { results.push({ name: f.filename, github: "off" }); continue; }
    const r = await pushToGitHub(f.path, f.filename);
    results.push({ name: f.filename, github: r.ok ? "saved" : "failed", error: r.error });
    if (!r.ok) console.log("GitHub push fail:", f.filename, r.error);
  }
  res.json({ ok: true, count: req.files.length, githubEnabled: GITHUB_ON, results });
});

app.get("/files", (req, res) => {
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .map((name) => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, name));
      const displayName = name.replace(/^\d+-[0-9a-f]{8}-/, "");
      return {
        name,
        displayName,
        size: stat.size,
        uploadedAt: stat.mtimeMs,
        url: "/uploads/" + encodeURIComponent(name),
      };
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
  res.json(files);
});

app.delete("/files/:name", async (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false });
  fs.unlinkSync(full);
  if (GITHUB_ON) {
    const r = await deleteFromGitHub(name);
    if (!r.ok) console.log("GitHub delete fail:", name, r.error);
  }
  res.json({ ok: true });
});

// Errors (jaise file bahut badi ho) JSON me wapas jaate hain
app.use((err, req, res, next) => {
  const msg = err.code === "LIMIT_FILE_SIZE" ? "File 500 MB se badi hai" : err.message;
  res.status(400).json({ ok: false, error: msg });
});

app.listen(PORT, async () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
  if (GITHUB_ON) {
    console.log(`GitHub sync ON: ${GITHUB.owner}/${GITHUB.repo} (${GITHUB.branch}/${GITHUB.folder})`);
    await restoreFromGitHub();
  } else {
    console.log("GitHub sync OFF: server.js me owner, repo aur token bharo.");
  }
});
  
