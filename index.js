const express = require('express');
const { nanoid } = require('nanoid');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static('public'));


// ─── MySQL Connection ─────────────────────────────
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_NAME || process.env.MYSQL_DATABASE || 'url_shortener',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


// ─── Create table if not exists ───────────────────
async function initDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS urls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        short_url TEXT NOT NULL,
        original_url TEXT NOT NULL,
        clicks INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ MySQL connected and table ready");
  } catch (err) {
    console.error("❌ DB Initialization failed:", err.message);
  }
}

initDB();


// ─── Helper: Base URL ─────────────────────────────
const getBaseUrl = (req) => {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
};


// ─── Homepage ─────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ─── Shorten URL ──────────────────────────────────
app.post('/shorten', async (req, res) => {

  const { url, customCode } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      error: "Invalid URL format. Use http:// or https://"
    });
  }

  try {

    const baseUrl = getBaseUrl(req);

    // Check if URL already exists
    const [existing] = await db.query(
      "SELECT code FROM urls WHERE original_url = ?",
      [url]
    );

    if (existing.length > 0) {
      return res.json({
        shortUrl: `${baseUrl}/${existing[0].code}`,
        code: existing[0].code
      });
    }


    // Generate code
    // let code = customCode ? customCode.trim() : nanoid(6);
    let code;

if (customCode) {
  if (customCode.includes('http') || customCode.includes('/')) {
    return res.status(400).json({ error: "Invalid custom alias" });
  }
  code = customCode.trim();
} else {
  code = nanoid(6);
}

    const [check] = await db.query(
      "SELECT code FROM urls WHERE code = ?",
      [code]
    );

    if (check.length > 0) {

      if (customCode) {
        return res.status(409).json({
          error: "Custom alias already taken"
        });
      }

      let exists = true;

      while (exists) {
        code = nanoid(6);
        const [verify] = await db.query(
          "SELECT code FROM urls WHERE code = ?",
          [code]
        );
        exists = verify.length > 0;
      }
    }


    const shortUrl = `${baseUrl}/${code}`;

    await db.query(
      "INSERT INTO urls (code, short_url, original_url, clicks) VALUES (?, ?, ?, 0)",
      [code, shortUrl, url]
    );


    console.log(`🔗 Saved: ${shortUrl} → ${url}`);

    res.json({
      shortUrl,
      code
    });

  } catch (err) {

    console.error("❌ Error:", err.message);

    res.status(500).json({
      error: "Server error"
    });
  }
});


// ─── Get All Links ───────────────────────────────
app.get('/api/links', async (req, res) => {

  try {

    const baseUrl = getBaseUrl(req);

    const [rows] = await db.query(
      "SELECT * FROM urls ORDER BY created_at DESC"
    );

    const result = rows.map(link => ({
      ...link,
      shortUrl: `${baseUrl}/${link.code}`
    }));

    res.json(result);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});


// ─── Redirect Short URL ──────────────────────────
app.get('/:code', async (req, res) => {

  try {

    const { code } = req.params;

    const [rows] = await db.query(
      "SELECT * FROM urls WHERE code = ?",
      [code]
    );

    if (rows.length === 0) {

      return res.status(404).sendFile(
        path.join(__dirname, 'public', '404.html')
      );
    }

    await db.query(
      "UPDATE urls SET clicks = clicks + 1 WHERE code = ?",
      [code]
    );

    res.redirect(rows[0].original_url);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});


// ─── Start Server ─────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});