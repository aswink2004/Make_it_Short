require('dotenv').config();
const express = require('express');
const { nanoid } = require('nanoid');
const path = require('path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_use_env_in_production';

app.use(express.json());
app.use(express.static('public'));

// MySQL Connection
const db = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'url_shortener',
  port:     process.env.DB_PORT     || 3306,
  waitForConnections: true,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  try {
    await db.query('SELECT 1');
    console.log('✅ MySQL connected!');
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
})();

// JWT Middleware
function verifyToken(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Please login first.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Session expired. Please login again.' });
  }
}

// SIGNUP
app.post('/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
   const [existingEmail] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
if (existingEmail.length > 0)
  return res.status(409).json({ error: 'Email already registered. Please login.' });

const [existingUsername] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
if (existingUsername.length > 0)
  return res.status(409).json({ error: 'Username already taken. Try another.' });

const hashed = await bcrypt.hash(password, 10);

const [result] = await db.query(
  'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
  [username, email, hashed]
);

const token = jwt.sign({ id: result.insertId, email, username }, JWT_SECRET, { expiresIn: '7d' });
    console.log('✅ New user:', email);
    res.status(201).json({ token, username, message: 'Account created!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed. Try again.' });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, rows[0].password);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email, username: rows[0].username },
      JWT_SECRET, { expiresIn: '7d' }
    );
    console.log('✅ Login:', email);
    res.json({ token, username: rows[0].username, message: 'Login successful!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Try again.' });
  }
});

// DASHBOARD — stats + links
app.get('/api/dashboard', verifyToken, async (req, res) => {
  try {
    const [links] = await db.query(
      'SELECT * FROM links WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const totalLinks = links.length;
    const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);
    const result = links.map(l => ({ ...l, short_url: `${BASE_URL}/${l.code}` }));
    res.json({ totalLinks, totalClicks, links: result, username: req.user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// SHORTEN URL
app.post('/shorten', verifyToken, async (req, res) => {
  const { url, customCode } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try { new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL. Include http:// or https://' }); }

  // Already shortened by this user?
  const [existingUrl] = await db.query(
    'SELECT code FROM links WHERE original_url = ? AND user_id = ?',
    [url, req.user.id]
  );
  if (existingUrl.length > 0) {
    return res.json({ shortUrl: `${BASE_URL}/${existingUrl[0].code}`, code: existingUrl[0].code, existing: true });
  }

  let code = customCode ? customCode.trim() : nanoid(6);
  const [taken] = await db.query('SELECT code FROM links WHERE code = ?', [code]);
  if (taken.length > 0) {
    if (customCode) return res.status(409).json({ error: 'Custom alias already taken.' });
    let exists = true;
    while (exists) {
      code = nanoid(6);
      const [c] = await db.query('SELECT code FROM links WHERE code = ?', [code]);
      exists = c.length > 0;
    }
  }

  const shortUrl = `${BASE_URL}/${code}`;
  await db.query(
    'INSERT INTO links (code, short_url, original_url, clicks, user_id) VALUES (?, ?, ?, 0, ?)',
    [code, shortUrl, url, req.user.id]
  );
  console.log(`🔗 ${req.user.username} → ${shortUrl}`);
  res.json({ shortUrl, code });
});

// DELETE LINK
app.delete('/api/links/:code', verifyToken, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM links WHERE code = ? AND user_id = ?', [req.params.code, req.user.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Link not found' });
  await db.query('DELETE FROM links WHERE code = ?', [req.params.code]);
  res.json({ message: 'Link deleted' });
});

// REDIRECT
app.get('/:code', async (req, res) => {
  if (['api', 'auth', 'favicon.ico'].includes(req.params.code))
    return res.status(404).send('Not found');
  const [rows] = await db.query('SELECT * FROM links WHERE code = ?', [req.params.code]);
  if (rows.length === 0)
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  await db.query('UPDATE links SET clicks = clicks + 1 WHERE code = ?', [req.params.code]);
  res.redirect(rows[0].original_url);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Running at ${BASE_URL} | PORT: ${PORT}\n`);
});
