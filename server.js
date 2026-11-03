require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 86400000 }
}));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use(express.static('public'));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => req.session.admin ? next() : res.status(401).json({ error: 'Please sign in.' });
const num = (v, name, min = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`Invalid ${name}.`);
  return n;
};
const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function audit(req, action, type = null, id = null, details = {}) {
  await pool.query(
    'INSERT INTO audit_logs(admin_id,action,entity_type,entity_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
    [req.session.admin?.id || null, action, type, id, JSON.stringify(details), req.ip]
  );
}

async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/* =========================== AUTH =========================== */

app.get('/api/me', (req, res) => res.json({ admin: req.session.admin || null }));

app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query('SELECT id,username,password_hash FROM admins WHERE username=$1', [String(username || '').trim()]);
  if (!r.rowCount || !await bcrypt.compare(String(password || ''), r.rows[0].password_hash))
    return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.admin = { id: r.rows[0].id, username: r.rows[0].username };
    res.json({ admin: req.session.admin });
  });
}));

app.post('/api/logout', auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/change-password', auth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (String(newPassword || '').length < 10)
    return res.status(400).json({ error: 'New password must be at least 10 characters.' });
  const r = await pool.query('SELECT password_hash FROM admins WHERE id=$1', [req.session.admin.id]);
  if (!await bcrypt.compare(String(currentPassword || ''), r.rows[0].password_hash))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE admins SET password_hash=$1,updated_at=NOW() WHERE id=$2', [hash, req.session.admin.id]);
  await audit(req, 'PASSWORD_CHANGED', 'admin', req.session.admin.id);
  res.json({ ok: true });
}));

/* =========================== DASHBOARD =========================== */

app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const [sales, stock, expiry, weekly, profit, expenses] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(total),0) revenue,COUNT(*) sales_count FROM sales WHERE created_at::date=CURRENT_DATE`),
    pool.query(`SELECT COALESCE(SUM(quantity_remaining),0) units,COUNT(DISTINCT medicine_id) medicines FROM medicine_batches WHERE expiry_date>=CURRENT_DATE AND quantity_remaining>0`),
    pool.query(`SELECT COUNT(*) FILTER(WHERE expiry_date<CURRENT_DATE AND quantity_remaining>0) expired,
      COUNT(*) FILTER(WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7 AND quantity_remaining>0) critical,
      COUNT(*) FILTER(WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30 AND quantity_remaining>0) soon
      FROM medicine_batches`),
    pool.query(`SELECT d.day::date AS "day",COALESCE(SUM(s.total),0)::numeric revenue FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,'1 day') d(day)
      LEFT JOIN sales s ON s.created_at::date=d.day GROUP BY d.day ORDER BY d.day`),
    pool.query(`SELECT COALESCE(SUM(si.line_total-si.unit_cost*si.quantity),0) gross_profit FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.created_at::date=CURRENT_DATE`),
    pool.query(`SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE expense_date=CURRENT_DATE`)
  ]);
  res.json({
    sales: sales.rows[0],
    stock: stock.rows[0],
    expiry: expiry.rows[0],
    weekly: weekly.rows,
    profit: profit.rows[0],
    expenses: expenses.rows[0]
  });
}));

/* =========================== MEDICINES =========================== */

app.get('/api/medicines', auth, asyncRoute(async (req, res) => {
  // selling_price is a weighted average over non-expired batches,
  // matching exactly what the sale endpoint will charge.
  const q = `SELECT m.id,m.name,m.generic_name,m.strength,m.category,m.reorder_level,
    COALESCE(SUM(b.quantity_remaining) FILTER(WHERE b.expiry_date>=CURRENT_DATE),0)::int stock,
    COALESCE(SUM(b.selling_price*b.quantity_remaining) FILTER(WHERE b.expiry_date>=CURRENT_DATE AND b.quantity_remaining>0)
      / NULLIF(SUM(b.quantity_remaining) FILTER(WHERE b.expiry_date>=CURRENT_DATE AND b.quantity_remaining>0),0),0)::numeric selling_price
    FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id
    WHERE m.is_active AND ($1='' OR m.name ILIKE '%'||$1||'%' OR COALESCE(m.generic_name,'') ILIKE '%'||$1||'%')
    GROUP BY m.id ORDER BY m.name LIMIT 200`;
  res.json((await pool.query(q, [String(req.query.q || '').trim()])).rows);
}));

app.post('/api/medicines', auth, asyncRoute(async (req, res) => {
  const { name, generic_name, strength, category, reorder_level } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Medicine name is required.' });
  const r = await pool.query(
    `INSERT INTO medicines(name,generic_name,strength,category,reorder_level) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [name.trim(), generic_name || null, strength || null, category || null, num(reorder_level || 0, 'reorder level')]
  );
  await audit(req, 'MEDICINE_CREATED', 'medicine', r.rows[0].id, { name });
  res.status(201).json(r.rows[0]);
}));

