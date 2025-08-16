import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { getStreamToken, initializeChatUsers } from "../controllers/chat.controller.js";

const router = express.Router();

// GET /api/chat/token
router.get("/token", protectRoute, getStreamToken);

// POST /api/chat/initialize - Create both users in Stream
router.post("/initialize", protectRoute, initializeChatUsers);

export default router;