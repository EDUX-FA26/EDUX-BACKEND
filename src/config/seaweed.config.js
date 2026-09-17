const {
  S3Client,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1",

  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },

  forcePathStyle: true,
});

const S3_BUCKET = process.env.S3_BUCKET;

async function connectSeaweed() {
  try {
    console.log("🔄 Checking SeaweedFS S3...");

    await s3.config.credentials();

    console.log("✅ SeaweedFS S3 configured");
    console.log(`📦 Bucket: ${S3_BUCKET}`);
    console.log(`🌐 Endpoint: ${process.env.S3_ENDPOINT}`);
  } catch (error) {
    console.error("❌ SeaweedFS configuration failed:");
    console.error(error.message);

    throw error;
  }
}

module.exports = {
  s3,
  S3_BUCKET,
  connectSeaweed,
};