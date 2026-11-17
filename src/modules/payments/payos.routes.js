"use strict";

const express = require("express");
const router = express.Router();
const payosController = require("./payos.controller");

// Webhook endpoint (PayOS posts to /api/payments/webhook or /api/payments/payos/webhook)
router.post("/webhook", payosController.webhookHandler);
router.post("/payos/webhook", payosController.webhookHandler);

// Checkout endpoint
router.post("/checkout", payosController.createCheckout);

// Status check endpoint
router.get("/status/:orderCode", payosController.checkStatus);

module.exports = router;
