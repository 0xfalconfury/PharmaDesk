// run-schema.js
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    for (const file of ['schema.sql', 'migrate.sql']) {
      if (!fs.existsSync(file)) {
        console.log(`Skipping ${file} (not found)`);
        continue;
      }
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`Running ${file} ...`);
      await pool.query(sql);
      console.log(`  ✓ ${file} applied`);
    }
    console.log('Schema execution complete.');
  } catch (e) {
    console.error('Schema execution failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();