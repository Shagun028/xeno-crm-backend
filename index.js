require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());



app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

async function askAI(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
            model: 'openrouter/free',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    )

    return response.data.choices[0].message.content.trim()
  } catch (err) {
    console.error(
      'OpenRouter Error:',
      err.response?.data || err.message
    )

    throw new Error('AI service unavailable')
  }
}

// ─── CUSTOMERS ───────────────────────────────────────────────
app.get('/api/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY total_spent DESC').all();
  res.json(customers);
});

app.get('/api/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...customer, orders });
});

// ─── ORDERS ──────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name 
    FROM orders o JOIN customers c ON o.customer_id = c.id 
    ORDER BY o.created_at DESC
  `).all();
  res.json(orders);
});

// ─── AI SEGMENTATION ─────────────────────────────────────────
app.post('/api/segment', async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });

  const schema = `
    customers: id, name, email, phone, city, total_spent (number), order_count (number), last_order_date (ISO string), tags (comma-separated like 'vip,frequent')
    orders: id, customer_id, amount, product, category, created_at
  `;

  try {
    const query = await askAI(`You are a SQLite query generator for a CRM.
Schema: ${schema}
User wants to segment: "${description}"
Return ONLY a valid SQLite SELECT query fetching matching customers.
Always return: id, name, email, phone, city, total_spent, order_count, last_order_date, tags
You may JOIN orders if needed. No explanation. No markdown. Just raw SQL.`);

    const cleanQuery = query.replace(/```sql|```/g, '').trim();

    let customers;
    try {
      customers = db.prepare(cleanQuery).all();
    } catch (e) {
      return res.status(400).json({ error: 'AI generated invalid SQL', details: e.message, query: cleanQuery });
    }

    res.json({ customers, count: customers.length, query: cleanQuery, description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI MESSAGE DRAFT ─────────────────────────────────────────
app.post('/api/draft-message', async (req, res) => {
  const { campaignGoal, segmentDescription, sampleCustomer } = req.body;

  try {
    const message = await askAI(`You are a marketing copywriter for a D2C fashion brand.
Campaign goal: ${campaignGoal}
Target audience: ${segmentDescription}
Sample customer: ${JSON.stringify(sampleCustomer || {})}
Write a short personalized WhatsApp message (max 3 sentences).
Use {{name}} as placeholder for customer name.
Make it feel human, not salesy. Return ONLY the message text.`);

    res.json({ message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CAMPAIGNS ───────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  res.json(campaigns);
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const stats = db.prepare(`
  SELECT
    COUNT(*) as total,

    SUM(
      CASE WHEN sent_at IS NOT NULL
      THEN 1 ELSE 0 END
    ) as sent,

    SUM(
      CASE WHEN delivered_at IS NOT NULL
      THEN 1 ELSE 0 END
    ) as delivered,

    SUM(
      CASE WHEN opened_at IS NOT NULL
      THEN 1 ELSE 0 END
    ) as opened,

    SUM(
      CASE WHEN clicked_at IS NOT NULL
      THEN 1 ELSE 0 END
    ) as clicked,

    SUM(
      CASE WHEN status = 'failed'
      THEN 1 ELSE 0 END
    ) as failed

  FROM communications
  WHERE campaign_id = ?
`).get(req.params.id);

  const communications = db.prepare(`
    SELECT comm.*, c.name as customer_name 
    FROM communications comm 
    JOIN customers c ON comm.customer_id = c.id 
    WHERE comm.campaign_id = ?
    ORDER BY comm.sent_at DESC
  `).all(req.params.id);

  res.json({ ...campaign, stats, communications });
});

// ─── SEND CAMPAIGN ────────────────────────────────────────────
app.post('/api/campaigns/send', async (req, res) => {
  const { name, segmentDescription, segmentQuery, messageTemplate, channel, customers } = req.body;

  if (!customers || customers.length === 0)
    return res.status(400).json({ error: 'No customers in audience' });

  const campaignId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO campaigns (id, name, segment_description, segment_query, message_template, channel, status, audience_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, ?)
  `).run(campaignId, name, segmentDescription, segmentQuery || '', messageTemplate, channel || 'whatsapp', customers.length, now);

  const insertComm = db.prepare(`
    INSERT INTO communications (id, campaign_id, customer_id, message, channel, status, sent_at)
    VALUES (?, ?, ?, ?, ?, 'sent', ?)
  `);

  const communications = [];
  for (const customer of customers) {
    const commId = uuidv4();
    const personalizedMessage = messageTemplate.replace(/\{\{name\}\}/g, customer.name);
    insertComm.run(commId, campaignId, customer.id, personalizedMessage, channel || 'whatsapp', now);
    communications.push({ commId, recipient: customer.phone, message: personalizedMessage, channel: channel || 'whatsapp' });
  }

  axios.post(`${process.env.CHANNEL_SERVICE_URL}/send`, { communications })
    .catch(err => console.error('Channel service error:', err.message));

  db.prepare(`UPDATE campaigns SET status = 'sent' WHERE id = ?`).run(campaignId);

  res.json({ campaignId, sent: communications.length, status: 'sent' });
});

