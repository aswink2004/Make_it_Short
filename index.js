const express = require('express');
const { nanoid } = require('nanoid');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 4000;

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

// Create table if not exists
(async () => {
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
    console.log('✅ MySQL connected and table ready!');
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
  }
})();

// ─── Helper to get base URL ────────────────────────────────────
const getBaseUrl = (req) => {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
};

// ─── Routes ───────────────────────────────────────────────────

// Serve homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Shorten a URL
app.post('/shorten', async (req, res) => {
  const { url, customCode } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Include http:// or https://' });
  }

  try {
    const baseUrl = getBaseUrl(req);

    // Check if original URL already exists
    const [existing] = await db.query('SELECT code, short_url FROM urls WHERE original_url = ?', [url]);
    if (existing.length > 0) {
      const shortUrl = `${baseUrl}/${existing[0].code}`;
      return res.json({ shortUrl, code: existing[0].code });
    }

    let code = customCode ? customCode.trim() : nanoid(6);
    const [rows] = await db.query('SELECT code FROM urls WHERE code = ?', [code]);

    if (rows.length > 0) {
      if (customCode) {
        return res.status(409).json({ error: 'Custom alias already taken. Try another.' });
      }
      let exists = true;
      while (exists) {
        code = nanoid(6);
        const [check] = await db.query('SELECT code FROM urls WHERE code = ?', [code]);
        exists = check.length > 0;
      }
    }

    const shortUrl = `${baseUrl}/${code}`;
    await db.query('INSERT INTO urls (code, short_url, original_url, clicks) VALUES (?, ?, ?, 0)', [code, shortUrl, url]);

    console.log(`🔗 Saved: ${shortUrl} → ${url}`);
    res.json({ shortUrl, code });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all urls
app.get('/api/urls', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const [urls] = await db.query('SELECT * FROM urls ORDER BY created_at DESC');
    const result = urls.map(link => ({
      ...link,
      shortUrl: `${baseUrl}/${link.code}`
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Redirect short URL
app.get('/:code', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM urls WHERE code = ?', [req.params.code]);

    if (rows.length === 0) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }

    await db.query('UPDATE urls SET clicks = clicks + 1 WHERE code = ?', [req.params.code]);
    res.redirect(rows[0].original_url);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 URL Shortener running at http://localhost:${PORT}`);
});