app.put('/api/medicines/:id', auth, asyncRoute(async (req, res) => {
  const { name, generic_name, strength, category, reorder_level } = req.body;
  const r = await pool.query(
    `UPDATE medicines SET name=$1,generic_name=$2,strength=$3,category=$4,reorder_level=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
    [String(name || '').trim(), generic_name || null, strength || null, category || null, num(reorder_level || 0, 'reorder level'), req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Medicine not found.' });
  await audit(req, 'MEDICINE_UPDATED', 'medicine', req.params.id);
  res.json(r.rows[0]);
}));

app.delete('/api/medicines/:id', auth, asyncRoute(async (req, res) => {
  await pool.query('UPDATE medicines SET is_active=false WHERE id=$1', [req.params.id]);
  await audit(req, 'MEDICINE_ARCHIVED', 'medicine', req.params.id);
  res.json({ ok: true });
}));

/* =========================== SUPPLIERS =========================== */

app.get('/api/suppliers', auth, asyncRoute(async (req, res) =>
  res.json((await pool.query('SELECT * FROM suppliers ORDER BY name')).rows)
));

app.post('/api/suppliers', auth, asyncRoute(async (req, res) => {
  const { name, phone, email, address, notes } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Supplier name is required.' });
  const r = await pool.query(
    'INSERT INTO suppliers(name,phone,email,address,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [name.trim(), phone || null, email || null, address || null, notes || null]
  );
  await audit(req, 'SUPPLIER_CREATED', 'supplier', r.rows[0].id);
  res.status(201).json(r.rows[0]);
}));

/* =========================== PURCHASES =========================== */

app.post('/api/purchases', auth, asyncRoute(async (req, res) => {
  const { supplier_id, invoice_no, purchase_date, notes, items } = req.body;
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Add at least one purchase item.' });

  const result = await transaction(async c => {
    const p = await c.query(
      `INSERT INTO purchases(supplier_id,invoice_no,purchase_date,notes,admin_id)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [
        supplier_id || null,
        invoice_no || null,
        dateOk(purchase_date) ? purchase_date : new Date().toISOString().slice(0, 10),
        notes || null,
        req.session.admin.id
      ]
    );

    let total = 0;

    for (const item of items) {
      const medicineId = num(item.medicine_id, 'medicine');
      const qty = num(item.quantity, 'quantity', 1);
      if (!Number.isInteger(qty)) throw new Error('Purchase quantity must be a whole number.');
      const cost = num(item.purchase_price, 'purchase price');
      const price = num(item.selling_price, 'selling price');
      if (!item.batch_no || !String(item.batch_no).trim())
        throw new Error('Every purchase item needs a batch number.');
      if (!dateOk(item.expiry_date))
        throw new Error('Every purchase item needs a valid expiry date.');

      // Explicit columns + RETURNING so we can verify what PostgreSQL stored.
      const b = await c.query(
        `INSERT INTO medicine_batches
           (medicine_id, supplier_id, batch_no, expiry_date,
            purchase_price, selling_price, quantity_received, quantity_remaining)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id, quantity_received, quantity_remaining`,
        [medicineId, supplier_id || null, String(item.batch_no).trim(), item.expiry_date, cost, price, qty]
      );

      const stored = b.rows[0];
      if (stored.quantity_received !== qty || stored.quantity_remaining !== qty) {
        throw new Error(
          `Batch insert produced unexpected quantities ` +
          `(received=${stored.quantity_received}, remaining=${stored.quantity_remaining}, expected=${qty}).`
        );
      }

      const line = qty * cost;
      total += line;

      await c.query(
        `INSERT INTO purchase_items(purchase_id,batch_id,medicine_id,quantity,unit_cost,line_total)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [p.rows[0].id, b.rows[0].id, medicineId, qty, cost, line]
      );

      await c.query(
        `INSERT INTO inventory_movements
           (medicine_id,batch_id,movement_type,quantity_change,quantity_after,reason,reference_type,reference_id,admin_id)
         VALUES($1,$2,'PURCHASE',$3,$4,'Supplier purchase','purchase',$5,$6)`,
        [medicineId, b.rows[0].id, qty, qty, p.rows[0].id, req.session.admin.id]
      );
    }

    await c.query('UPDATE purchases SET total_cost=$1 WHERE id=$2', [total, p.rows[0].id]);
    return { id: p.rows[0].id, total };
  });

  await audit(req, 'PURCHASE_RECORDED', 'purchase', result.id, result);
  res.status(201).json(result);
}));

/* =========================== EXPIRY =========================== */

app.get('/api/expiry', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT b.*,m.name medicine_name,m.strength,s.name supplier_name,
    CASE WHEN b.expiry_date<CURRENT_DATE THEN 'EXPIRED'
    WHEN b.expiry_date<=CURRENT_DATE+7 THEN 'CRITICAL'
    WHEN b.expiry_date<=CURRENT_DATE+30 THEN 'WARNING'
    WHEN b.expiry_date<=CURRENT_DATE+90 THEN 'UPCOMING' ELSE 'SAFE' END status
    FROM medicine_batches b JOIN medicines m ON m.id=b.medicine_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE b.quantity_remaining>0 ORDER BY b.expiry_date`);
  res.json(r.rows);
}));

/* =========================== STOCK ADJUSTMENT =========================== */

app.post('/api/stock-adjustments', auth, asyncRoute(async (req, res) => {
  const { batch_id, quantity_change, reason } = req.body;
  const delta = Number(quantity_change);
  if (!Number.isInteger(delta) || delta === 0)
    return res.status(400).json({ error: 'Quantity change must be a non-zero whole number.' });
  if (!String(reason || '').trim())
    return res.status(400).json({ error: 'Adjustment reason is required.' });

  const r = await transaction(async c => {
    const b = await c.query('SELECT * FROM medicine_batches WHERE id=$1 FOR UPDATE', [batch_id]);
    if (!b.rowCount) throw new Error('Batch not found.');

    const after = b.rows[0].quantity_remaining + delta;
    if (after < 0) throw new Error('Adjustment cannot make stock negative.');

    // Keep quantity_received in sync when we ADD stock via adjustment,
    // because the schema has CHECK(quantity_remaining <= quantity_received).
    // The schema itself will be relaxed by the migration below, but this
    // keeps the invariant true even on a fresh, un-migrated database.
    const newReceived = Math.max(b.rows[0].quantity_received, after);

    await c.query(
      'UPDATE medicine_batches SET quantity_remaining=$1, quantity_received=$2 WHERE id=$3',
      [after, newReceived, batch_id]
    );

    await c.query(
      `INSERT INTO inventory_movements(medicine_id,batch_id,movement_type,quantity_change,quantity_after,reason,admin_id)
       VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,$6)`,
      [b.rows[0].medicine_id, batch_id, delta, after, reason, req.session.admin.id]
    );

    return { batch_id, after };
  });

  await audit(req, 'STOCK_ADJUSTED', 'batch', batch_id, { delta, reason });
  res.json(r);
}));

app.get('/api/movements', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT im.*,m.name medicine_name,b.batch_no FROM inventory_movements im
    JOIN medicines m ON m.id=im.medicine_id LEFT JOIN medicine_batches b ON b.id=im.batch_id
    ORDER BY im.created_at DESC LIMIT 500`);
  res.json(r.rows);
}));

/* =========================== CUSTOMERS / MEDICINE SUGGEST =========================== */

app.get('/api/customers/suggest', auth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '');
  res.json((await pool.query(
    `SELECT id,name,phone,address FROM customers WHERE phone ILIKE $1 OR name ILIKE $1 ORDER BY name LIMIT 10`,
    [`%${q}%`]
  )).rows);
}));

app.get('/api/medicines/suggest', auth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '');
  res.json((await pool.query(`SELECT m.id,m.name,m.strength,
    (SELECT COALESCE(SUM(b2.selling_price*b2.quantity_remaining)/NULLIF(SUM(b2.quantity_remaining),0),0)
       FROM medicine_batches b2 WHERE b2.medicine_id=m.id AND b2.expiry_date>=CURRENT_DATE AND b2.quantity_remaining>0) selling_price,
    COALESCE(SUM(b.quantity_remaining) FILTER(WHERE b.expiry_date>=CURRENT_DATE),0)::int stock
    FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id=m.id AND b.expiry_date>=CURRENT_DATE AND b.quantity_remaining>0
    WHERE m.is_active AND m.name ILIKE $1 GROUP BY m.id ORDER BY m.name LIMIT 10`, [`%${q}%`])).rows);
}));

/* =========================== SALES =========================== */

app.post('/api/sales', auth, asyncRoute(async (req, res) => {
  const { customer, items, discount } = req.body;
  if (!customer?.name?.trim() || !customer?.phone?.trim() || !customer?.address?.trim())
    return res.status(400).json({ error: 'Buyer name, phone and address are required.' });
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Add at least one medicine.' });

  const disc = num(discount || 0, 'discount');

  const result = await transaction(async c => {
    // Reuse an existing customer on phone match; only insert for new phones.
    const cust = await c.query(
      `WITH ins AS (
         INSERT INTO customers(name,phone,address) VALUES($1,$2,$3)
         ON CONFLICT(phone) DO NOTHING
         RETURNING id
       )
       SELECT id FROM ins
       UNION ALL
       SELECT id FROM customers WHERE phone=$2
       LIMIT 1`,
      [customer.name.trim(), customer.phone.trim(), customer.address.trim()]
    );

    let subtotal = 0;
    const clean = [];

    for (const item of items) {
      const medicineId = num(item.medicine_id, 'medicine');
      const qty = num(item.quantity, 'quantity', 1);
      if (!Number.isInteger(qty)) throw new Error('Quantity must be a whole number.');

      const m = await c.query('SELECT id,name FROM medicines WHERE id=$1 AND is_active=true', [medicineId]);
      if (!m.rowCount) throw new Error('A selected medicine is unavailable.');

      const batches = await c.query(
        `SELECT * FROM medicine_batches
         WHERE medicine_id=$1 AND expiry_date>=CURRENT_DATE AND quantity_remaining>0
         ORDER BY expiry_date ASC, received_at ASC FOR UPDATE`,
        [medicineId]
      );

      const available = batches.rows.reduce((n, b) => n + b.quantity_remaining, 0);
      if (available < qty)
        throw new Error(`Insufficient non-expired stock for ${m.rows[0].name}. Available: ${available}.`);

      let left = qty, costTotal = 0, priceTotal = 0;
      const allocations = [];

      for (const b of batches.rows) {
        if (!left) break;
        const take = Math.min(left, b.quantity_remaining);
        const after = b.quantity_remaining - take;

        await c.query('UPDATE medicine_batches SET quantity_remaining=$1 WHERE id=$2', [after, b.id]);
        await c.query(
          `INSERT INTO inventory_movements(medicine_id,batch_id,movement_type,quantity_change,quantity_after,reason,admin_id)
           VALUES($1,$2,'SALE',$3,$4,'Customer sale',$5)`,
          [medicineId, b.id, -take, after, req.session.admin.id]
        );

        allocations.push({ batch_id: b.id, quantity: take, cost: Number(b.purchase_price), price: Number(b.selling_price) });
        costTotal += take * Number(b.purchase_price);
        priceTotal += take * Number(b.selling_price);
        left -= take;
      }

      const unitPrice = priceTotal / qty;
      const unitCost = costTotal / qty;
      const line = priceTotal;
      subtotal += line;
      clean.push({ medicineId, name: m.rows[0].name, qty, unitPrice, unitCost, line, allocations });
    }

    if (disc > subtotal) throw new Error('Discount cannot exceed subtotal.');

    const invoice = 'PD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const sale = await c.query(
      `INSERT INTO sales(customer_id,invoice_no,subtotal,discount,total,admin_id)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,invoice_no,total,created_at`,
      [cust.rows[0].id, invoice, subtotal, disc, subtotal - disc, req.session.admin.id]
    );

    for (const item of clean) {
      const si = await c.query(
        `INSERT INTO sale_items(sale_id,medicine_id,medicine_name_snapshot,quantity,unit_price,unit_cost,line_total)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [sale.rows[0].id, item.medicineId, item.name, item.qty, item.unitPrice, item.unitCost, item.line]
      );
      for (const a of item.allocations) {
        await c.query(
          `INSERT INTO sale_item_batches(sale_item_id,batch_id,quantity,unit_cost_snapshot,unit_price_snapshot)
           VALUES($1,$2,$3,$4,$5)`,
          [si.rows[0].id, a.batch_id, a.quantity, a.cost, a.price]
        );
      }
    }

    return { sale: sale.rows[0], items: clean, customer };
  });

  await audit(req, 'SALE_CREATED', 'sale', result.sale.id, { invoice_no: result.sale.invoice_no, total: result.sale.total });
  res.status(201).json(result);
}));

