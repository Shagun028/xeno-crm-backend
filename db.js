const initSqlJs = require('sql.js');

let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT, email TEXT, phone TEXT, city TEXT,
      total_spent REAL DEFAULT 0,
      order_count INTEGER DEFAULT 0,
      last_order_date TEXT,
      tags TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT, amount REAL,
      product TEXT, category TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT, segment_description TEXT, segment_query TEXT,
      message_template TEXT, channel TEXT,
      status TEXT, audience_size INTEGER, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS communications (
      id TEXT PRIMARY KEY,
      campaign_id TEXT, customer_id TEXT,
      message TEXT, channel TEXT, status TEXT,
      sent_at TEXT, delivered_at TEXT, opened_at TEXT,
      clicked_at TEXT, failed_reason TEXT
    );
  `);

  return db;
}

module.exports = { getDb };