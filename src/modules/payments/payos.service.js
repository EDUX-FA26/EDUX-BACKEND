"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PayOS } = require("@payos/node");
const { pool, withTransaction } = require("../../config/db.config");
const EmailService = require("../../config/email.config");
const { hashToken, issueActivationToken } = require("../public-registration/registrationEmail.service");

// Initialise PayOS client
const payosClient = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
});

/**
 * Clean description string for PayOS (max 25 characters, alphanumeric and spaces only)
 */
function sanitizeDescription(desc) {
  return (desc || "EDUX SCH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 25);
}

/**
 * Generate unique integer orderCode for PayOS (<= 9007199254740991)
 */
function generateOrderCode() {
  const base = Math.floor(Date.now() / 1000);
  const rand = Math.floor(Math.random() * 90 + 10);
  return Number(`${base}${rand}`);
}

/**
 * Provisions a school, its active subscription, and school admin user upon successful payment.
 */
async function provisionSchoolFromRegistration(registrationId, externalClient = null) {
  const execute = async (client) => {
    const { rows } = await client.query(
      `SELECT sr.*, s.name AS school_name, s.code AS school_code
       FROM public.school_registrations sr
       JOIN public.schools s ON s.id = sr.school_id
       WHERE sr.id = $1
       FOR UPDATE OF sr`,
      [registrationId]
    );

    if (!rows[0]) throw new Error("REGISTRATION_NOT_FOUND");
    const reg = rows[0];

    // Check if already fully provisioned
    if (reg.admin_user_id && reg.provisioning_status === "completed") {
      return { alreadyProvisioned: true, userId: reg.admin_user_id };
    }

    // 1. Create or ensure active subscription
    const { rows: existingSub } = await client.query(
      `SELECT id FROM public.school_subscriptions WHERE school_id = $1 AND status = 'active' LIMIT 1`,
      [reg.school_id]
    );

    let subscriptionId = existingSub[0]?.id;
    if (!subscriptionId) {
      const interval = reg.billing_cycle === "yearly" ? "1 year" : "1 month";
      const { rows: subRows } = await client.query(
        `INSERT INTO public.school_subscriptions (
           school_id, plan_id, billing_cycle, price_snapshot, status, start_date, end_date
         ) VALUES (
           $1, $2, $3, $4, 'active', NOW(), NOW() + ($5::text)::interval
         ) RETURNING id`,
        [reg.school_id, reg.plan_id, reg.billing_cycle, reg.price_snapshot, interval]
      );
      subscriptionId = subRows[0].id;
    }

    // 2. Find or create admin user
    let adminUserId = reg.admin_user_id;
    let isNewUser = false;

    if (!adminUserId) {
      const { rows: userRows } = await client.query(
        `SELECT id, role, must_change_password FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [reg.admin_email]
      );

      if (userRows[0]) {
        // Existing user (multi-tenant administrator like admin@art-ai.edu.vn)
        adminUserId = userRows[0].id;
        isNewUser = false;
        // Keep their existing password intact!
      } else {
        // Brand new user: assign initial password '123456' and require first-login password change
        isNewUser = true;
        const initialPassword = "123456";
        const passwordHash = await bcrypt.hash(initialPassword, 10);
        const emailPrefix = reg.admin_email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
        const username = `${emailPrefix}_${Math.floor(1000 + Math.random() * 9000)}`;
        const { rows: newUserRows } = await client.query(
          `INSERT INTO public.users (email, username, password_hash, role, is_active, must_change_password)
           VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
           RETURNING id`,
          [reg.admin_email.toLowerCase(), username, passwordHash]
        );
        adminUserId = newUserRows[0].id;

        await client.query(
          `INSERT INTO public.user_profiles (user_id, full_name)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [adminUserId, `${reg.school_name} Admin`]
        );
      }
    }

    // 3. Assign school membership as school_admin
    await client.query(
      `INSERT INTO public.school_memberships (school_id, user_id, role, status)
       VALUES ($1, $2, 'school_admin', 'active')
       ON CONFLICT (school_id, user_id)
       DO UPDATE SET role = 'school_admin', status = 'active', updated_at = NOW()`,
      [reg.school_id, adminUserId]
    );

    // 4. Update school status to active
    await client.query(
      `UPDATE public.schools SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [reg.school_id]
    );

    // 5. Update payment transaction
    if (reg.payment_transaction_id) {
      await client.query(
        `UPDATE public.payment_transactions
         SET subscription_id = $1, status = 'success', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
         WHERE id = $2`,
        [subscriptionId, reg.payment_transaction_id]
      );
    }

    // 6. Update registration record
    await client.query(
      `UPDATE public.school_registrations
       SET status = 'paid',
           admin_user_id = $2,
           provisioning_status = 'completed',
           updated_at = NOW()
       WHERE id = $1`,
      [reg.id, adminUserId]
    );

    return {
      success: true,
      registrationId: reg.id,
      adminUserId,
      schoolName: reg.school_name,
      adminEmail: reg.admin_email,
      schoolCode: reg.school_code,
      planId: reg.plan_id,
      billingCycle: reg.billing_cycle,
      price: reg.price_snapshot,
      isNewUser,
    };
  };

  const result = externalClient ? await execute(externalClient) : await withTransaction(execute);

  // Send congratulation email with credentials to school admin
  try {
    const loginUrl = `${process.env.CLIENT_URL || "http://localhost:5173"}/login`;
    if (result.isNewUser) {
      await EmailService.sendEmail({
        to: result.adminEmail,
        subject: `EDUX – Chúc mừng ${result.schoolName} đã đăng ký tài khoản thành công`,
        message: [
          `Xin chúc mừng ${result.schoolName}!`,
          ``,
          `Trường của bạn đã đăng ký sử dụng hệ thống quản trị đào tạo EDUX thành công.`,
          ``,
          `THÔNG TIN ĐĂNG NHẬP QUẢN TRỊ VIÊN:`,
          `- Địa chỉ đăng nhập: ${loginUrl}`,
          `- Tên trường: ${result.schoolName} (Mã trường: ${result.schoolCode})`,
          `- Tên đăng nhập / Email: ${result.adminEmail}`,
          `- Mật khẩu khởi tạo: 123456`,
          ``,
          `(*) LƯU Ý BẢO MẬT:`,
          `Đây là mật khẩu khởi tạo tạm thời. Khi đăng nhập lần đầu tiên vào hệ thống, bạn sẽ được yêu cầu đổi mật khẩu mới (xác nhận 2 lần) để kích hoạt bảo mật tài khoản, sau đó tiến hành hoàn thiện hồ sơ trường học để bắt đầu vận hành.`,
          ``,
          `THÔNG TIN ĐƠN HÀNG:`,
          `- Gói sử dụng: ${result.planId}`,
          `- Chu kỳ: ${result.billingCycle === "yearly" ? "Thanh toán theo năm" : "Thanh toán theo tháng"}`,
          `- Số tiền thanh toán: ${Number(result.price).toLocaleString("vi-VN")} VNĐ`,
          `- Trạng thái: Đã thanh toán thành công qua PayOS (VietQR)`,
          ``,
          `Trân trọng,`,
          `Đội ngũ EDUX Platform`,
        ].join("\n"),
      });
    } else {
      await EmailService.sendEmail({
        to: result.adminEmail,
        subject: `EDUX – Chúc mừng bạn đã đăng ký thành công trường mới: ${result.schoolName}`,
        message: [
          `Xin chúc mừng bạn!`,
          ``,
          `Trường mới (${result.schoolName} - Mã trường: ${result.schoolCode}) đã được kích hoạt thành công trên nền tảng EDUX.`,
          ``,
          `THÔNG TIN QUẢN TRỊ TRƯỜNG MỚI:`,
          `- Địa chỉ đăng nhập: ${loginUrl}`,
          `- Email tài khoản: ${result.adminEmail}`,
          `- Mật khẩu: Mật khẩu hiện tại của bạn trên EDUX (giữ nguyên không đổi)`,
          ``,
          `(*) HƯỚNG DẪN QUẢN LÝ ĐA TRƯỜNG:`,
          `Tài khoản ${result.adminEmail} của bạn hiện đã được cấp quyền Quản trị (School Admin) cho trường ${result.schoolName}.`,
          `Bạn chỉ cần đăng nhập bằng mật khẩu hiện tại, sau đó sử dụng tính năng "Chuyển trường học" (Switch school) trên hệ thống để lựa chọn và quản trị trường mới ${result.schoolName}.`,
          ``,
          `THÔNG TIN ĐƠN HÀNG:`,
          `- Trường: ${result.schoolName} (${result.schoolCode})`,
          `- Gói sử dụng: ${result.planId}`,
          `- Chu kỳ: ${result.billingCycle === "yearly" ? "Thanh toán theo năm" : "Thanh toán theo tháng"}`,
          `- Số tiền thanh toán: ${Number(result.price).toLocaleString("vi-VN")} VNĐ`,
          `- Trạng thái: Đã thanh toán thành công qua PayOS (VietQR)`,
          ``,
          `Trân trọng,`,
          `Đội ngũ EDUX Platform`,
        ].join("\n"),
      });
    }
    console.log(`[PayOS] Delivered credentials email to ${result.adminEmail} (isNewUser: ${result.isNewUser})`);
  } catch (emailErr) {
    console.error("[PayOS] Failed to deliver credentials email:", emailErr.message);
  }

  return result;
}

/**
 * Create PayOS checkout link for a registered school.
 */
async function createCheckoutForRegistration({ registrationId, trackingToken }) {
  if (!registrationId) throw new Error("REGISTRATION_ID_REQUIRED");
  if (!trackingToken) throw new Error("TRACKING_TOKEN_REQUIRED");

  const tokenHash = hashToken(trackingToken);
  const { rows } = await pool.query(
    `SELECT sr.id, sr.school_id, sr.admin_email, sr.plan_id, sr.billing_cycle, sr.price_snapshot,
            sr.status, sr.email_verified_at, sr.payment_transaction_id,
            s.name AS school_name, s.code AS school_code,
            p.name AS plan_name,
            pt.id AS tx_id, pt.order_reference, pt.transaction_reference, pt.status AS tx_status, pt.expires_at AS tx_expires_at
     FROM public.school_registrations sr
     JOIN public.schools s ON s.id = sr.school_id
     JOIN public.subscription_plans p ON p.id = sr.plan_id
     LEFT JOIN public.payment_transactions pt ON pt.id = sr.payment_transaction_id
     WHERE sr.id = $1 AND sr.tracking_token_hash = $2`,
    [registrationId, tokenHash]
  );

  if (!rows[0]) {
    const error = new Error("REGISTRATION_NOT_FOUND");
    error.status = 404;
    throw error;
  }

  const reg = rows[0];

  if (!reg.email_verified_at) {
    const error = new Error("EMAIL_VERIFICATION_REQUIRED");
    error.status = 400;
    throw error;
  }

  if (reg.status === "paid") {
    const error = new Error("ALREADY_PAID");
    error.status = 400;
    throw error;
  }

  const amount = Math.round(Number(reg.price_snapshot));
  const orderCode = generateOrderCode();
  const description = sanitizeDescription(`SCH ${reg.school_code || orderCode}`);
  const returnUrl = process.env.PAYOS_RETURN_URL || `${process.env.CLIENT_URL || "http://localhost:5173"}/payment/result`;
  const cancelUrl = process.env.PAYOS_CANCEL_URL || `${process.env.CLIENT_URL || "http://localhost:5173"}/payment/result?canceled=true`;
  const expiredAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins

  const paymentData = {
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
    expiredAt,
  };

  const response = await payosClient.paymentRequests.create(paymentData);

  // Update or insert payment_transactions
  if (reg.tx_id) {
    await pool.query(
      `UPDATE public.payment_transactions
       SET order_reference = $1,
           transaction_reference = $2,
           amount = $3,
           payment_method = 'payos',
           status = 'pending',
           expires_at = to_timestamp($4),
           updated_at = NOW()
       WHERE id = $5`,
      [String(orderCode), response.paymentLinkId, amount, expiredAt, reg.tx_id]
    );
  } else {
    const { rows: newTx } = await pool.query(
      `INSERT INTO public.payment_transactions (
         school_id, plan_id, amount, payment_method, status, order_reference, transaction_reference, expires_at
       ) VALUES (
         $1, $2, $3, 'payos', 'pending', $4, $5, to_timestamp($6)
       ) RETURNING id`,
      [reg.school_id, reg.plan_id, amount, String(orderCode), response.paymentLinkId, expiredAt]
    );
    await pool.query(
      `UPDATE public.school_registrations SET payment_transaction_id = $1, updated_at = NOW() WHERE id = $2`,
      [newTx[0].id, reg.id]
    );
  }

  return {
    orderCode: response.orderCode,
    checkoutUrl: response.checkoutUrl,
    qrCode: response.qrCode,
    amount: response.amount,
    expiredAt,
    expiresAt: expiredAt,
    paymentLinkId: response.paymentLinkId,
    accountName: response.accountName,
    accountNumber: response.accountNumber,
    bin: response.bin,
    description,
  };
}

/**
 * Handle incoming PayOS webhook
 */
async function handleWebhook(req) {
  let webhookData;
  const isDevMock = process.env.PAYOS_ALLOW_MOCK_WEBHOOK === "true";

  try {
    webhookData = await payosClient.webhooks.verify(req.body);
  } catch (verifyErr) {
    if (isDevMock && req.body?.data) {
      console.warn("[PayOS Webhook] Bypassing signature verification (PAYOS_ALLOW_MOCK_WEBHOOK is true)");
      webhookData = req.body.data;
    } else {
      throw new Error("Invalid PayOS webhook signature: " + verifyErr.message);
    }
  }

  const { orderCode, code, amount, paymentLinkId } = webhookData;
  console.log(`[PayOS Webhook] Processing orderCode: ${orderCode}, code: ${code}, amount: ${amount}`);

  const { rows } = await pool.query(
    `SELECT pt.*, sr.id AS registration_id
     FROM public.payment_transactions pt
     LEFT JOIN public.school_registrations sr ON sr.payment_transaction_id = pt.id OR sr.school_id = pt.school_id
     WHERE pt.order_reference = $1 OR pt.transaction_reference = $2`,
    [String(orderCode), paymentLinkId]
  );

  if (!rows[0]) {
    console.warn(`[PayOS Webhook] No payment transaction found for orderCode: ${orderCode}`);
    return { success: true, message: "Transaction not found" };
  }

  const payment = rows[0];

  if (payment.status === "success") {
    return { success: true, message: "Already processed" };
  }

  if (code === "00") {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE public.payment_transactions
         SET status = 'success', paid_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [payment.id]
      );

      if (payment.registration_id) {
        await provisionSchoolFromRegistration(payment.registration_id, client);
      }
    });

    return { success: true, message: "Payment processed successfully" };
  } else {
    await pool.query(
      `UPDATE public.payment_transactions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [payment.id]
    );
    return { success: true, message: "Payment marked failed" };
  }
}

/**
 * Check payment status on-demand via PayOS API (useful for return URL or polling)
 */
async function checkPaymentStatus(orderCode) {
  try {
    const paymentInfo = await payosClient.paymentRequests.get(orderCode);

    if (paymentInfo.status === "PAID") {
      const { rows } = await pool.query(
        `SELECT pt.*, sr.id AS registration_id
         FROM public.payment_transactions pt
         LEFT JOIN public.school_registrations sr ON sr.payment_transaction_id = pt.id OR sr.school_id = pt.school_id
         WHERE pt.order_reference = $1`,
        [String(orderCode)]
      );

      if (rows[0] && rows[0].status !== "success") {
        const payment = rows[0];
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE public.payment_transactions
             SET status = 'success', paid_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [payment.id]
          );

          if (payment.registration_id) {
            await provisionSchoolFromRegistration(payment.registration_id, client);
          }
        });
      }
    }

    return paymentInfo;
  } catch (err) {
    console.error(`[PayOS] Error checking status for orderCode ${orderCode}:`, err.message);
    throw err;
  }
}

module.exports = {
  createCheckoutForRegistration,
  handleWebhook,
  checkPaymentStatus,
  provisionSchoolFromRegistration,
};
