"use strict";

const crypto = require("crypto");
const express = require("express");
const { withTransaction, pool } = require("../../config/db.config");
const {
  hashToken,
  issueVerificationToken,
  verifyEmail,
  getActivationDetails,
  issueActivationToken,
  completeActivation,
} = require("./registrationEmail.service");
const payosService = require("../payments/payos.service");

const router = express.Router();
const TERMS_VERSION = "2026-11";

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

function requestError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

router.get("/plans", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, description, price_monthly, price_yearly, student_limit,
             storage_limit_gb, ai_requests_limit, features
      FROM public.subscription_plans WHERE is_active = TRUE ORDER BY price_monthly ASC
    `);
    return res.json({ success: true, data: rows });
  } catch (error) { return next(error); }
});

router.post("/registrations", async (req, res, next) => {
  const name = typeof req.body?.school_name === "string" ? req.body.school_name.trim() : "";
  const email = typeof req.body?.admin_email === "string" ? req.body.admin_email.trim().toLowerCase() : "";
  const planId = req.body?.plan_id;
  const billingCycle = req.body?.billing_cycle;
  if (!name || name.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest(res, "School name and a valid admin email are required");
  if (!planId || !["monthly", "yearly"].includes(billingCycle)) return badRequest(res, "A plan and billing cycle are required");
  if (req.body?.terms_accepted !== true) return badRequest(res, "Terms acceptance is required");

  try {
    const result = await withTransaction(async (client) => {
      // Allow one email to register multiple schools (multi-tenant like admin@art-ai.edu.vn).
      // Only check if there is an unfinished, open unpaid order to prevent accidental double-clicks.
      const { rows: existingRegistration } = await client.query(`
        SELECT id FROM public.school_registrations
        WHERE LOWER(admin_email) = LOWER($1)
          AND status IN ('pending_email_verification', 'pending_payment', 'processing')
        LIMIT 1
      `, [email]);
      if (existingRegistration[0]) {
        throw requestError("REGISTRATION_ALREADY_EXISTS", 409);
      }

      const { rows: planRows } = await client.query(`SELECT * FROM public.subscription_plans WHERE id = $1 AND is_active = TRUE FOR SHARE`, [planId]);
      const plan = planRows[0];
      if (!plan) throw requestError("PLAN_NOT_AVAILABLE", 404);
      const price = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
      const { rows: codeRows } = await client.query(`SELECT nextval('public.school_code_sequence') AS value`);
      const code = `SCH-${String(codeRows[0].value).padStart(4, "0")}`;
      const slug = `${code.toLowerCase()}-${crypto.randomBytes(3).toString("hex")}`;
      const { rows: schoolRows } = await client.query(`
        INSERT INTO public.schools (name, code, slug, status, setup_completed, provisioning_source)
        VALUES ($1, $2, $3, 'pending_setup', FALSE, 'self_registered') RETURNING id, code, name
      `, [name, code, slug]);
      const school = schoolRows[0];
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const { rows: registrations } = await client.query(`
        INSERT INTO public.school_registrations (school_id, admin_email, plan_id, billing_cycle, price_snapshot, terms_version, terms_accepted_at, tracking_token_hash)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
        RETURNING id, status, plan_id, billing_cycle, price_snapshot, created_at
      `, [school.id, email, plan.id, billingCycle, price, TERMS_VERSION, tokenHash]);
      const registration = registrations[0];

      // Initial payment intent record for PayOS checkout
      const orderReference = `REG${registration.id.replace(/-/g, "").toUpperCase()}`;
      const { rows: paymentRows } = await client.query(`
        INSERT INTO public.payment_transactions (school_id, plan_id, amount, payment_method, status, order_reference)
        VALUES ($1, $2, $3, 'payos', 'pending', $4)
        RETURNING id, order_reference, status
      `, [school.id, plan.id, price, orderReference]);
      const payment = paymentRows[0];
      await client.query(
        `UPDATE public.school_registrations SET payment_transaction_id = $2, updated_at = NOW() WHERE id = $1`,
        [registration.id, payment.id]
      );

      return { ...registration, school, payment_order_reference: payment.order_reference, tracking_token: token };
    });
    const verification = await issueVerificationToken({
      registrationId: result.id,
      trackingToken: result.tracking_token,
    });
    return res.status(201).json({
      success: true,
      data: { ...result, verification_email_status: verification.sent ? "sent" : "failed" },
    });
  } catch (error) {
    if (error.code === "23505" && error.constraint === "school_registrations_one_open_email") {
      return next(requestError("REGISTRATION_ALREADY_EXISTS", 409));
    }
    return next(error);
  }
});

router.get("/registrations/:id", async (req, res, next) => {
  const token = req.get("X-Registration-Token");
  if (!token) return res.status(401).json({ success: false, message: "Registration token is required" });
  try {
    const tokenHash = hashToken(token);
    const { rows } = await pool.query(`
      SELECT r.id, r.status, r.plan_id, r.billing_cycle, r.price_snapshot, r.created_at,
             (r.email_verified_at IS NOT NULL) AS email_verified,
             r.verification_email_status, r.activation_email_status, r.provisioning_status,
             s.name AS school_name, s.code AS school_code,
             p.status AS payment_status, p.order_reference AS payment_order_reference,
             p.expires_at AS payment_expires_at
      FROM public.school_registrations r
      JOIN public.schools s ON s.id = r.school_id
      LEFT JOIN public.payment_transactions p ON p.id = r.payment_transaction_id
      WHERE r.id = $1 AND r.tracking_token_hash = $2
    `, [req.params.id, tokenHash]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "Registration not found" });
    const reg = rows[0];

    // Auto-sync with PayOS if order is pending to guarantee instant confirmation in local & webhook environments
    if (reg.status !== "paid" && reg.payment_order_reference && /^\d+$/.test(reg.payment_order_reference)) {
      try {
        const payosStatus = await payosService.checkPaymentStatus(reg.payment_order_reference);
        if (payosStatus?.status === "PAID") {
          reg.status = "paid";
          reg.payment_status = "success";
        }
      } catch {
        // Non-blocking sync error (e.g. order not created yet on PayOS)
      }
    }

    return res.json({ success: true, data: reg });
  } catch (error) { return next(error); }
});

router.post("/registrations/:id/resend-email-verification", async (req, res, next) => {
  try {
    const result = await issueVerificationToken({
      registrationId: req.params.id,
      trackingToken: req.get("X-Registration-Token"),
    });
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.post("/registrations/:id/checkout", async (req, res, next) => {
  try {
    const result = await payosService.createCheckoutForRegistration({
      registrationId: req.params.id,
      trackingToken: req.get("X-Registration-Token"),
    });
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.get("/school-admin-activation", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await getActivationDetails(req.query.token) });
  } catch (error) { return next(error); }
});

router.post("/school-admin-activation", async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: await completeActivation({ rawToken: req.body?.token, password: req.body?.password }),
    });
  } catch (error) { return next(error); }
});

router.post("/registrations/:id/resend-activation", async (req, res, next) => {
  try {
    const result = await issueActivationToken({
      registrationId: req.params.id,
      trackingToken: req.get("X-Registration-Token"),
    });
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.post("/verify-school-email", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await verifyEmail(req.body?.token) });
  } catch (error) { return next(error); }
});

module.exports = router;
