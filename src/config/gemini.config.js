
require("dotenv").config();

let clientPromise;

async function getGeminiClient() {
  if (!clientPromise) {
    clientPromise = import("@google/genai").then(
      ({ GoogleGenAI }) =>
        new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY
        })
    );
  }

  return clientPromise;
}

async function askGemini(prompt) {
  const ai = await getGeminiClient();

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt
  });

  return response.text;
}

module.exports = { askGemini };