app.get('/api/sales', auth, asyncRoute(async (req, res) => {
  const from = dateOk(req.query.from) ? req.query.from : '2000-01-01';
  const to = dateOk(req.query.to) ? req.query.to : '2999-12-31';
  const r = await pool.query(
    `SELECT s.*,c.name customer_name,c.phone FROM sales s JOIN customers c ON c.id=s.customer_id
     WHERE s.created_at::date BETWEEN $1 AND $2 ORDER BY s.created_at DESC LIMIT 1000`,
    [from, to]
  );
  res.json(r.rows);
}));

/* =========================== ANALYTICS =========================== */

app.get('/api/analytics', auth, asyncRoute(async (req, res) => {
  const from = dateOk(req.query.from) ? req.query.from : '2000-01-01';
  const to = dateOk(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);

  const [summary, daily, top] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*) FROM sales WHERE created_at::date BETWEEN $1 AND $2) sales_count,
      (SELECT COALESCE(SUM(total),0) FROM sales WHERE created_at::date BETWEEN $1 AND $2) revenue,
      (SELECT COALESCE(SUM(si.line_total-si.unit_cost*si.quantity),0)
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
       WHERE s.created_at::date BETWEEN $1 AND $2) gross_profit`, [from, to]),
    pool.query(
      `SELECT s.created_at::date AS "day",SUM(s.total) revenue FROM sales s
       WHERE s.created_at::date BETWEEN $1 AND $2 GROUP BY "day" ORDER BY "day"`,
      [from, to]
    ),
    pool.query(`SELECT si.medicine_name_snapshot name,SUM(si.quantity)::int quantity,SUM(si.line_total) revenue
      FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.created_at::date BETWEEN $1 AND $2
      GROUP BY si.medicine_name_snapshot ORDER BY quantity DESC LIMIT 10`, [from, to])
  ]);

  const exp = await pool.query(
    'SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date BETWEEN $1 AND $2',
    [from, to]
  );

  res.json({
    summary: summary.rows[0],
    daily: daily.rows,
    top: top.rows,
    expenses: exp.rows[0].total,
    net_after_expenses: Number(summary.rows[0].gross_profit) - Number(exp.rows[0].total)
  });
}));

/* =========================== EXPENSES =========================== */

app.post('/api/expenses', auth, asyncRoute(async (req, res) => {
  const { title, category, amount, expense_date, notes } = req.body;
  const a = num(amount, 'amount', 0.01);
  if (!String(title || '').trim() || !String(category || '').trim())
    return res.status(400).json({ error: 'Title and category are required.' });
  const r = await pool.query(
    `INSERT INTO expenses(title,category,amount,expense_date,notes,admin_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title.trim(), category.trim(), a,
     dateOk(expense_date) ? expense_date : new Date().toISOString().slice(0, 10),
     notes || null, req.session.admin.id]
  );
  await audit(req, 'EXPENSE_CREATED', 'expense', r.rows[0].id);
  res.status(201).json(r.rows[0]);
}));

