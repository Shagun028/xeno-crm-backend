require('dotenv').config();
console.log('KEY EXISTS:', !!process.env.OPENROUTER_API_KEY);
console.log('KEY PREFIX:', process.env.OPENROUTER_API_KEY?.substring(0, 10));
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('./db');

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://xeno-crm-frontend-phi-ten.vercel.app'
  ]
}));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ─── sql.js HELPERS ───────────────────────────────────────────
// sql.js returns [{columns:[...], values:[[...],...]}]
function all(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows;
  } catch (e) {
    return [];
  }
}

function get(db, sql, params = []) {
  const rows = all(db, sql, params);
  return rows[0] || null;
}

function run(db, sql, params = []) {
  db.run(sql, params);
}

// ─── SEED ─────────────────────────────────────────────────────
function seedDatabase(db) {
  const existing = get(db, 'SELECT COUNT(*) as count FROM customers');
  if (existing && existing.count > 0) {
    console.log('DB already seeded');
    return;
  }

  console.log('Seeding database...');

  const customers = [
    { name: 'Aditi Sharma',  email: 'aditi@gmail.com',  phone: '+919876543210', city: 'Mumbai',    tags: 'vip,frequent' },
    { name: 'Rahul Mehta',   email: 'rahul@gmail.com',  phone: '+919876543211', city: 'Delhi',     tags: 'new' },
    { name: 'Priya Nair',    email: 'priya@gmail.com',  phone: '+919876543212', city: 'Bangalore', tags: 'vip' },
    { name: 'Karan Singh',   email: 'karan@gmail.com',  phone: '+919876543213', city: 'Chennai',   tags: 'frequent' },
    { name: 'Neha Joshi',    email: 'neha@gmail.com',   phone: '+919876543214', city: 'Pune',      tags: 'at-risk' },
    { name: 'Arjun Patel',   email: 'arjun@gmail.com',  phone: '+919876543215', city: 'Mumbai',    tags: 'vip,frequent' },
    { name: 'Sneha Reddy',   email: 'sneha@gmail.com',  phone: '+919876543216', city: 'Hyderabad', tags: 'new' },
    { name: 'Vikram Bose',   email: 'vikram@gmail.com', phone: '+919876543217', city: 'Kolkata',   tags: 'at-risk' },
    { name: 'Ananya Iyer',   email: 'ananya@gmail.com', phone: '+919876543218', city: 'Bangalore', tags: 'frequent' },
    { name: 'Dev Malhotra',  email: 'dev@gmail.com',    phone: '+919876543219', city: 'Delhi',     tags: 'vip' },
  ];

  const products = ['Silk Kurta', 'Denim Jacket', 'Linen Saree', 'Sneakers', 'Leather Handbag'];

  for (const c of customers) {
    const id = uuidv4();
    const numOrders = Math.floor(Math.random() * 5) + 1;
    let total = 0;
    let lastDate = null;

    const orders = [];
    for (let i = 0; i < numOrders; i++) {
      const amount = Math.floor(Math.random() * 4000) + 500;
      const date = new Date(Date.now() - Math.random() * 180 * 86400000).toISOString();
      total += amount;
      if (!lastDate || date > lastDate) lastDate = date;
      orders.push({ id: uuidv4(), customerId: id, amount, product: products[Math.floor(Math.random() * products.length)], date });
    }

    run(db, `INSERT INTO customers (id, name, email, phone, city, total_spent, order_count, last_order_date, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, c.name, c.email, c.phone, c.city, total, numOrders, lastDate, c.tags]);

    for (const o of orders) {
      run(db, `INSERT INTO orders (id, customer_id, amount, product, category, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
        [o.id, o.customerId, o.amount, o.product, 'fashion', o.date]);
    }
  }

  console.log('✅ Seed complete');
}

// ─── AI ───────────────────────────────────────────────────────
async function askAI(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openrouter/auto',
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenRouter status:', err.response?.status);
    console.error('OpenRouter data:', JSON.stringify(err.response?.data));
    console.error('OpenRouter message:', err.message);
    throw new Error('AI service unavailable');
  }
}