// ─── CALLBACKS FROM CHANNEL SERVICE ──────────────────────────
app.post('/api/callbacks/receipt', (req, res) => {
  const { commId, status, reason, timestamp } = req.body;

  const statusField = {
    delivered: 'delivered_at',
    opened: 'opened_at',
    clicked: 'clicked_at',
  }[status];

  if (status === 'failed') {
    db.prepare(`UPDATE communications SET status = 'failed', failed_reason = ? WHERE id = ?`)
      .run(reason || 'Unknown', commId);
  } else if (statusField) {
    db.prepare(`UPDATE communications SET status = ?, ${statusField} = ? WHERE id = ?`)
      .run(status, timestamp, commId);
  }

  res.json({ ok: true });
});

// ─── ANALYTICS ───────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  const totalCustomers =
    db.prepare(
      'SELECT COUNT(*) as count FROM customers'
    ).get().count

  const totalCampaigns =
    db.prepare(
      'SELECT COUNT(*) as count FROM campaigns'
    ).get().count

  const totalRevenue =
    db.prepare(
      'SELECT SUM(total_spent) as sum FROM customers'
    ).get().sum || 0

  const campaignStats = db.prepare(`
    SELECT
      COUNT(*) as total_comms,

      SUM(
        CASE
        WHEN delivered_at IS NOT NULL
        THEN 1 ELSE 0
        END
      ) as delivered,

      SUM(
        CASE
        WHEN opened_at IS NOT NULL
        THEN 1 ELSE 0
        END
      ) as opened,

      SUM(
        CASE
        WHEN clicked_at IS NOT NULL
        THEN 1 ELSE 0
        END
      ) as clicked,

      SUM(
        CASE
        WHEN status = 'failed'
        THEN 1 ELSE 0
        END
      ) as failed

    FROM communications
  `).get()

  const recentCampaigns = db.prepare(`
    SELECT *
    FROM campaigns
    ORDER BY created_at DESC
    LIMIT 5
  `).all()

  res.json({
    totalCustomers,
    totalCampaigns,
    totalRevenue,
    campaignStats,
    recentCampaigns
  })
})
app.get('/api/ai-insights', async (req, res) => {
  try {
    const vipInactive = db.prepare(`
      SELECT COUNT(*) as count
      FROM customers
      WHERE total_spent > 5000
      AND (
        julianday('now') -
        julianday(last_order_date)
      ) > 60
    `).get()

    const churnRisk = db.prepare(`
      SELECT COUNT(*) as count
      FROM customers
      WHERE (
        julianday('now') -
        julianday(last_order_date)
      ) > 90
    `).get()

    const frequentBuyers = db.prepare(`
      SELECT COUNT(*) as count
      FROM customers
      WHERE order_count >= 5
    `).get()

    const totalRevenue = db.prepare(`
      SELECT SUM(total_spent) as revenue
      FROM customers
    `).get()

    const recommendations = [
      {
        title: 'VIP Re-engagement',
        audience: vipInactive.count,
        description:
          'Customers spent over ₹5000 but have not purchased recently'
      },
      {
        title: 'Win Back Campaign',
        audience: churnRisk.count,
        description:
          'Customers inactive for more than 90 days'
      },
      {
        title: 'Loyalty Reward',
        audience: frequentBuyers.count,
        description:
          'Reward your most frequent shoppers'
      }
    ]

    res.json({
      vipInactive,
      churnRisk,
      frequentBuyers,
      totalRevenue,
      recommendations
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: 'Failed to generate insights'
    })
  }
})

// ─── AI CHAT ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const lastMessage = messages[messages.length - 1]?.content || '';

  const prompt = `You are an AI marketing assistant for a D2C fashion brand CRM.
When the user wants to do something, respond with JSON in this exact format:
{"type":"action","action":"segment","params":{"description":"..."},"message":"..."}
{"type":"action","action":"draft_message","params":{"campaignGoal":"...","segmentDescription":"..."},"message":"..."}
{"type":"action","action":"send_campaign","params":{"name":"..."},"message":"..."}
{"type":"message","action":null,"message":"your response"}

Actions available: segment, draft_message, send_campaign, show_analytics
If just chatting, use type "message".
Return ONLY valid JSON. No markdown. No extra text.

User said: "${lastMessage}"`;

  try {
    const text = await askAI(prompt);
    const clean = text.replace(/```json|```/g, '').trim();
    try {
      res.json(JSON.parse(clean));
    } catch {
      res.json({ type: 'message', message: text, action: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(process.env.PORT, () => {
  console.log(`🚀 CRM API running on port ${process.env.PORT}`);
});