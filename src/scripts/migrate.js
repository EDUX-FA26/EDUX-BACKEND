/**
 * Chạy 1 file SQL migration.
 * Dùng:  node src/scripts/migrate.js sql/20261024_focus_room_smart_todo.sql
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db.config');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node src/scripts/migrate.js <path-to-sql-file>');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), file);
  const sql = fs.readFileSync(abs, 'utf8');

  console.log(`▶ Running migration: ${abs}`);
  await pool.query(sql);
  console.log('✅ Migration completed');
}

main()
  .catch((error) => {
    console.error('❌ Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

