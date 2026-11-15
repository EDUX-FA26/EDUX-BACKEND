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
  if (password.length < 6) {
    throw new Error(`${prefix}_PASSWORD must contain at least 6 characters`);
  }
  return { email, username, password, fullName };
}

async function createPlatformAccount(client, account, role, grantedBy = null, { requireVacantRole = false } = {}) {
  if (requireVacantRole) {
    const { rows: existingRole } = await client.query(
      `SELECT user_id FROM public.platform_admins WHERE role = $1 LIMIT 1`, [role]
    );
    if (existingRole[0]) throw new Error(`A ${role} account already exists; use --additional only for an explicitly approved additional account`);
  }

  const { rows: existingUser } = await client.query(
    `SELECT id FROM public.users WHERE LOWER(email) = $1 OR username = $2 LIMIT 1`,
    [account.email, account.username]
  );
  if (existingUser[0]) throw new Error(`${role} bootstrap account email or username is already in use`);

  const passwordHash = await bcrypt.hash(account.password, 12);
  // Platform identities are distinct from School Admin accounts. Authorization
  // still verifies platform_admins against the database on every request.
  const { rows: users } = await client.query(
    `INSERT INTO public.users (email, username, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, email, username`,
    [account.email, account.username, passwordHash, role]
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

async function verifyPlatformSchema() {
  const requiredTables = [
    "public.users",
    "public.user_profiles",
    "public.platform_admins",
  ];
  const { rows } = await pool.query(
    `SELECT unnest($1::text[]) AS table_name, to_regclass(unnest($1::text[])) AS relation`,
    [requiredTables]
  );
  const missing = rows.filter((row) => !row.relation).map((row) => row.table_name);
  if (missing.length) {
    throw new Error(`Required SaaS tables are missing: ${missing.join(", ")}. Run the reviewed SaaS migration on the Neon development branch first.`);
  }
}

async function listPlatformAccounts() {
  const { rows } = await pool.query(
    `SELECT pa.role, pa.is_active, u.email, u.username
     FROM public.platform_admins pa
     JOIN public.users u ON u.id = pa.user_id
     ORDER BY pa.role, u.email`
  );
  for (const row of rows) {
    console.log(`${row.role}\t${row.is_active ? "active" : "inactive"}\t${row.email}\t${row.username || ""}`);
  }
}

async function detachLegacySchoolAdmin(email) {
  await withTransaction(async (client) => {
    const { rows: users } = await client.query(
      `SELECT id FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]
    );
    const legacyUser = users[0];
    if (!legacyUser) throw new Error("Legacy School Admin account was not found");

    const { rows: replacements } = await client.query(
      `SELECT 1 FROM public.platform_admins WHERE role = 'superadmin' AND is_active = TRUE AND user_id <> $1 LIMIT 1`,
      [legacyUser.id]
    );
    if (!replacements[0]) throw new Error("Refusing to remove the last active Superadmin");

    await client.query(
      `DELETE FROM public.platform_admins WHERE user_id = $1 AND role IN ('superadmin', 'manager')`,
      [legacyUser.id]
    );
  });
}

async function verifySchoolAdmin(email) {
  const { rows } = await pool.query(
    `SELECT
       u.email,
       EXISTS (
         SELECT 1 FROM public.platform_admins pa
         WHERE pa.user_id = u.id AND pa.is_active = TRUE
       ) AS has_platform_role,
       COUNT(sm.school_id) FILTER (WHERE sm.status = 'active')::int AS active_school_memberships
     FROM public.users u
     LEFT JOIN public.school_memberships sm ON sm.user_id = u.id
     WHERE LOWER(u.email) = LOWER($1)
     GROUP BY u.id, u.email`,
    [email]
  );
  const account = rows[0];
  if (!account) throw new Error("School Admin account was not found");
  if (account.has_platform_role) throw new Error("School Admin still has a platform role");
  if (account.active_school_memberships < 1) throw new Error("School Admin has no active school membership");
  return account;
}

async function resetSchoolAdminPassword(email, password) {
  if (!password || password.length < 6) throw new Error("SCHOOL_ADMIN_PASSWORD must contain at least 6 characters");
  await verifySchoolAdmin(email);
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE public.users SET password_hash = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1)`,
    [email, passwordHash]
  );
}

async function main() {
  if (process.argv.includes("--check")) {
    await verifyPlatformSchema();
    console.log("Platform bootstrap schema is ready.");
    return;
  }

  if (process.argv.includes("--list")) {
    await verifyPlatformSchema();
    await listPlatformAccounts();
    return;
  }

  if (process.argv.includes("--detach-legacy-school-admin")) {
    await verifyPlatformSchema();
    const email = process.env.LEGACY_SCHOOL_ADMIN_EMAIL;
    if (!email) throw new Error("LEGACY_SCHOOL_ADMIN_EMAIL is required");
    await detachLegacySchoolAdmin(email);
    console.log("Legacy School Admin platform role removed.");
    return;
  }

  if (process.argv.includes("--verify-school-admin")) {
    const email = process.env.SCHOOL_ADMIN_EMAIL;
    if (!email) throw new Error("SCHOOL_ADMIN_EMAIL is required");
    const account = await verifySchoolAdmin(email);
    console.log(`School Admin verified: ${account.email} (${account.active_school_memberships} active school membership(s))`);
    return;
  }

  if (process.argv.includes("--reset-school-admin-password")) {
    const email = process.env.SCHOOL_ADMIN_EMAIL;
    await resetSchoolAdminPassword(email, process.env.SCHOOL_ADMIN_PASSWORD);
    console.log("School Admin password updated.");
    return;
  }

  const superadmin = configFor("BOOTSTRAP_SUPERADMIN");
  if (!superadmin) throw new Error("BOOTSTRAP_SUPERADMIN_* variables are required");
  const manager = configFor("BOOTSTRAP_MANAGER");

  await verifyPlatformSchema();

  const allowAdditional = process.argv.includes("--additional");
  const created = await withTransaction(async (client) => {
    const superadminUser = await createPlatformAccount(
      client,
      superadmin,
      "superadmin",
      null,
      { requireVacantRole: !allowAdditional }
    );
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
