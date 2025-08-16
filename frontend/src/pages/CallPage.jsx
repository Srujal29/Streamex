import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import useAuthUser from "../hooks/useAuthUser";
import { useQuery } from "@tanstack/react-query";
import { getStreamToken } from "../lib/api";

import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  CallControls,
  SpeakerLayout,
  StreamTheme,
  CallingState,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";

import "@stream-io/video-react-sdk/dist/css/styles.css";
import toast from "react-hot-toast";
import PageLoader from "../components/PageLoader";

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY;

const CallPage = () => {
  const { id: callId } = useParams();
  const navigate = useNavigate();
  
  const [client, setClient] = useState(null);
  const [call, setCall] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const isInitialized = useRef(false);
  const clientRef = useRef(null);
  const callRef = useRef(null);

  const { authUser, isLoading: authLoading } = useAuthUser();

  const { data: tokenData, error: tokenError, isLoading: tokenLoading } = useQuery({
    queryKey: ["streamToken"],
    queryFn: getStreamToken,
    enabled: !!authUser,
    retry: 2,
  });

  // Cleanup function
  const cleanup = useCallback(async () => {
    console.log("🧹 Cleaning up video call...");
    
    try {
      // Leave call if it exists
      if (callRef.current) {
        try {
          await callRef.current.leave();
          console.log("✅ Left call successfully");
        } catch (error) {
          if (!error.message.includes('already been left')) {
            console.error("Error leaving call:", error);
          }
        }
        callRef.current = null;
      }

      // Disconnect client if it exists
      if (clientRef.current) {
        try {
          await clientRef.current.disconnectUser();
          console.log("✅ Disconnected client successfully");
        } catch (error) {
          console.error("Error disconnecting client:", error);
        }
        clientRef.current = null;
      }

      // Reset state
      setClient(null);
      setCall(null);
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }, []);

  // Initialize video call
  const initializeCall = useCallback(async () => {
    if (isInitialized.current || !tokenData?.token || !authUser || !callId) {
      return;
    }

    isInitialized.current = true;
    setIsLoading(true);
    setError(null);

    try {
      console.log("🚀 Initializing video call...");

      // Create user object
      const user = {
        id: authUser._id,
        name: authUser.fullName,
        image: authUser.profilePic || "/default-avatar.png",
      };

      console.log("Creating video client for user:", user);

      // Create video client
      const videoClient = new StreamVideoClient({
        apiKey: STREAM_API_KEY,
        user,
        token: tokenData.token,
      });

      clientRef.current = videoClient;

      // Create call
      const videoCall = videoClient.call("default", callId);
      callRef.current = videoCall;

      console.log("Joining call...");

      // Join the call
      await videoCall.join({
        create: true,
        data: {
          created_by_id: authUser._id,
        },
      });

      console.log("✅ Successfully joined call");

      // Update state
      setClient(videoClient);
      setCall(videoCall);
      setError(null);

    } catch (error) {
      console.error("❌ Error initializing call:", error);
      setError(error.message || "Failed to join call");
      
      // Cleanup on error
      await cleanup();
    } finally {
      setIsLoading(false);
    }
  }, [tokenData, authUser, callId, cleanup]);

  // Initialize call when dependencies are ready
  useEffect(() => {
    if (tokenData?.token && authUser && callId && !isInitialized.current) {
      initializeCall();
    }
  }, [tokenData, authUser, callId, initializeCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Handle browser close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanup();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [cleanup]);

  // Loading state
  if (authLoading || tokenLoading || isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  // Error states
  if (tokenError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center">
        <div className="text-center max-w-md p-6">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Authentication Error
          </h2>
          <p className="text-gray-600 mb-4">
            Failed to get video token. Please refresh the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center">
        <div className="text-center max-w-md p-6">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Call Error
          </h2>
          <p className="text-gray-600 mb-4">
            {error}
          </p>
          <div className="space-x-2">
            <button
              onClick={() => {
                isInitialized.current = false;
                setError(null);
                initializeCall();
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Try Again
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render video call
  if (client && call) {
    return (
      <div className="h-screen bg-gray-900">
        <StreamVideo client={client}>
          <StreamCall call={call}>
            <CallContent onLeave={cleanup} navigate={navigate} />
          </StreamCall>
        </StreamVideo>
      </div>
    );
  }

  // Fallback loading state
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <PageLoader />
        <p className="mt-4 text-gray-600">Setting up your call...</p>
      </div>
    </div>
  );
};

// Call content component
const CallContent = ({ onLeave, navigate }) => {
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();

  // Handle call end
  useEffect(() => {
    if (callingState === CallingState.LEFT) {
      console.log("📞 Call ended");
      onLeave();
      navigate("/");
    }
  }, [callingState, navigate, onLeave]);

  return (
    <StreamTheme className="h-full">
      <div className="relative h-full">
        <SpeakerLayout />
        <div className="absolute bottom-0 left-0 right-0 z-10 p-4">
          <CallControls />
        </div>
      </div>
    </StreamTheme>
  );
};

export default CallPage;