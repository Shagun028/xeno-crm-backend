const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const customers = [
  { name: 'Aditi Sharma', email: 'aditi@gmail.com', phone: '+919876543210', city: 'Mumbai', tags: 'vip,frequent' },
  { name: 'Rahul Mehta', email: 'rahul@gmail.com', phone: '+919876543211', city: 'Delhi', tags: 'new' },
  { name: 'Priya Nair', email: 'priya@gmail.com', phone: '+919876543212', city: 'Bangalore', tags: 'vip' },
  { name: 'Karan Singh', email: 'karan@gmail.com', phone: '+919876543213', city: 'Chennai', tags: 'frequent' },
  { name: 'Neha Joshi', email: 'neha@gmail.com', phone: '+919876543214', city: 'Pune', tags: 'at-risk' },
  { name: 'Arjun Patel', email: 'arjun@gmail.com', phone: '+919876543215', city: 'Mumbai', tags: 'vip,frequent' },
  { name: 'Sneha Reddy', email: 'sneha@gmail.com', phone: '+919876543216', city: 'Hyderabad', tags: 'new' },
  { name: 'Vikram Bose', email: 'vikram@gmail.com', phone: '+919876543217', city: 'Kolkata', tags: 'at-risk' },
  { name: 'Ananya Iyer', email: 'ananya@gmail.com', phone: '+919876543218', city: 'Bangalore', tags: 'frequent' },
  { name: 'Dev Malhotra', email: 'dev@gmail.com', phone: '+919876543219', city: 'Delhi', tags: 'vip' },
  { name: 'Riya Kapoor', email: 'riya@gmail.com', phone: '+919876543220', city: 'Mumbai', tags: 'new' },
  { name: 'Aakash Gupta', email: 'aakash@gmail.com', phone: '+919876543221', city: 'Jaipur', tags: 'frequent' },
  { name: 'Meera Pillai', email: 'meera@gmail.com', phone: '+919876543222', city: 'Chennai', tags: 'vip' },
  { name: 'Rohan Das', email: 'rohan@gmail.com', phone: '+919876543223', city: 'Pune', tags: 'at-risk' },
  { name: 'Kavya Menon', email: 'kavya@gmail.com', phone: '+919876543224', city: 'Kochi', tags: 'new' },
];

const products = [
  { name: 'Silk Kurta', category: 'ethnic' },
  { name: 'Denim Jacket', category: 'western' },
  { name: 'Linen Saree', category: 'ethnic' },
  { name: 'Sneakers', category: 'footwear' },
  { name: 'Leather Handbag', category: 'accessories' },
  { name: 'Cotton Dress', category: 'western' },
  { name: 'Embroidered Dupatta', category: 'ethnic' },
  { name: 'Formal Trousers', category: 'western' },
];

function randomDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d.toISOString();
}

db.exec('DELETE FROM orders; DELETE FROM customers;');

const insertCustomer = db.prepare(`
  INSERT INTO customers (id, name, email, phone, city, total_spent, order_count, last_order_date, tags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertOrder = db.prepare(`
  INSERT INTO orders (id, customer_id, amount, product, category, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

for (const c of customers) {
  const id = uuidv4();
  const numOrders = Math.floor(Math.random() * 5) + 1;
  let total = 0;
  let lastDate = null;

  // collect orders first
  const orderRows = [];
  for (let i = 0; i < numOrders; i++) {
    const p = products[Math.floor(Math.random() * products.length)];
    const amount = Math.floor(Math.random() * 4000) + 500;
    const date = randomDate(180);
    total += amount;
    if (!lastDate || date > lastDate) lastDate = date;
    orderRows.push({ id: uuidv4(), customerId: id, amount, product: p.name, category: p.category, date });
  }

  // insert customer FIRST
  insertCustomer.run(id, c.name, c.email, c.phone, c.city, total, numOrders, lastDate, c.tags);

  // then insert orders
  for (const o of orderRows) {
    insertOrder.run(o.id, o.customerId, o.amount, o.product, o.category, o.date);
  }
}

console.log('✅ Seeded 15 customers with orders');