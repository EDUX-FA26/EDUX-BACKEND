const { pool } = require('./src/config/db.config.js');

async function run() {
  try {
    const query = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, created_at)
      SELECT u.id, n.title, n.message, n.type, 'admin_broadcast', MAX(n.created_at)
      FROM users u
      CROSS JOIN (
        SELECT title, message, type, MAX(created_at) as created_at
        FROM notifications
        WHERE type = 'system_announcement'
        GROUP BY title, message, type
      ) n
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications n2
        WHERE n2.user_id = u.id AND n2.title = n.title AND n2.type = 'system_announcement'
      )
      GROUP BY u.id, n.title, n.message, n.type;
    `;
    const res = await pool.query(query);
    console.log('Inserted missing notifications:', res.rowCount);
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
