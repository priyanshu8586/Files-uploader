const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// File storage: har file uploads/ folder me save hoti hai
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

// Uploaded files serve karo (video seeking/range support ke saath)
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Upload (ek ya multiple files)
app.post("/upload", upload.array("files", 20), (req, res) => {
  res.json({ ok: true, count: req.files.length });
});

// Saari uploaded files ki list
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

// File delete
app.delete("/files/:name", (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false });
  fs.unlinkSync(full);
  res.json({ ok: true });
});

// Error handler (jaise file bahut badi ho)
app.use((err, req, res, next) => {
  res.status(400).json({ ok: false, error: err.message });
});

app.listen(PORT, () => console.log(`Server chal raha hai: http://localhost:${PORT}`));
