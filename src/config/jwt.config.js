const jwtConfig = {
  secret: process.env.JWT_SECRET,

  expiresIn: process.env.JWT_EXPIRES_IN || "7d",
};

if (!jwtConfig.secret) {
  throw new Error("❌ JWT_SECRET is not configured");
}

function generateToken(payload) {
  const jwt = require("jsonwebtoken");

  return jwt.sign(payload, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn,
  });
}

function verifyToken(token) {
  const jwt = require("jsonwebtoken");

  return jwt.verify(token, jwtConfig.secret);
}

module.exports = {
  jwtConfig,
  generateToken,
  verifyToken,
};