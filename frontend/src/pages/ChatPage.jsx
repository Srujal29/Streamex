// src/pages/ChatPage.jsx
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Chat,
  Channel,
  ChannelHeader,
  MessageList,
  MessageInput,
  Thread,
  Window,
} from "stream-chat-react";
import { StreamChat } from "stream-chat";
import { StreamVideoClient } from "@stream-io/video-react-sdk";
import toast from "react-hot-toast";

import useAuthUser from "../hooks/useAuthUser.js";
import { initializeChatUsers } from "../lib/api.js";
import { rateLimitHandler } from "../lib/utils.js";

import ChatLoader from "../components/ChatLoader.jsx";
import CallButton from "../components/CallButton.jsx";

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY;

// Global client and channel cache
let globalStreamClient = null;
let channelCache = new Map();
let connectionPromise = null;

// FIXED: Better video client management
const videoClientMap = new Map(); // Track video clients per user

const getOrCreateVideoClient = async (apiKey, user, token) => {
  const userId = user.id;
  
  // Check if we already have a client for this user
  if (videoClientMap.has(userId)) {
    const existingClient = videoClientMap.get(userId);
    // Check if client is connected
    try {
      if (existingClient.user && existingClient.user.id === userId) {
        console.log("📹 Using existing video client for user:", userId);
        return existingClient;
      }
    } catch (error) {
      console.log("📹 Existing client invalid, creating new one");
      videoClientMap.delete(userId);
    }
  }

  console.log("📹 Creating new Stream Video client for user:", userId);
  
  try {
    const videoClient = new StreamVideoClient({
      apiKey,
      user: {
        id: user.id,
        name: user.name,
        image: user.image
      },
      token
    });

    // FIXED: Add connection event listeners
    videoClient.on('connection.changed', (event) => {
      console.log(`📹 Video connection changed for ${userId}:`, event.type);
    });

    videoClient.on('connection.error', (error) => {
      console.error(`📹 Video connection error for ${userId}:`, error);
      // Remove failed client
      videoClientMap.delete(userId);
    });

    // Connect the video client
    await videoClient.connectUser(
      {
        id: user.id,
        name: user.name,
        image: user.image
      },
      token
    );

    // Store in map
    videoClientMap.set(userId, videoClient);
    
    return videoClient;
  } catch (error) {
    console.error("Error creating video client:", error);
    throw error;
  }
};

// FIXED: Proper video client cleanup
const disconnectVideoClient = async (userId = null) => {
  if (userId) {
    // Disconnect specific user's video client
    const client = videoClientMap.get(userId);
    if (client) {
      try {
        await client.disconnectUser();
        console.log(`📹 Video client disconnected for user: ${userId}`);
      } catch (error) {
        console.error(`Error disconnecting video client for ${userId}:`, error);
      }
      videoClientMap.delete(userId);
    }
  } else {
    // Disconnect all video clients
    for (const [userId, client] of videoClientMap.entries()) {
      try {
        await client.disconnectUser();
        console.log(`📹 Video client disconnected for user: ${userId}`);
      } catch (error) {
        console.error(`Error disconnecting video client for ${userId}:`, error);
      }
    }
    videoClientMap.clear();
  }
};

