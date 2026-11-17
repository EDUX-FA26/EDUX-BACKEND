"use strict";

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool, withTransaction } = require("../../config/db.config");
const EmailService = require("../../config/email.config");

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000;

function createOpaqueToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  return result;
}

function frontendUrl(path, token) {
  const base = process.env.CLIENT_URL || process.env.PAYOS_RETURN_URL;
  if (!base) throw error("PUBLIC_FRONTEND_URL_NOT_CONFIGURED", 503);
  let url;
  try {
    url = new URL(base);
  } catch {
    throw error("PUBLIC_FRONTEND_URL_NOT_CONFIGURED", 503);
  }
  url.pathname = path;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

async function updateDeliveryStatus(registrationId, kind, success, message = null) {
  const prefix = kind === "verification" ? "verification" : "activation";
  const status = success ? "sent" : "failed";
  await pool.query(
    `UPDATE public.school_registrations
     SET ${prefix}_email_status = $2::text,
         ${prefix}_email_error = $3,
         ${prefix}_email_sent_at = CASE WHEN $2::text = 'sent' THEN NOW() ELSE ${prefix}_email_sent_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [registrationId, status, message ? String(message).slice(0, 1000) : null]
  );
}

async function deliverVerificationEmail({ registrationId, schoolName, email, rawToken }) {
  try {
    const link = frontendUrl("/verify-school-email", rawToken);
    await EmailService.sendEmail({
      to: email,
      subject: `EDUX – Xác minh email đăng ký của ${schoolName}`,
      message: [
        `Chào bạn,`,
        ``,
        `EDUX đã nhận yêu cầu tạo hệ thống cho ${schoolName}.`,
        `Hãy xác minh quyền sử dụng email này trước khi tiếp tục thanh toán:`,
        link,
        ``,
        `Liên kết có hiệu lực trong 24 giờ. Nếu bạn không gửi yêu cầu này, hãy bỏ qua email.`,
      ].join("\n"),
    });
    await updateDeliveryStatus(registrationId, "verification", true);
    return { sent: true };
  } catch (sendError) {
    console.error("[SchoolRegistration] Verification email failed:", sendError.message);
    await updateDeliveryStatus(registrationId, "verification", false, sendError.message);
    return { sent: false };
  }
}

async function deliverActivationEmail({ registrationId, schoolName, email, username, rawToken, orderReference }) {
  try {
    const link = frontendUrl("/activate-school-admin", rawToken);
    await EmailService.sendEmail({
      to: email,
      subject: `EDUX – Kích hoạt tài khoản quản trị cho ${schoolName}`,
      message: [
        `Chúc mừng ${schoolName} đã thanh toán thành công.`,
        ``,
        `Tên đăng nhập: ${username}`,
        `Mã giao dịch: ${orderReference}`,
        ``,
        `Hãy tạo mật khẩu đầu tiên bằng liên kết một lần sau:`,
        link,
        ``,
        `Liên kết có hiệu lực trong 72 giờ. EDUX không gửi mật khẩu cố định qua email.`,
      ].join("\n"),
    });
    await updateDeliveryStatus(registrationId, "activation", true);
    return { sent: true };
  } catch (sendError) {
    console.error("[SchoolRegistration] Activation email failed:", sendError.message);
    await updateDeliveryStatus(registrationId, "activation", false, sendError.message);
    return { sent: false };
  }
}

async function issueVerificationToken({ registrationId, trackingToken }) {
  const trackingHash = hashToken(trackingToken || "");
  const issued = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.admin_email, r.email_verified_at, s.name AS school_name
       FROM public.school_registrations r
       JOIN public.schools s ON s.id = r.school_id
       WHERE r.id = $1 AND r.tracking_token_hash = $2::text
       FOR UPDATE OF r`,
      [registrationId, trackingHash]
    );
    const registration = rows[0];
    if (!registration) throw error("REGISTRATION_NOT_FOUND", 404);
    // Resending is intentionally idempotent. A user can click an old tab or
    // double-click the resend button after they have verified the email in
    // another tab; this is a valid state, not an API error.
    if (registration.email_verified_at) return { registration, alreadyVerified: true };

    const rawToken = createOpaqueToken();
    await client.query(
      `UPDATE public.school_registrations
       SET email_verification_token_hash = $2::text,
           email_verification_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           verification_email_status = 'pending', verification_email_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [registration.id, hashToken(rawToken), VERIFICATION_TTL_MS]
    );
    return { registration, rawToken, alreadyVerified: false };
  });

  if (issued.alreadyVerified) {
    return { sent: false, alreadyVerified: true };
  }

  return {
    ...(await deliverVerificationEmail({
      registrationId: issued.registration.id,
      schoolName: issued.registration.school_name,
      email: issued.registration.admin_email,
      rawToken: issued.rawToken,
    })),
  };
}

async function verifyEmail(rawToken) {
  if (!rawToken || typeof rawToken !== "string") throw error("VERIFICATION_TOKEN_REQUIRED");
  const tokenHash = hashToken(rawToken);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email_verified_at, email_verification_expires_at
       FROM public.school_registrations
       WHERE email_verification_token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const registration = rows[0];
    if (!registration) throw error("VERIFICATION_LINK_INVALID", 404);
    if (registration.email_verified_at) return { alreadyVerified: true };
    if (!registration.email_verification_expires_at || new Date(registration.email_verification_expires_at) < new Date()) {
      throw error("VERIFICATION_LINK_EXPIRED", 410);
    }
    await client.query(
      `UPDATE public.school_registrations
       SET email_verified_at = NOW(), email_verification_token_hash = NULL,
           email_verification_expires_at = NULL, status = 'pending_payment', updated_at = NOW()
       WHERE id = $1`,
      [registration.id]
    );
    return { verified: true };
  });
}

async function getActivationDetails(rawToken) {
  if (!rawToken || typeof rawToken !== "string") throw error("ACTIVATION_TOKEN_REQUIRED");
  const { rows } = await pool.query(
    `SELECT r.id, r.admin_email, r.activation_used_at, r.activation_expires_at,
            s.name AS school_name
     FROM public.school_registrations r
     JOIN public.schools s ON s.id = r.school_id
     WHERE r.activation_token_hash = $1 AND r.status = 'paid'`,
    [hashToken(rawToken)]
  );
  const registration = rows[0];
  if (!registration) throw error("ACTIVATION_LINK_INVALID", 404);
  if (registration.activation_used_at) throw error("ACTIVATION_LINK_ALREADY_USED", 409);
  if (!registration.activation_expires_at || new Date(registration.activation_expires_at) < new Date()) {
    throw error("ACTIVATION_LINK_EXPIRED", 410);
  }
  return { school_name: registration.school_name, email: registration.admin_email };
}

async function issueActivationToken({ registrationId, trackingToken, isSystem = false }) {
  const trackingHash = hashToken(trackingToken || "");
  const issued = await withTransaction(async (client) => {
    const whereClause = isSystem
      ? `WHERE r.id = $1`
      : `WHERE r.id = $1 AND r.tracking_token_hash = $2::text`;
    const params = isSystem ? [registrationId] : [registrationId, trackingHash];

    const { rows } = await client.query(
      `SELECT r.id, r.admin_email, r.admin_user_id, r.status, r.provisioning_status,
              s.name AS school_name, u.username, p.order_reference
       FROM public.school_registrations r
       JOIN public.schools s ON s.id = r.school_id
       JOIN public.users u ON u.id = r.admin_user_id
       JOIN public.payment_transactions p ON p.id = r.payment_transaction_id
       ${whereClause}
       FOR UPDATE OF r`,
      params
    );
    const registration = rows[0];
    if (!registration) throw error("REGISTRATION_NOT_FOUND", 404);
    if (registration.status !== "paid" || registration.provisioning_status !== "activation_pending") {
      throw error("ACTIVATION_EMAIL_NOT_AVAILABLE", 409);
    }
    const rawToken = createOpaqueToken();
    await client.query(
      `UPDATE public.school_registrations
       SET activation_token_hash = $2::text,
           activation_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           activation_email_status = 'pending', activation_email_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [registration.id, hashToken(rawToken), ACTIVATION_TTL_MS]
    );
    return { registration, rawToken };
  });
  return deliverActivationEmail({
    registrationId: issued.registration.id,
    schoolName: issued.registration.school_name,
    email: issued.registration.admin_email,
    username: issued.registration.username,
    rawToken: issued.rawToken,
    orderReference: issued.registration.order_reference,
  });
}