app.get('/api/expenses', auth, asyncRoute(async (req, res) =>
  res.json((await pool.query('SELECT * FROM expenses ORDER BY expense_date DESC LIMIT 500')).rows)
));

/* =========================== PDF REPORTS =========================== */

app.get('/api/reports/sales.pdf', auth, asyncRoute(async (req, res) => {
  const from = dateOk(req.query.from) ? req.query.from : '2000-01-01';
  const to = dateOk(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `SELECT s.invoice_no,s.created_at,c.name customer_name,s.total FROM sales s JOIN customers c ON c.id=s.customer_id
     WHERE s.created_at::date BETWEEN $1 AND $2 ORDER BY s.created_at`,
    [from, to]
  );

  const doc = new PDFDocument({ margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="pharmadesk-sales-report.pdf"');
  doc.pipe(res);

  doc.fontSize(20).text('PharmaDesk - Sales Report');
  doc.moveDown().fontSize(10).text(`Period: ${from} to ${to}`);
  doc.moveDown();

  let sum = 0;
  for (const row of r.rows) {
    sum += Number(row.total);
    doc.text(`${row.invoice_no} | ${new Date(row.created_at).toLocaleString()} | ${row.customer_name} | Tk ${Number(row.total).toFixed(2)}`);
  }
  doc.moveDown().fontSize(13).text(`Total sales: Tk ${sum.toFixed(2)}`);
  doc.end();
}));

app.get('/api/receipt/:id.pdf', auth, asyncRoute(async (req, res) => {
  const sale = await pool.query(
    `SELECT s.*,c.name,c.phone,c.address FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`,
    [req.params.id]
  );
  if (!sale.rowCount) return res.status(404).json({ error: 'Sale not found.' });

  const items = await pool.query(
    'SELECT medicine_name_snapshot,quantity,unit_price,line_total FROM sale_items WHERE sale_id=$1',
    [req.params.id]
  );

  const doc = new PDFDocument({ margin: 45 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sale.rows[0].invoice_no}.pdf"`);
  doc.pipe(res);

  const s = sale.rows[0];
  doc.fontSize(22).text('PharmaDesk');
  doc.fontSize(10).text('Sales receipt');
  doc.moveDown();
  doc.text(`Invoice: ${s.invoice_no}`);
  doc.text(`Date: ${new Date(s.created_at).toLocaleString()}`);
  doc.text(`Buyer: ${s.name} | ${s.phone}`);
  doc.text(`Address: ${s.address}`);
  doc.moveDown();
  items.rows.forEach(i => doc.text(`${i.medicine_name_snapshot}  x${i.quantity}  Tk ${Number(i.line_total).toFixed(2)}`));
  doc.moveDown()
    .text(`Subtotal: Tk ${Number(s.subtotal).toFixed(2)}`)
    .text(`Discount: Tk ${Number(s.discount).toFixed(2)}`)
    .fontSize(14)
    .text(`Total: Tk ${Number(s.total).toFixed(2)}`);
  doc.end();
}));

/* =========================== AUDIT / BACKUP =========================== */

app.get('/api/audit-logs', auth, asyncRoute(async (req, res) =>
  res.json((await pool.query(
    `SELECT l.*,a.username FROM audit_logs l LEFT JOIN admins a ON a.id=l.admin_id ORDER BY l.created_at DESC LIMIT 500`
  )).rows)
));

app.get('/api/backup/instructions', auth, (req, res) => res.json({
  message: 'Run pg_dump from the server/administrator machine. Store backups outside the public folder and test restores regularly.',
  commands: {
    backup: 'pg_dump -Fc -U postgres -d pharmadesk -f backups/pharmadesk.dump',
    restore: 'pg_restore --clean --if-exists -U postgres -d pharmadesk backups/pharmadesk.dump'
  }
}));

/* =========================== ERROR HANDLER =========================== */

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 400;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Request could not be completed.'
      : err.message || 'Server error.'
  });
});

app.listen(PORT, () => console.log(`PharmaDesk running at http://localhost:${PORT}`));