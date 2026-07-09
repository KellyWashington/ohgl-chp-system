import { sb } from './supabaseClient.js';

/**
 * Registration Rate Limit Service
 * Handles server-side rate limiting checks for registration
 */

export function checkRegistrationRateLimit(email, ipAddress = null) {
  return sb.rpc('check_registration_rate_limit', {
    p_email: email,
    p_ip_address: ipAddress
  });
}

export function logRegistrationAttempt(email, status, errorMessage = null, ipAddress = null, userAgent = null) {
  return sb.rpc('log_registration_attempt', {
    p_email: email,
    p_status: status,
    p_error_message: errorMessage,
    p_ip_address: ipAddress,
    p_user_agent: userAgent
  });
}

export function getMyRegistrationAttempts() {
  return sb.rpc('get_my_registration_attempts');
}

/**
 * Get client IP address from request context
 * For browser-based apps, this must be handled at edge/server level
 */
export function getClientIpAddress() {
  // In production, configure your hosting platform (Vercel, Netlify, etc)
  // to pass X-Forwarded-For header
  // For now, return null - backend will use request context
  return null;
}

/**
 * Helper to format rate limit error messages
 */
export function formatRateLimitError(result) {
  if (!result.is_rate_limited) {
    return null;
  }
  return result.reason || 'Too many registration attempts. Please try again later.';
}
