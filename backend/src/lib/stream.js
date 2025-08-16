// lib/stream.js
import { StreamChat } from "stream-chat";
import "dotenv/config";

console.log("=== Initializing Stream Chat ===");

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

// Debug logging
console.log("Stream API Key:", apiKey);
console.log("Stream API Secret exists:", !!apiSecret);
console.log("Stream API Secret length:", apiSecret?.length);

if (!apiKey) {
  console.error("❌ STREAM_API_KEY is missing!");
  throw new Error("Missing STREAM_API_KEY environment variable");
}

if (!apiSecret) {
  console.error("❌ STREAM_API_SECRET is missing!");
  throw new Error("Missing STREAM_API_SECRET environment variable");
}

// Server-side client
let serverClient;
try {
  console.log("🔧 Creating StreamChat client...");
  serverClient = new StreamChat(apiKey, apiSecret);
  console.log("✅ StreamChat client created successfully");
} catch (error) {
  console.error("❌ Failed to create StreamChat client:", error);
  throw error;
}

export { serverClient };

export const upsertStreamUser = async (userData) => {
  try {
    console.log("📝 Upserting user:", userData);
    const result = await serverClient.upsertUser(userData);
    console.log("✅ User upserted successfully:", result);
    return userData;
  } catch (error) {
    console.error("❌ Error upserting Stream user:", error);
    console.error("User data that failed:", userData);
    throw error;
  }
};

export const generateStreamToken = (userId) => {
  try {
    console.log("🔑 Generating token for userId:", userId);
    
    if (!userId) {
      throw new Error("userId is required for token generation");
    }
    
    if (!serverClient) {
      throw new Error("serverClient is not initialized");
    }
    
    const token = serverClient.createToken(userId.toString());
    console.log("✅ Token generated successfully:", token ? token.substring(0, 20) + "..." : "null");
    return token;
  } catch (error) {
    console.error("❌ Error generating Stream token:", error);
    console.error("UserId that failed:", userId);
    throw error;
  }
};