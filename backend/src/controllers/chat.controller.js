// backend/src/controllers/chat.controller.js
import { upsertStreamUser, generateStreamToken } from "../lib/stream.js";
import User from "../models/User.js";

// Cache to prevent duplicate user creation
const userCreationCache = new Map();

// ============================
// Rate limiting
// ============================
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 10;

const checkRateLimit = (userId) => {
  const now = Date.now();
  const userKey = userId.toString();

  if (!requestCounts.has(userKey)) {
    requestCounts.set(userKey, { count: 1, windowStart: now });
    return true;
  }

  const userRequests = requestCounts.get(userKey);

  if (now - userRequests.windowStart > RATE_LIMIT_WINDOW) {
    requestCounts.set(userKey, { count: 1, windowStart: now });
    return true;
  }

  if (userRequests.count < MAX_REQUESTS_PER_MINUTE) {
    userRequests.count++;
    return true;
  }

  return false;
};

// ============================
// Get Stream Token
// ============================
export const getStreamToken = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const userId = user._id.toString();

    if (!userCreationCache.has(userId)) {
      await upsertStreamUser({
        id: userId,
        name: user.fullName,
        image: user.profilePic || "",
      });

      userCreationCache.set(userId, Date.now());
      setTimeout(() => userCreationCache.delete(userId), 5 * 60 * 1000);
    }

    const token = generateStreamToken(userId);

    return res.json({
      token,
      user: {
        id: userId,
        name: user.fullName,
        image: user.profilePic || "",
      },
    });
  } catch (error) {
    console.error("❌ Error in getStreamToken:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ============================
// Initialize Chat Users
// ============================
export const initializeChatUsers = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUser = req.user;

    if (!currentUser) return res.status(401).json({ message: "Unauthorized" });
    if (!targetUserId) return res.status(400).json({ message: "Target user ID is required" });
    if (currentUser._id.toString() === targetUserId)
      return res.status(400).json({ message: "Cannot chat with yourself" });

    const targetUser = await User.findById(targetUserId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "Target user not found" });

    const currentUserId = currentUser._id.toString();
    const targetUserIdStr = targetUser._id.toString();

    const usersToCreate = [];

    if (!userCreationCache.has(currentUserId)) {
      usersToCreate.push({
        id: currentUserId,
        name: currentUser.fullName,
        image: currentUser.profilePic || "",
      });
      userCreationCache.set(currentUserId, Date.now());
    }

    if (!userCreationCache.has(targetUserIdStr)) {
      usersToCreate.push({
        id: targetUserIdStr,
        name: targetUser.fullName,
        image: targetUser.profilePic || "",
      });
      userCreationCache.set(targetUserIdStr, Date.now());
    }

    if (usersToCreate.length > 0) {
      await Promise.all(usersToCreate.map((user) => upsertStreamUser(user)));
    }

    const token = generateStreamToken(currentUserId);
    const channelId = [currentUserId, targetUserIdStr].sort().join("-");

    return res.json({
      token,
      channelId,
      currentUser: {
        id: currentUserId,
        name: currentUser.fullName,
        image: currentUser.profilePic || "",
      },
      targetUser: {
        id: targetUserIdStr,
        name: targetUser.fullName,
        image: targetUser.profilePic || "",
      },
      message: "Chat users initialized successfully",
    });
  } catch (error) {
    console.error("❌ Error initializing chat users:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ============================
// Helper: Clear cache (dev only)
// ============================
export const clearUserCache = async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({ message: "Only available in development" });
  }

  userCreationCache.clear();
  return res.json({ message: "Cache cleared successfully" });
};

// Cleanup stale cache entries
setInterval(() => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  for (const [userId, timestamp] of userCreationCache.entries()) {
    if (now - timestamp > fiveMinutes) {
      userCreationCache.delete(userId);
    }
  }
}, 60 * 1000);
