CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(60) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(160),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicines (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  generic_name VARCHAR(180),
  strength VARCHAR(80),
  category VARCHAR(100),
  reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS medicines_name_idx ON medicines (LOWER(name));

CREATE TABLE IF NOT EXISTS medicine_batches (
  id BIGSERIAL PRIMARY KEY,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id),
  supplier_id BIGINT REFERENCES suppliers(id),
  batch_no VARCHAR(100) NOT NULL,
  expiry_date DATE NOT NULL,
  purchase_price NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
  selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(medicine_id, batch_no),
  CONSTRAINT medicine_batches_quantities_check
    CHECK (quantity_received > 0 AND quantity_remaining >= 0)
);
CREATE INDEX IF NOT EXISTS batches_expiry_idx ON medicine_batches(expiry_date);
CREATE INDEX IF NOT EXISTS batches_medicine_idx ON medicine_batches(medicine_id);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NOT NULL UNIQUE,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT REFERENCES suppliers(id),
  invoice_no VARCHAR(100),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  admin_id BIGINT REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_id BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  batch_id BIGINT NOT NULL REFERENCES medicine_batches(id),
  medicine_id BIGINT NOT NULL REFERENCES medicines(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  invoice_no VARCHAR(50) UNIQUE NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL,
  admin_id BIGINT REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_created_idx ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id),
  medicine_name_snapshot VARCHAR(180) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_item_batches (
  id BIGSERIAL PRIMARY KEY,
  sale_item_id BIGINT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  batch_id BIGINT NOT NULL REFERENCES medicine_batches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_snapshot NUMERIC(12,2) NOT NULL,
  unit_price_snapshot NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id),
  batch_id BIGINT REFERENCES medicine_batches(id),
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('PURCHASE','SALE','ADJUSTMENT','RETURN','EXPIRED')),
  quantity_change INTEGER NOT NULL,
  quantity_after INTEGER,
  reason TEXT,
  reference_type VARCHAR(40),
  reference_id BIGINT,
  admin_id BIGINT REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS movements_created_idx ON inventory_movements(created_at);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  admin_id BIGINT REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES admins(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80),
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at);