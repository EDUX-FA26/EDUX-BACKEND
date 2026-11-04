
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

  async sendEmail({ to, subject, message }) {
    if (
      typeof to !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)
    ) {
      throw new Error('INVALID_EMAIL_ADDRESS');
    }

    const info = await getTransporter().sendMail({
      from: {
        name: 'EduX Learning System',
        address: process.env.EMAIL,
      },
      to,
      subject,
      text: message,
    });

    const accepted = (info.accepted || []).some(
      address => address.toLowerCase() === to.toLowerCase()
    );

    if (!accepted) {
      throw new Error('EMAIL_NOT_ACCEPTED');
    }

    return {
      accepted: true,
      messageId: info.messageId,
    };
  },
};

module.exports = EmailService;
