
/**
 * EDUX EMAIL SERVICE
 * Provider: Resend Email API
 * Transport: HTTPS (443)
 * Compatible with Render Free
 *
 * Node.js >= 18 required.
 */

const RESEND_API_URL = "https://api.resend.com/emails";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ==========================================
// CONFIGURATION
// ==========================================

function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  return { apiKey, from };
}

// ==========================================
// NORMALIZE RECIPIENTS
// ==========================================

function normalizeEmails(input) {
  if (!input) return [];

  const values = Array.isArray(input)
    ? input
    : [input];

  const emails = values
    .filter(value => typeof value === "string")
    .flatMap(value => value.split(/[;,]/))
    .map(value => value.trim())
    .filter(Boolean);

  if (emails.some(email => !EMAIL_REGEX.test(email))) {
    throw new Error("INVALID_RECIPIENT_EMAIL");
  }

  return [...new Set(emails)];
}

// ==========================================
// EMAIL SERVICE
// ==========================================

const EmailService = {
  async verifyConnection() {
    // Resend HTTP API has no SMTP handshake.
    // Only validate local configuration here.
    // Successful delivery requires a real send test.
    getEmailConfig();
    return true;
  },

  async sendEmail({
    to,
    bcc,
    subject,
    message,
    html,
  }) {
    const { apiKey, from } = getEmailConfig();

    let toRecipients = normalizeEmails(to);
    const bccRecipients = normalizeEmails(bcc);

    if (
      toRecipients.length === 0 &&
      bccRecipients.length === 0
    ) {
      throw new Error("RECIPIENT_REQUIRED");
    }

    // Resend requires a non-empty "to" field.
    // For legacy BCC-only calls, use an explicit
    // administrative recipient.
    if (toRecipients.length === 0) {
      toRecipients = normalizeEmails(
        process.env.EMAIL_BCC_FALLBACK_TO ||
        process.env.EMAIL
      );

      if (toRecipients.length === 0) {
        throw new Error("BCC_ONLY_REQUIRES_TO");
      }
    }

    if (toRecipients.length > 50) {
      throw new Error("TO_RECIPIENT_LIMIT_EXCEEDED");
    }

    if (
      typeof subject !== "string" ||
      !subject.trim()
    ) {
      throw new Error("EMAIL_SUBJECT_REQUIRED");
    }

    const payload = {
      from,
      to: toRecipients,
      subject: subject.trim(),
    };

    if (bccRecipients.length) {
      payload.bcc = bccRecipients;
    }

    if (typeof message === "string" && message) {
      payload.text = message;
    }

    if (typeof html === "string" && html) {
      payload.html = html;
    }

    if (!payload.text && !payload.html) {
      throw new Error("EMAIL_CONTENT_REQUIRED");
    }

    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });

      let result;

      try {
        result = await response.json();
      } catch {
        const error = new Error(
          "RESEND_INVALID_RESPONSE"
        );
        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(
          result?.message ||
          `RESEND_HTTP_${response.status}`
        );

        error.code =
          result?.name || "RESEND_API_ERROR";

        error.status = response.status;

        throw error;
      }

      if (!result?.id) {
        throw new Error("RESEND_MISSING_EMAIL_ID");
      }

      console.log("[EMAIL] Accepted by Resend:", {
        messageId: result.id,
        recipientCount:
          toRecipients.length + bccRecipients.length,
      });

      return {
        accepted: true,
        messageId: result.id,
        acceptedRecipients: [
          ...toRecipients,
          ...bccRecipients,
        ],
      };
    } catch (error) {
      console.error("[EMAIL] Send failed:", {
        code: error.code || error.name,
        status: error.status,
        message: error.message,
      });

      throw error;
    }
  },
};

module.exports = EmailService;
