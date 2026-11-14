"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const bcrypt = require("bcryptjs");
const { withTransaction, pool } = require("../config/db.config");

function configFor(prefix) {
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const username = process.env[`${prefix}_USERNAME`]?.trim();
  const password = process.env[`${prefix}_PASSWORD`];
  const fullName = process.env[`${prefix}_FULL_NAME`]?.trim() || username;

  if (!email && !username && !password) return null;
  if (!email || !username || !password) {
    throw new Error(`${prefix}_EMAIL, ${prefix}_USERNAME and ${prefix}_PASSWORD must be configured together`);
  }
  if (password.length < 12) {
    throw new Error(`${prefix}_PASSWORD must contain at least 12 characters`);
  }
  return { email, username, password, fullName };
}

async function createPlatformAccount(client, account, role, grantedBy = null) {
  const { rows: existingRole } = await client.query(
    `SELECT user_id FROM public.platform_admins WHERE role = $1 LIMIT 1`, [role]
  );
  if (existingRole[0]) throw new Error(`A ${role} account already exists; bootstrap is one-time only`);

  const { rows: existingUser } = await client.query(
    `SELECT id FROM public.users WHERE LOWER(email) = $1 OR username = $2 LIMIT 1`,
    [account.email, account.username]
  );
  if (existingUser[0]) throw new Error(`${role} bootstrap account email or username is already in use`);

  const passwordHash = await bcrypt.hash(account.password, 12);
  // `users.role` remains the legacy identity column. All platform authorization
  // comes exclusively from `platform_admins.role`.
  const { rows: users } = await client.query(
    `INSERT INTO public.users (email, username, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'admin', TRUE)
     RETURNING id, email, username`,
    [account.email, account.username, passwordHash]
  );
  const user = users[0];
  await client.query(`INSERT INTO public.user_profiles (user_id, full_name) VALUES ($1, $2)`, [user.id, account.fullName]);
  await client.query(
    `INSERT INTO public.platform_admins (user_id, role, is_active, granted_by)
     VALUES ($1, $2, TRUE, $3)`,
    [user.id, role, grantedBy]
  );
  return user;
}

async function main() {
  const superadmin = configFor("BOOTSTRAP_SUPERADMIN");
  if (!superadmin) throw new Error("BOOTSTRAP_SUPERADMIN_* variables are required");
  const manager = configFor("BOOTSTRAP_MANAGER");

  const created = await withTransaction(async (client) => {
    const superadminUser = await createPlatformAccount(client, superadmin, "superadmin");
    const managerUser = manager
      ? await createPlatformAccount(client, manager, "manager", superadminUser.id)
      : null;
    return { superadminUser, managerUser };
  });

  console.log(`Created Superadmin account: ${created.superadminUser.email}`);
  if (created.managerUser) console.log(`Created Manager account: ${created.managerUser.email}`);
  console.log("Credentials were not printed. Remove BOOTSTRAP_* secrets after successful setup.");
}

main()
  .catch((error) => { console.error(`Platform bootstrap failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
