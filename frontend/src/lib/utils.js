export const capitialize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

// src/utils/rateLimitHandler.js
export class RateLimitHandler {
  constructor() {
    this.retryAttempts = new Map(); // Track retry attempts per user/operation
    this.lastRequestTime = new Map(); // Track last request time per user
    this.minRequestInterval = 2000; // Minimum 2 seconds between requests
    this.connectionAttempts = new Map(); // Track WebSocket connection attempts
    this.blockedOperations = new Set(); // Track temporarily blocked operations
  }

  // Calculate exponential backoff delay
  calculateBackoffDelay(attempt) {
    const baseDelay = 2000; // 2 second base delay
    const maxDelay = 60000; // Maximum 60 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  // ENHANCED: Better rate limiting with operation-specific intervals
  shouldRateLimit(userId, operation = 'default') {
    const key = `${userId}-${operation}`;
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(key);

    // Check if operation is temporarily blocked
    if (this.blockedOperations.has(key)) {
      return true;
    }

    // Operation-specific intervals
    const intervals = {
      'video-call': 5000,     // 5 seconds between video calls
      'channel-create': 3000,  // 3 seconds between channel creations
      'user-connect': 4000,    // 4 seconds between user connections
      'send-message': 1000,    // 1 second between messages
      'default': this.minRequestInterval
    };

    const interval = intervals[operation] || this.minRequestInterval;

    if (lastRequest && (now - lastRequest) < interval) {
      return true;
    }

    this.lastRequestTime.set(key, now);
    return false;
  }

  // ENHANCED: WebSocket-specific rate limiting
  shouldRateLimitWebSocket(userId, type = 'connect') {
    const key = `${userId}-ws-${type}`;
    const now = Date.now();
    const attempts = this.connectionAttempts.get(key) || { count: 0, firstAttempt: now };

    // Reset if enough time has passed
    if (now - attempts.firstAttempt > 300000) { // Reset after 5 minutes
      this.connectionAttempts.delete(key);
      return false;
    }

    // Allow max 5 WebSocket attempts per 5 minutes
    if (attempts.count >= 5) {
      console.warn(`🚫 WebSocket rate limit reached for ${userId}-${type}`);
      return true;
    }

    // Increment attempt count
    attempts.count++;
    this.connectionAttempts.set(key, attempts);
    return false;
  }

  // ENHANCED: Execute operation with retry logic and WebSocket handling
  async executeWithRetry(operation, userId, operationType = 'default', maxRetries = 3) {
    const key = `${userId}-${operationType}`;
    let attempt = this.retryAttempts.get(key) || 0;

    // Special handling for WebSocket operations
    if (operationType.includes('video') || operationType.includes('connect')) {
      if (this.shouldRateLimitWebSocket(userId, operationType)) {
        throw new Error('WebSocket connection rate limit exceeded. Please wait 5 minutes.');
      }
    }

    // Check rate limit before attempting
    if (this.shouldRateLimit(userId, operationType)) {
      const delay = this.calculateBackoffDelay(attempt);
      console.log(`⏳ Rate limiting ${operationType} for user ${userId}, waiting ${delay}ms`);
      await this.sleep(delay);
    }

    try {
      const result = await operation();
      
      // Reset retry count on success
      this.retryAttempts.delete(key);
      this.blockedOperations.delete(key);
      return result;
    } catch (error) {
      console.error(`❌ ${operationType} failed (attempt ${attempt + 1}):`, error);
      
      // ENHANCED: Better error classification
      if (this.isRateLimitError(error) || this.isWebSocketError(error)) {
        if (attempt < maxRetries) {
          attempt++;
          this.retryAttempts.set(key, attempt);
          
          // ENHANCED: Longer delays for WebSocket errors
          let delay = this.calculateBackoffDelay(attempt);
          if (this.isWebSocketError(error)) {
            delay *= 2; // Double delay for WebSocket issues
            console.log(`🔌 WebSocket error detected, using extended delay`);
          }
          
          console.log(`🔄 Retrying ${operationType} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          
          await this.sleep(delay);
          return this.executeWithRetry(operation, userId, operationType, maxRetries);
        } else {
          // ENHANCED: Block operation temporarily after max retries
          this.blockedOperations.add(key);
          setTimeout(() => {
            this.blockedOperations.delete(key);
          }, 300000); // Block for 5 minutes
          
          console.error(`💥 Max retries exceeded for ${operationType}, blocking for 5 minutes`);
          
          if (this.isWebSocketError(error)) {
            throw new Error('Video connection failed. Please refresh the page and try again.');
          } else {
            throw new Error('Rate limit exceeded. Please wait 5 minutes before trying again.');
          }
        }
      }
      
      // If it's not a rate limit or WebSocket error, throw immediately
      throw error;
    }
  }

  // ENHANCED: Check if error is rate limit related
  isRateLimitError(error) {
    const rateLimitIndicators = [
      'too many requests',
      'rate limit',
      'error code 9',
      'statuscode":429',
      'status code 429',
      'getorcreatechannel failed',
      'quota exceeded',
      'limit exceeded'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    const errorString = error.toString?.()?.toLowerCase() || '';
    
    return rateLimitIndicators.some(indicator => 
      errorMessage.includes(indicator) || errorString.includes(indicator)
    );
  }

  // NEW: Check if error is WebSocket related
  isWebSocketError(error) {
    const wsErrorIndicators = [
      'websocket',
      'ws failed',
      'connection failed',
      'code: 1006',
      'joinresponse',
      'timed out',
      'network error',
      'connection closed',
      'sfu',
      'coordinator'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    const errorString = error.toString?.()?.toLowerCase() || '';
    
    return wsErrorIndicators.some(indicator => 
      errorMessage.includes(indicator) || errorString.includes(indicator)
    );
  }

  // NEW: Check if system is under high load
  isSystemOverloaded() {
    const totalAttempts = Array.from(this.retryAttempts.values()).reduce((sum, val) => sum + val, 0);
    const totalBlocked = this.blockedOperations.size;
    
    return totalAttempts > 50 || totalBlocked > 10;
  }

  // ENHANCED: Sleep utility with system load awareness
  async sleep(ms) {
    // Add extra delay if system is overloaded
    if (this.isSystemOverloaded()) {
      ms *= 1.5;
      console.log(`⚠️ System overloaded, extending delay to ${ms}ms`);
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ENHANCED: Clear retry attempts for a user
  clearUserAttempts(userId) {
    const keysToDelete = [];
    
    // Clear retry attempts
    for (const key of this.retryAttempts.keys()) {
      if (key.startsWith(userId)) {
        keysToDelete.push(key);
      }
    }
    
    // Clear last request times
    for (const key of this.lastRequestTime.keys()) {
      if (key.startsWith(userId)) {
        keysToDelete.push(key);
      }
    }
    
    // Clear blocked operations
    for (const key of this.blockedOperations) {
      if (key.startsWith(userId)) {
        this.blockedOperations.delete(key);
      }
    }
    
    // Clear WebSocket attempts
    for (const key of this.connectionAttempts.keys()) {
      if (key.startsWith(userId)) {
        this.connectionAttempts.delete(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.retryAttempts.delete(key);
      this.lastRequestTime.delete(key);
    });
    
    console.log(`🧹 Cleared all rate limit data for user: ${userId}`);
  }

  // NEW: Get user's current rate limit status
  getUserStatus(userId) {
    const userKeys = Array.from(this.retryAttempts.keys()).filter(key => key.startsWith(userId));
    const blockedKeys = Array.from(this.blockedOperations).filter(key => key.startsWith(userId));
    const wsKeys = Array.from(this.connectionAttempts.keys()).filter(key => key.startsWith(userId));
    
    return {
      activeRetries: userKeys.length,
      blockedOperations: blockedKeys.length,
      wsConnections: wsKeys.length,
      isOverloaded: this.isSystemOverloaded()
    };
  }

  // NEW: Emergency reset (use sparingly)
  emergencyReset() {
    console.warn('🚨 Emergency rate limit reset triggered');
    this.retryAttempts.clear();
    this.lastRequestTime.clear();
    this.blockedOperations.clear();
    this.connectionAttempts.clear();
  }
}

// Global instance
export const rateLimitHandler = new RateLimitHandler();

// NEW: Utility functions for connection management
export const connectionUtils = {
  // Check if browser supports WebSocket
  supportsWebSocket() {
    return typeof WebSocket !== 'undefined';
  },

  // Check if network connection is stable
  isNetworkStable() {
    return navigator.onLine && 
           (!navigator.connection || navigator.connection.effectiveType !== 'slow-2g');
  },

  // Get connection quality estimate
  getConnectionQuality() {
    if (!navigator.connection) return 'unknown';
    
    const { effectiveType, downlink } = navigator.connection;
    
    if (downlink > 10 || effectiveType === '4g') return 'excellent';
    if (downlink > 1.5 || effectiveType === '3g') return 'good';
    if (effectiveType === '2g') return 'poor';
    return 'very-poor';
  },

  // Wait for stable network connection
  async waitForStableConnection(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (this.isNetworkStable()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return false;
  }
};

// NEW: Debug utilities
export const debugUtils = {
  // Log rate limit status
  logRateLimitStatus(userId) {
    const status = rateLimitHandler.getUserStatus(userId);
    console.log(`📊 Rate limit status for ${userId}:`, status);
    return status;
  },

  // Monitor WebSocket connections
  monitorWebSockets() {
    const originalWebSocket = window.WebSocket;
    let connectionCount = 0;
    
    window.WebSocket = function(...args) {
      connectionCount++;
      console.log(`🔌 WebSocket connection #${connectionCount} created:`, args[0]);
      
      const ws = new originalWebSocket(...args);
      
      ws.addEventListener('open', () => {
        console.log(`✅ WebSocket connection #${connectionCount} opened`);
      });
      
      ws.addEventListener('close', (event) => {
        console.log(`❌ WebSocket connection #${connectionCount} closed:`, event.code, event.reason);
      });
      
      ws.addEventListener('error', (error) => {
        console.error(`🚫 WebSocket connection #${connectionCount} error:`, error);
      });
      
      return ws;
    };
    
    return () => {
      window.WebSocket = originalWebSocket;
    };
  }
};