# 💊 PharmaDesk
### Modern Pharmacy Management & Inventory System

**PharmaDesk** is a web-based pharmacy management application designed to simplify medicine inventory, supplier management, purchasing, sales processing, expiry monitoring, and business analytics.

Built with **Node.js, Express.js, PostgreSQL, HTML, CSS, and Vanilla JavaScript**, PharmaDesk provides a centralized dashboard for managing daily pharmacy operations efficiently.

---

## ✨ Features

### 📊 Dashboard & Analytics
- Real-time daily sales overview.
- Total available medicine stock.
- Medicine expiry alerts.
- Daily gross profit overview.
- Interactive revenue charts.
- Date-range sales analytics.
- Top-selling medicine reports.

### 💊 Medicine Management
- Add, update, and archive medicines.
- Store medicine names, generic names, strengths, and categories.
- Configure low-stock thresholds.
- Search and filter medicine records.
- Monitor available stock quantities.

### 📦 Inventory & Expiry Management
- Batch-based medicine inventory.
- Track individual batch numbers.
- Record medicine expiry dates.
- Automatically identify expired batches.
- Expiry warning categories:
  - 🔴 Expired
  - 🟠 Critical — within 7 days
  - 🟡 Warning — within 30 days
  - 🔵 Upcoming — within 90 days
  - 🟢 Safe
- Automatically exclude expired batches from sales.
- First-expiry-first-out (FEFO) stock allocation.

### 🏭 Supplier & Purchase Management
- Add and manage suppliers.
- Store supplier contact information.
- Record medicine purchases.
- Track supplier invoice numbers.
- Add new inventory through purchase records.
- Maintain purchase history and batch information.

### 🔄 Stock Movement Management
- Record stock purchases.
- Track medicine sales.
- Perform manual stock adjustments.
- Require reasons for stock adjustments.
- Maintain inventory movement history.
- Track quantity changes and remaining stock.

### 🛒 Sales & Customer Management
- Process medicine sales.
- Store customer name, phone number, and address.
- Suggest previously registered customers.
- Automatically calculate medicine prices and totals.
- Apply discounts.
- Automatically deduct sold quantities from inventory.
- Generate PDF receipts.
- Maintain searchable sales history.

### 💰 Financial Management
- Calculate revenue.
- Calculate gross profit using recorded batch purchase costs.
- Record business expenses.
- Calculate profit after recorded expenses.
- Generate date-range financial reports.

### 🔐 Administration & Security
- Secure administrator authentication.
- Password hashing with bcrypt.
- Change administrator passwords.
- Session-based authentication.
- Login rate limiting.
- Audit logs for administrative activities.
- Parameterized SQL queries.
- PostgreSQL-backed session storage.

### 💾 Database Backup & Recovery
- PostgreSQL backup using `pg_dump`.
- Database restoration using `pg_restore`.
- Backup and recovery instructions.
- Recommendations for secure backup storage.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Responsive interface and styling |
| Vanilla JavaScript | Frontend functionality |
| Node.js | Backend runtime |
| Express.js | REST API and server |
| PostgreSQL | Relational database |
| bcryptjs | Password hashing |
| express-session | Session management |
| connect-pg-simple | PostgreSQL session storage |
| Chart.js | Interactive analytics |
| PDFKit | PDF receipt and report generation |
| Helmet | HTTP security headers |

---

## 📁 Project Structure

```text
pharmadesk/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── db.js
├── server.js
├── schema.sql
├── create-admin.js
│
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

---

## ⚙️ Installation & Setup

### 1. Prerequisites

Make sure you have installed:

- [Node.js](https://nodejs.org/)
- [PostgreSQL](https://www.postgresql.org/)
- [Git](https://git-scm.com/)

### 2. Clone the Repository

```bash
git clone https://github.com/YOUR-USERNAME/PharmaDesk.git
```

Navigate into the project directory:

```bash
cd PharmaDesk
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Create the PostgreSQL Database

Open PostgreSQL or pgAdmin and execute:

```sql
CREATE DATABASE pharmadesk;
```

### 5. Configure Environment Variables

Create a `.env` file in the root directory.

