const limits = new Map();

/**
 * Checks if a specific key has exceeded the rate limit.
 * @param {string} key Unique identifier for the rate limit target (e.g., 'login', 'submit_referral')
 * @param {number} maxRequests Maximum number of requests allowed in the window
 * @param {number} windowMs Time window in milliseconds
 * @returns {boolean} True if the request is allowed, false if it is blocked (rate-limited)
 */
export function checkRateLimit(key, maxRequests = 5, windowMs = 10000) {
  const now = Date.now();
  if (!limits.has(key)) {
    limits.set(key, []);
  }
  
  // Filter out timestamps older than the window
  const timestamps = limits.get(key).filter(t => now - t < windowMs);
  
  if (timestamps.length >= maxRequests) {
    return false;
  }
  
  timestamps.push(now);
  limits.set(key, timestamps);
  return true;
}
