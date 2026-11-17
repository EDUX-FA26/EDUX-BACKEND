
const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const {
    EMAIL,
    EMAIL_PASSWORD,
    SMTP_HOST,
    SMTP_PORT = '465',
  } = process.env;

  if (!EMAIL || !EMAIL_PASSWORD || !SMTP_HOST) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  const port = Number(SMTP_PORT);

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: EMAIL,
      pass: EMAIL_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  return transporter;
}

const EmailService = {
  async verifyConnection() {
    return getTransporter().verify();
  },

  async sendEmail({ to, bcc, subject, message, html }) {
    if (!to && !bcc) {
      throw new Error('RECIPIENT_REQUIRED');
    }

    const mailOptions = {
      from: {
        name: 'EduX Learning System',
        address: process.env.EMAIL,
      },
      subject,
      text: message,
    };

    if (to) {
      if (typeof to === 'string') {
        mailOptions.to = to;
      } else if (Array.isArray(to)) {
        mailOptions.to = to.filter(addr => typeof addr === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)).join(', ');
      }
    }

    if (bcc) {
      if (typeof bcc === 'string') {
        mailOptions.bcc = bcc;
      } else if (Array.isArray(bcc)) {
        mailOptions.bcc = bcc.filter(addr => typeof addr === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)).join(', ');
      }
    }

    if (html) {
      mailOptions.html = html;
    }

    const info = await getTransporter().sendMail(mailOptions);

    return {
      accepted: true,
      messageId: info.messageId,
      acceptedRecipients: info.accepted || [],
    };
  },
};

module.exports = EmailService;