const ChatPage = () => {
  const { id: targetUserId } = useParams();
  const navigate = useNavigate();
  const { authUser, isLoading: authLoading } = useAuthUser();

  const [chatClient, setChatClient] = useState(null);
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState(null);
  const [videoToken, setVideoToken] = useState(null);
  const [videoClient, setVideoClient] = useState(null); // FIXED: Track video client in state

  const mountedRef = useRef(true);
  const initializingRef = useRef(false);

  // FIXED: Enhanced cleanup with proper video client handling
  const cleanupConnection = useCallback(async () => {
    try {
      console.log("🧹 Starting cleanup...");
      
      if (authUser?._id) {
        rateLimitHandler.clearUserAttempts(authUser._id);
        // FIXED: Disconnect video client for this specific user
        await disconnectVideoClient(authUser._id);
      }
      
      if (globalStreamClient?.user) {
        await globalStreamClient.disconnectUser();
      }
      
      globalStreamClient = null;
      channelCache.clear();
      connectionPromise = null;
      
      if (mountedRef.current) {
        setChatClient(null);
        setChannel(null);
        setVideoClient(null); // FIXED: Clear video client state
        setConnectionState('disconnected');
        setError(null);
      }
    } catch (error) {
      console.error("❌ Cleanup error:", error);
    }
  }, [authUser]);

  // Complete cleanup (for logout)
  const completeCleanup = useCallback(async () => {
    await cleanupConnection();
    await disconnectVideoClient(); // Disconnect all video clients
  }, [cleanupConnection]);

  // Get or create Stream client
  const getStreamClient = useCallback(() => {
    if (!globalStreamClient) {
      console.log("📱 Creating new Stream client");
      globalStreamClient = new StreamChat(STREAM_API_KEY);
      
      globalStreamClient.on('connection.changed', (event) => {
        console.log('🔄 Connection state:', event.type);
        if (mountedRef.current) {
          setConnectionState(event.type === 'connection.recovered' ? 'connected' : 'connecting');
        }
      });

      globalStreamClient.on('connection.error', (error) => {
        console.error('🚫 Connection error:', error);
        if (mountedRef.current) {
          setConnectionState('error');
          setError(error.message);
        }
      });
    }
    return globalStreamClient;
  }, []);

  // Get or create channel with rate limiting
  const getOrCreateChannel = useCallback(async (client, channelId, members) => {
    // Check cache first
    if (channelCache.has(channelId)) {
      console.log("📺 Using cached channel:", channelId);
      return channelCache.get(channelId);
    }

    // Create channel with rate limiting
    const channelOperation = async () => {
      console.log("📺 Creating new channel:", channelId);
      const newChannel = client.channel("messaging", channelId, { members });
      await newChannel.watch();
      return newChannel;
    };

    const channel = await rateLimitHandler.executeWithRetry(
      channelOperation,
      authUser._id,
      'channel-create',
      2
    );

    // Cache the channel
    channelCache.set(channelId, channel);
    return channel;
  }, [authUser]);

  // Initialize chat with comprehensive rate limiting
  const initializeChat = useCallback(async () => {
    if (initializingRef.current || !authUser || !targetUserId || authLoading) {
      return;
    }

    if (connectionPromise) {
      console.log("⏳ Connection in progress, waiting...");
      try {
        await connectionPromise;
        return;
      } catch (error) {
        console.log("Previous connection failed, starting new one");
      }
    }

    initializingRef.current = true;
    setLoading(true);
    setError(null);
    setConnectionState('connecting');

    connectionPromise = (async () => {
      try {
        console.log("🚀 Starting rate-limited chat initialization...");
        
        const client = getStreamClient();
        
        // Check if user is already connected
        if (client.user?.id === authUser._id) {
          console.log("👤 User already connected");
          if (mountedRef.current) {
            setChatClient(client);
            setConnectionState('connected');
          }
        } else {
          // Initialize users with rate limiting
          const userInitOperation = async () => {
            console.log("📝 Initializing users...");
            return await initializeChatUsers(targetUserId);
          };

          const tokenResponse = await rateLimitHandler.executeWithRetry(
            userInitOperation,
            authUser._id,
            'user-init',
            2
          );

          if (!mountedRef.current) return;

          // Store video token for later use
          setVideoToken(tokenResponse.videoToken || tokenResponse.token);

          // Connect user with rate limiting
          const connectOperation = async () => {
            console.log("🔑 Connecting user...");
            return await client.connectUser(
              {
                id: authUser._id,
                name: authUser.fullName,
                image: authUser.profilePic || "/default-avatar.png",
              },
              tokenResponse.token
            );
          };

          await rateLimitHandler.executeWithRetry(
            connectOperation,
            authUser._id,
            'user-connect',
            2
          );

          if (!mountedRef.current) {
            await client.disconnectUser();
            return;
          }

          if (mountedRef.current) {
            setChatClient(client);
            setConnectionState('connected');
          }
        }

        // Create channel with rate limiting
        const channelId = [authUser._id, targetUserId].sort().join("-");
        const currentChannel = await getOrCreateChannel(
          client, 
          channelId, 
          [authUser._id, targetUserId]
        );

        if (mountedRef.current) {
          setChannel(currentChannel);
          console.log("🎉 Chat initialization complete!");
        }

      } catch (error) {
        console.error("❌ Chat initialization failed:", error);
        
        if (mountedRef.current) {
          if (rateLimitHandler.isRateLimitError(error)) {
            setError("Rate limit exceeded. Please wait a few minutes before trying again.");
            toast.error("Too many requests. Please wait 2-3 minutes before trying again.", {
              duration: 8000,
            });
            
            setTimeout(() => {
              if (mountedRef.current) {
                setError(null);
                initializeChat();
              }
            }, 120000);
          } else {
            setError(error.message);
            toast.error("Failed to connect to chat. Please try again.");
          }
          setConnectionState('error');
        }
        
        throw error;
      } finally {
        initializingRef.current = false;
        connectionPromise = null;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    })();

    return connectionPromise;
  }, [authUser, targetUserId, authLoading, getStreamClient, getOrCreateChannel]);

  // FIXED: Better video call handling with proper error management
  const handleVideoCall = async () => {
    if (!channel || connectionState !== 'connected') {
      toast.error("Chat not ready for video calls");
      return;
    }

    if (!videoToken) {
      toast.error("Video token not available. Please refresh and try again.");
      return;
    }

    try {
      let currentVideoClient = videoClient;

      // Create video client if not exists
      if (!currentVideoClient) {
        currentVideoClient = await getOrCreateVideoClient(
          STREAM_API_KEY,
          {
            id: authUser._id,
            name: authUser.fullName,
            image: authUser.profilePic || "/default-avatar.png"
          },
          videoToken
        );
        
        if (mountedRef.current) {
          setVideoClient(currentVideoClient);
        }
      }

      // FIXED: Add call ID uniqueness to prevent conflicts
      const timestamp = Date.now();
      const callId = `${channel.id}-${timestamp}`;
      const call = currentVideoClient.call('default', callId);
      
      // Create the call with timeout
      const createCallPromise = call.getOrCreate({
        data: {
          members: [
            { user_id: authUser._id },
            { user_id: targetUserId }
          ],
        },
      });

      // FIXED: Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Call creation timed out')), 10000);
      });

      await Promise.race([createCallPromise, timeoutPromise]);

      const callUrl = `${window.location.origin}/call/${callId}`;
      
      // Send message with rate limiting
      const sendMessageOperation = async () => {
        return await channel.sendMessage({ 
          text: `📹 I've started a video call. Join me here: ${callUrl}`,
          attachments: [{
            type: 'video_call',
            title: 'Video Call',
            title_link: callUrl,
            text: 'Click to join the video call'
          }]
        });
      };

      await rateLimitHandler.executeWithRetry(
        sendMessageOperation,
        authUser._id,
        'send-message',
        1
      );

      // Navigate to call page
      navigate(`/call/${callId}`);
      
      toast.success("Video call started successfully!");

    } catch (error) {
      console.error("Error starting video call:", error);
      
      // FIXED: Better error handling
      if (error.message.includes('timed out')) {
        toast.error("Video call setup timed out. Please check your connection and try again.");
      } else if (rateLimitHandler.isRateLimitError(error)) {
        toast.error("Too many requests. Please wait before starting another call.");
      } else if (error.message.includes('WebSocket')) {
        toast.error("Connection issue. Please refresh the page and try again.");
        // FIXED: Cleanup video client on WebSocket errors
        if (authUser?._id) {
          await disconnectVideoClient(authUser._id);
          setVideoClient(null);
        }
      } else {
        toast.error("Failed to start video call. Please try again.");
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    
    if (authLoading) return;
    
    if (!authUser || !targetUserId) {
      setLoading(false);
      return;
    }

    // Add a small delay before initializing to prevent rapid requests
    const timeoutId = setTimeout(() => {
      initializeChat();
    }, 1000);

    return () => {
      clearTimeout(timeoutId);
      mountedRef.current = false;
    };
  }, [authUser, targetUserId, authLoading, initializeChat]);

  // FIXED: Always cleanup on unmount, not just on logout
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (authUser?._id) {
        // Always cleanup video client when component unmounts
        disconnectVideoClient(authUser._id);
      }
    };
  }, [authUser]);

  // Cleanup on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      completeCleanup();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [completeCleanup]);

  // Loading state
  if (loading || authLoading) {
    return <ChatLoader />;
  }

  // Error state with better messaging
  if (error || connectionState === 'error') {
    return (
      <div className="flex items-center justify-center h-[93vh]">
        <div className="text-center max-w-md p-6">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Chat Connection Error
          </h2>
          <p className="text-gray-600 mb-4">
            {error || "Failed to connect to chat"}
          </p>
          {error?.includes("Rate limit") && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-orange-700">
                ⚠️ The chat service is temporarily busy due to high usage. 
                Please wait 2-3 minutes before trying again.
              </p>
            </div>
          )}
          <div className="space-x-2">
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                initializeChat();
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              disabled={error?.includes("Rate limit")}
            >
              {error?.includes("Rate limit") ? "Please Wait..." : "Retry Connection"}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!chatClient || !channel || connectionState !== 'connected') {
    return <ChatLoader />;
  }

  return (
    <div className="h-[93vh]">
      <Chat client={chatClient}>
        <Channel channel={channel}>
          <CallButton handleVideoCall={handleVideoCall} />
          <Window>
            <ChannelHeader />
            <MessageList />
            <MessageInput focus />
          </Window>
          <Thread />
        </Channel>
      </Chat>
    </div>
  );
};    

export default ChatPage;