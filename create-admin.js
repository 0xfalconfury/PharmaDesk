require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const username = (await ask('Admin username: ')).trim();
    const password = await ask('Admin password (minimum 10 characters): ');
    const confirm = await ask('Confirm password: ');
    if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) throw new Error('Username must be 3-60 characters (letters, numbers, _, ., -).');
    if (password.length < 10) throw new Error('Password must contain at least 10 characters.');
    if (password !== confirm) throw new Error('Passwords do not match.');
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO admins(username,password_hash) VALUES($1,$2)
       ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash, updated_at=NOW()`,
      [username, hash]
    );
    console.log(`Admin "${username}" created/updated successfully.`);
  } catch (e) { console.error('Could not create admin:', e.message); process.exitCode = 1; }
  finally { await pool.end(); rl.close(); }
})();
