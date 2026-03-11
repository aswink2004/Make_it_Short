const express = require('express');
const { nanoid } = require('nanoid');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = 4000;

app.use(express.json());
app.use(express.static('public'));

// ─── MySQL Connection ──────────────────────────────────────────
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_NAME || 'url_shortener',
  waitForConnections: true,
});

// Test connection on startup
(async () => {
  try {
    await db.query('SELECT 1');
    console.log('✅ MySQL connected successfully!');
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('👉 Make sure XAMPP MySQL is running and database "url_shortener" exists');
    process.exit(1);
  }
})();

// ─── Routes ───────────────────────────────────────────────────

// Serve homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Shorten a URL
app.post('/shorten', async (req, res) => {
  const { url, customCode } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Include http:// or https://' });
  }

 // Check if original URL already exists in DB
const [existing] = await db.query('SELECT code, short_url FROM links WHERE original_url = ?', [url]);
if (existing.length > 0) {
  console.log(`🔁 URL already exists, returning existing short URL`);
  return res.json({ shortUrl: existing[0].short_url, code: existing[0].code });
}

let code = customCode ? customCode.trim() : nanoid(6);

const [rows] = await db.query('SELECT code FROM links WHERE code = ?', [code]);



  if (rows.length > 0) {
    if (customCode) {
      return res.status(409).json({ error: 'Custom alias already taken. Try another.' });
    }
    let exists = true;
    while (exists) {
      code = nanoid(6);
      const [check] = await db.query('SELECT code FROM links WHERE code = ?', [code]);
      exists = check.length > 0;
    }
  }

  const shortUrl = `http://localhost:${PORT}/${code}`;

  await db.query('INSERT INTO links (code ,short_url, original_url, clicks) VALUES (?, ?, ?, 0)', [code, shortUrl, url]);

  console.log(`🔗 Saved: ${shortUrl} → ${url}`);
  res.json({ shortUrl, code });
});

// Get all links
app.get('/api/links', async (req, res) => {
  const [links] = await db.query('SELECT * FROM links ORDER BY created_at DESC');
  const result = links.map(link => ({
    ...link,
    shortUrl: `http://localhost:${PORT}/${link.code}`
  }));
  res.json(result);
});

// Redirect short URL
app.get('/:code', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM links WHERE code = ?', [req.params.code]);

  if (rows.length === 0) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }

  const entry = rows[0];
  await db.query('UPDATE links SET clicks = clicks + 1 WHERE code = ?', [req.params.code]);

  res.redirect(entry.original_url);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 URL Shortener running at http://localhost:${PORT}`);
  // console.log(`📋 View all links at http://localhost:${PORT}/api/links\n`);
});
