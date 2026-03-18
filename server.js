const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'urlshortener',
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDB() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS urls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(20) NOT NULL UNIQUE,
      short_url TEXT NOT NULL,
      original_url TEXT NOT NULL,
      clicks INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// GET /api/urls — list all URLs (with search, sort, filter)
app.get('/api/urls', async (req, res) => {
  try {
    const { search, sort = 'clicks_desc', filter } = req.query;

    let query = 'SELECT * FROM urls WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (code LIKE ? OR original_url LIKE ? OR short_url LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (filter === 'high') {
      query += ' AND clicks >= 50';
    } else if (filter === 'mid') {
      query += ' AND clicks >= 10 AND clicks < 50';
    } else if (filter === 'low') {
      query += ' AND clicks < 10';
    }

    const sortMap = {
      clicks_desc: 'clicks DESC',
      clicks_asc: 'clicks ASC',
      newest: 'created_at DESC',
      oldest: 'created_at ASC',
    };
    query += ` ORDER BY ${sortMap[sort] || 'clicks DESC'}`;

    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/urls/stats — summary metrics for dashboard
app.get('/api/urls/stats', async (req, res) => {
  try {
    const [[totals]] = await pool.execute(
      'SELECT COUNT(*) as total_urls, SUM(clicks) as total_clicks, MAX(clicks) as top_clicks FROM urls'
    );
    const avg = totals.total_urls > 0
      ? Math.round(totals.total_clicks / totals.total_urls)
      : 0;

    res.json({
      total_urls: totals.total_urls,
      total_clicks: totals.total_clicks || 0,
      avg_clicks: avg,
      top_clicks: totals.top_clicks || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/urls/chart/clicks — top URLs by clicks for bar chart
app.get('/api/urls/chart/clicks', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT code, clicks FROM urls ORDER BY clicks DESC LIMIT 8'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/urls/chart/created — URLs created per month for line chart
app.get('/api/urls/chart/created', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
      FROM urls
      GROUP BY month
      ORDER BY month ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/urls — create a new short URL
app.post('/api/urls', async (req, res) => {
  try {
    const { original_url } = req.body;
    if (!original_url) return res.status(400).json({ error: 'original_url is required' });

    const code = crypto.randomBytes(4).toString('hex');
    const base = process.env.BASE_URL || 'http://localhost:3000';
    const short_url = `${base}/${code}`;

    await pool.execute(
      'INSERT INTO urls (code, short_url, original_url) VALUES (?, ?, ?)',
      [code, short_url, original_url]
    );

    const [[row]] = await pool.execute('SELECT * FROM urls WHERE code = ?', [code]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:code — redirect and increment click count
app.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const [[row]] = await pool.execute('SELECT * FROM urls WHERE code = ?', [code]);

    if (!row) return res.status(404).json({ error: 'URL not found' });

    await pool.execute('UPDATE urls SET clicks = clicks + 1 WHERE code = ?', [code]);
    res.redirect(row.original_url);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/urls/:id — delete a URL
app.delete('/api/urls/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM urls WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
