// PayOS Repository – raw DB queries for payment attempts
// Uses the shared pg pool from config/db.config.js

const { pool } = require('../../config/db.config');

/**
 * Insert a new payment transaction (checkout attempt).
 * @param {object} params - fields required for insertion.
 *   {
 *     schoolId: string|null, // null for pending registration
 *     provider: string, // 'payos'
 *     orderCode: number,
 *     paymentLinkId: string,
 *     checkoutUrl: string,
 *     qrCode: string,
 *     amount: number,
 *     priceSnapshot: number,
 *     registrationId: string,
 *     expiresAt: Date,
 *   }
 */
async function insertPaymentAttempt(params) {
  const {
    schoolId,
    provider,
    orderCode,
    paymentLinkId,
    checkoutUrl,
    qrCode,
    amount,
    priceSnapshot,
    registrationId,
    expiresAt,
  } = params;
  const query = `INSERT INTO payment_transactions (
    id, school_id, payment_provider, provider_order_code, provider_payment_link_id,
    checkout_url, qr_code, amount, price_snapshot, registration_id, expires_at, status
  ) VALUES (
    gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10), $11
  ) RETURNING *`;
  const values = [
    schoolId,
    provider,
    orderCode,
    paymentLinkId,
    checkoutUrl,
    qrCode,
    amount,
    priceSnapshot,
    registrationId,
    Math.floor(expiresAt / 1000), // seconds epoch
    'PENDING',
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

/**
 * Fetch a payment transaction by provider order code.
 * @param {number} orderCode
 */
async function getByOrderCode(orderCode) {
  const { rows } = await pool.query(
    `SELECT * FROM payment_transactions WHERE provider_order_code = $1`,
    [orderCode]
  );
  return rows[0];
}

/**
 * Update status and payment details for a transaction.
 * @param {string} id - UUID of payment_transactions row.
 * @param {object} updates - { status, amountReceived, providerStatus, paidAt }
 */
async function updateStatus(id, updates) {
  const { status, amountReceived, providerStatus, paidAt } = updates;
  const query = `UPDATE payment_transactions SET
    status = $1,
    amount_received = $2,
    provider_status = $3,
    paid_at = to_timestamp($4)
    WHERE id = $5 RETURNING *`;
  const values = [status, amountReceived, providerStatus, Math.floor(paidAt / 1000), id];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

module.exports = {
  insertPaymentAttempt,
  getByOrderCode,
  updateStatus,
};
