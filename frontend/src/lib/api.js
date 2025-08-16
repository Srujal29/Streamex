import { axiosInstance } from "./axios.js";

// --- Auth APIs ---
export const signup = async (signupData) => {
  const res = await axiosInstance.post("/auth/signup", signupData);
  return res.data;
};

export const login = async (loginData) => {
  const res = await axiosInstance.post("/auth/login", loginData);
  return res.data;
};

export const logout = async () => {
  const res = await axiosInstance.post("/auth/logout");
  return res.data;
};

export const getAuthUser = async () => {
  try {
    const res = await axiosInstance.get("/auth/me");
    return res.data;
  } catch (error) {
    console.error("Error in getAuthUser:", error);
    return null;
  }
};

export const completeOnboarding = async (userData) => {
  const res = await axiosInstance.post("/auth/onboarding", userData);
  return res.data;
};

// --- Users / Friends APIs ---
export const getUserFriends = async () => {
  const res = await axiosInstance.get("/users/friends");
  return res.data;
};

export const getRecommendedUsers = async () => {
  const res = await axiosInstance.get("/users");
  return res.data;
};

export const getOutgoingFriendReqs = async () => {
  const res = await axiosInstance.get("/users/outgoing-friend-requests");
  return res.data;
};

export const sendFriendRequest = async (userId) => {
  const res = await axiosInstance.post(`/users/friend-request/${userId}`);
  return res.data;
};

export const getFriendRequests = async () => {
  const res = await axiosInstance.get("/users/friend-requests");
  return res.data;
};

export const acceptFriendRequest = async (requestId) => {
  const res = await axiosInstance.put(`/users/friend-request/${requestId}/accept`);
  return res.data;
};

// --- Stream Chat Token API ---



// Add this to your api.js

export const getStreamToken = async () => {
  try {
    const res = await axiosInstance.get("/chat/token");
    return res.data;
  } catch (error) {
    console.error("Error fetching Stream token:", error);
    throw error;
  }
};

// NEW: Initialize both users in Stream
export const initializeChatUsers = async (targetUserId) => {
  try {
    const res = await axiosInstance.post("/chat/initialize", { targetUserId });
    return res.data; // Returns { token, message }
  } catch (error) {
    console.error("Error initializing chat users:", error);
    throw error;
  }
};