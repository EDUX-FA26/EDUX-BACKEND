const nodemailer = require('nodemailer');

const emailUser = process.env.EMAIL || process.env.EMAIL_USER;
const emailPass = (process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: emailUser,
    pass: emailPass
  }
});

/**
 * Gửi email thông báo
 * @param {string|string[]} to - Địa chỉ email người nhận (hoặc mảng các email)
 * @param {string} subject - Tiêu đề email
 * @param {string} htmlContent - Nội dung email dạng HTML
 */
async function sendMail(to, subject, htmlContent) {
  try {
    const mailOptions = {
      from: `"EDUX System" <${emailUser}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully: ', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

module.exports = {
  sendMail
};