async function completeActivation({ rawToken, password }) {
  if (!rawToken || typeof rawToken !== "string") throw error("ACTIVATION_TOKEN_REQUIRED");
  if (typeof password !== "string" || password.length < 12) {
    throw error("PASSWORD_MUST_HAVE_AT_LEAST_12_CHARACTERS");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const tokenHash = hashToken(rawToken);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.admin_user_id, r.activation_used_at, r.activation_expires_at
       FROM public.school_registrations r
       WHERE r.activation_token_hash = $1 AND r.status = 'paid'
       FOR UPDATE`,
      [tokenHash]
    );
    const registration = rows[0];
    if (!registration) throw error("ACTIVATION_LINK_INVALID", 404);
    if (registration.activation_used_at) throw error("ACTIVATION_LINK_ALREADY_USED", 409);
    if (!registration.activation_expires_at || new Date(registration.activation_expires_at) < new Date()) {
      throw error("ACTIVATION_LINK_EXPIRED", 410);
    }
    await client.query(
      `UPDATE public.users SET password_hash = $2::text, updated_at = NOW() WHERE id = $1`,
      [registration.admin_user_id, passwordHash]
    );
    await client.query(
      `UPDATE public.school_registrations
       SET activation_used_at = NOW(), activation_token_hash = NULL,
           provisioning_status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [registration.id]
    );
    return { activated: true };
  });
}

module.exports = {
  ACTIVATION_TTL_MS,
  createOpaqueToken,
  hashToken,
  deliverActivationEmail,
  deliverVerificationEmail,
  issueVerificationToken,
  verifyEmail,
  getActivationDetails,
  issueActivationToken,
  completeActivation,
};
