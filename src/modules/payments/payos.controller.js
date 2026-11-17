"use strict";

const {
  createCheckoutForRegistration,
  handleWebhook,
  checkPaymentStatus,
} = require("./payos.service");

/**
 * POST /api/payments/checkout
 * Body: { registrationId }
 * Header: X-Registration-Token: ...
 */
async function createCheckoutHandler(req, res, next) {
  try {
    const registrationId = req.body?.registrationId || req.params?.id;
    const trackingToken = req.get("X-Registration-Token") || req.body?.trackingToken;
    const result = await createCheckoutForRegistration({ registrationId, trackingToken });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    return next(err);
  }
}

/**
 * POST /api/payments/webhook
 */
async function webhookHandler(req, res) {
  try {
    const result = await handleWebhook(req);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("PayOS webhook error:", err);
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * GET /api/payments/status/:orderCode
 */
async function checkStatusHandler(req, res, next) {
  try {
    const { orderCode } = req.params;
    const result = await checkPaymentStatus(orderCode);
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createCheckout: createCheckoutHandler,
  webhookHandler,
  checkStatus: checkStatusHandler,
};