// ─── ROUTES ───────────────────────────────────────────────────
app.get('/', (_, res) => res.json({ status: 'ok', service: 'CRM API' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/customers', async (req, res) => {
  const db = await getDb();
  const customers = all(db, 'SELECT * FROM customers ORDER BY total_spent DESC');
  res.json(customers);
});

app.get('/api/customers/:id', async (req, res) => {
  const db = await getDb();
  const customer = get(db, 'SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const orders = all(db, 'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({ ...customer, orders });
});

app.get('/api/orders', async (req, res) => {
  const db = await getDb();
  const orders = all(db, `
    SELECT o.*, c.name as customer_name
    FROM orders o JOIN customers c ON o.customer_id = c.id
    ORDER BY o.created_at DESC
  `);
  res.json(orders);
});

app.get('/api/campaigns', async (req, res) => {
  const db = await getDb();
  const campaigns = all(db, 'SELECT * FROM campaigns ORDER BY created_at DESC');
  res.json(campaigns);
});

app.get('/api/campaigns/:id', async (req, res) => {
  const db = await getDb();
  const campaign = get(db, 'SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const stats = get(db, `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM communications WHERE campaign_id = ?
  `, [req.params.id]);

  const communications = all(db, `
    SELECT comm.*, c.name as customer_name
    FROM communications comm
    JOIN customers c ON comm.customer_id = c.id
    WHERE comm.campaign_id = ?
    ORDER BY comm.sent_at DESC
  `, [req.params.id]);

  res.json({ ...campaign, stats, communications });
});

app.post('/api/segment', async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });

  const db = await getDb();
  try {
    const query = await askAI(`You are a SQLite query generator for a CRM.
Schema:
  customers: id, name, email, phone, city, total_spent, order_count, last_order_date, tags
  orders: id, customer_id, amount, product, category, created_at
User wants to segment: "${description}"
Return ONLY a valid SQLite SELECT query fetching matching customers.
Always return: id, name, email, phone, city, total_spent, order_count, last_order_date, tags
No explanation. No markdown. Just raw SQL.`);

    const cleanQuery = query.replace(/```sql|```/g, '').trim();
    const customers = all(db, cleanQuery);
    res.json({ customers, count: customers.length, query: cleanQuery, description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/draft-message', async (req, res) => {
  const { campaignGoal, segmentDescription, sampleCustomer } = req.body;
  try {
    const message = await askAI(`You are a marketing copywriter for a D2C fashion brand.
Campaign goal: ${campaignGoal}
Target audience: ${segmentDescription}
Sample customer: ${JSON.stringify(sampleCustomer || {})}
Write a short personalized WhatsApp message (max 3 sentences).
Use {{name}} as placeholder. Return ONLY the message text.`);
    res.json({ message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/campaigns/send', async (req, res) => {
  const { name, segmentDescription, segmentQuery, messageTemplate, channel, customers } = req.body;
  if (!customers || customers.length === 0)
    return res.status(400).json({ error: 'No customers in audience' });

  const db = await getDb();
  const campaignId = uuidv4();
  const now = new Date().toISOString();

  run(db, `INSERT INTO campaigns (id, name, segment_description, segment_query, message_template, channel, status, audience_size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, ?)`,
    [campaignId, name, segmentDescription, segmentQuery || '', messageTemplate, channel || 'whatsapp', customers.length, now]);

  const communications = [];
  for (const customer of customers) {
    const commId = uuidv4();
    const personalizedMessage = messageTemplate.replace(/\{\{name\}\}/g, customer.name);
    run(db, `INSERT INTO communications (id, campaign_id, customer_id, message, channel, status, sent_at)
             VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
      [commId, campaignId, customer.id, personalizedMessage, channel || 'whatsapp', now]);
    communications.push({ commId, recipient: customer.phone, message: personalizedMessage, channel: channel || 'whatsapp' });
  }

  axios.post(`${process.env.CHANNEL_SERVICE_URL}/send`, { communications })
    .catch(err => console.error('Channel service error:', err.message));

  run(db, `UPDATE campaigns SET status = 'sent' WHERE id = ?`, [campaignId]);
  res.json({ campaignId, sent: communications.length, status: 'sent' });
});

app.post('/api/callbacks/receipt', async (req, res) => {
  const { commId, status, reason, timestamp } = req.body;
  const db = await getDb();

  if (status === 'failed') {
    run(db, `UPDATE communications SET status = 'failed', failed_reason = ? WHERE id = ?`, [reason || 'Unknown', commId]);
  } else if (status === 'delivered') {
    run(db, `UPDATE communications SET status = 'delivered', delivered_at = ? WHERE id = ?`, [timestamp, commId]);
  } else if (status === 'opened') {
    run(db, `UPDATE communications SET status = 'opened', opened_at = ? WHERE id = ?`, [timestamp, commId]);
  } else if (status === 'clicked') {
    run(db, `UPDATE communications SET status = 'clicked', clicked_at = ? WHERE id = ?`, [timestamp, commId]);
  }

  res.json({ ok: true });
});

app.get('/api/analytics', async (req, res) => {
  const db = await getDb();
  const totalCustomers = get(db, 'SELECT COUNT(*) as count FROM customers');
  const totalCampaigns = get(db, 'SELECT COUNT(*) as count FROM campaigns');
  const totalRevenue = get(db, 'SELECT SUM(total_spent) as sum FROM customers');
  const campaignStats = get(db, `
    SELECT
      COUNT(*) as total_comms,
      SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM communications
  `);
  const recentCampaigns = all(db, 'SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 5');

  res.json({
    totalCustomers: totalCustomers?.count || 0,
    totalCampaigns: totalCampaigns?.count || 0,
    totalRevenue: totalRevenue?.sum || 0,
    campaignStats,
    recentCampaigns
  });
});

app.get('/api/ai-insights', async (req, res) => {
  const db = await getDb();
  const vipInactive = get(db, `SELECT COUNT(*) as count FROM customers WHERE total_spent > 5000 AND (julianday('now') - julianday(last_order_date)) > 60`);
  const churnRisk = get(db, `SELECT COUNT(*) as count FROM customers WHERE (julianday('now') - julianday(last_order_date)) > 90`);
  const frequentBuyers = get(db, `SELECT COUNT(*) as count FROM customers WHERE order_count >= 5`);
  const totalRevenue = get(db, 'SELECT SUM(total_spent) as revenue FROM customers');

  res.json({
    vipInactive,
    churnRisk,
    frequentBuyers,
    totalRevenue,
    recommendations: [
      { title: 'VIP Re-engagement', audience: vipInactive?.count || 0, description: 'Customers spent over ₹5000 but inactive recently' },
      { title: 'Win Back Campaign', audience: churnRisk?.count || 0, description: 'Customers inactive for more than 90 days' },
      { title: 'Loyalty Reward', audience: frequentBuyers?.count || 0, description: 'Reward your most frequent shoppers' }
    ]
  });
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const lastMessage = messages[messages.length - 1]?.content || '';
  try {
    const text = await askAI(`You are an AI marketing assistant for a D2C fashion brand CRM.
Respond with JSON only:
{"type":"action","action":"segment","params":{"description":"..."},"message":"..."}
{"type":"action","action":"draft_message","params":{"campaignGoal":"...","segmentDescription":"..."},"message":"..."}
{"type":"message","action":null,"message":"your response"}
No markdown. Just raw JSON.
User said: "${lastMessage}"`);
    const clean = text.replace(/```json|```/g, '').trim();
    try { res.json(JSON.parse(clean)); }
    catch { res.json({ type: 'message', message: text, action: null }); }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

getDb().then(db => {
  seedDatabase(db);
  app.listen(PORT, () => console.log(`🚀 CRM API running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});