Copy the contents of `.env.example` and configure your credentials:

```env
PORT=3000
NODE_ENV=development

DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pharmadesk

SESSION_SECRET=your_long_random_secret

SESSION_DAYS=1
COOKIE_SECURE=false
```

**Important:** Replace `YOUR_PASSWORD` and `SESSION_SECRET` with your own values.

Never upload your `.env` file to GitHub.

### 6. Initialize the Database

Execute `schema.sql` against your `pharmadesk` database.

Using PostgreSQL:

```bash
psql -U postgres -d pharmadesk -f schema.sql
```

On Windows, if `psql` is not recognized, use the full PostgreSQL executable path:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pharmadesk -f schema.sql
```

Change the version number according to your PostgreSQL installation.

Alternatively, execute `schema.sql` using pgAdmin's Query Tool.

### 7. Create an Administrator Account

```bash
npm run create-admin
```

Follow the terminal prompts to create your administrator username and password.

### 8. Start the Application

Development mode:

```bash
npm run dev
```

Production-style start:

```bash
npm start
```

Open your browser:

```text
http://localhost:3000
```

---

## 📈 Inventory Workflow

PharmaDesk uses batch-based inventory management.

1. Create a medicine in the medicine catalogue.
2. Register the medicine supplier.
3. Record a purchase with its batch number, expiry date, purchase price, selling price, and quantity.
4. The system adds the purchased quantity to inventory.
5. When a sale is completed, eligible batches are selected by earliest expiry date.
6. Expired batches are excluded from the sale process.
7. Every stock movement is recorded for future reference.

This approach helps maintain more accurate inventory and profit calculations.

---

## 💹 Financial Calculation

PharmaDesk uses the following simplified calculations:

**Revenue**

```text
Revenue = Total Completed Sales
```

**Gross Profit**

```text
Gross Profit = Sales Revenue - Cost of Goods Sold
```

**Net After Recorded Expenses**

```text
Net = Gross Profit - Recorded Business Expenses
```

Purchase costs are preserved through batch-level sale allocations.

*Note: This is an operational reporting calculation, not a complete accounting or tax system. Returns, taxes, payment fees, and other accounting adjustments are not yet included.*

---

## 💾 Database Backup & Recovery

Create a backup:

```bash
pg_dump -Fc -U postgres -d pharmadesk -f pharmadesk.dump
```

Restore a backup:

```bash
pg_restore --clean --if-exists -U postgres -d pharmadesk pharmadesk.dump
```

**Warning:** Restoration can replace existing database objects and data. Verify the target database and backup before restoring.

Keep backups outside the public application directory and protect them because they contain customer and business information.

---

## 🔒 Security Recommendations

Before deploying PharmaDesk publicly:

- Use a strong, unique session secret.
- Enable HTTPS.
- Set `NODE_ENV=production`.
- Set `COOKIE_SECURE=true` when using HTTPS.
- Use a PostgreSQL account with limited privileges.
- Configure CSRF protection.
- Configure a strict Content Security Policy.
- Keep dependencies updated.
- Restrict administrator access.
- Encrypt and securely store database backups.
- Test database restoration regularly.

The current project is a development starter and requires additional security review before production deployment.

---

## 🚀 Future Improvements

Potential future development:

- Multiple administrator roles and permissions.
- Barcode and QR-code medicine scanning.
- Supplier payment tracking.
- Purchase returns and medicine sales returns.
- Automated low-stock notifications.
- Automated expiry notifications.
- Email and SMS notifications.
- Advanced financial and accounting reports.
- Multi-branch pharmacy support.
- Automated scheduled backups.
- Printable inventory reports.

---

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push your branch.
5. Open a Pull Request.

---

## 📄 License

This project is currently distributed without a specified open-source license.

Add a `LICENSE` file before granting others explicit permission to use, modify, or redistribute the project.

---

## 👨‍💻 Author

**PharmaDesk Development Project**

Developed as a pharmacy management and inventory automation application.

---

<p align="center">
  <strong>💊 PharmaDesk</strong><br>
  <em>Smarter Inventory. Better Management. Efficient Operations.</em>
</p>
