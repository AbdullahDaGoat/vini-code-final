// storage.js
// In-memory store: { token -> { record, timeoutId } }
const sessions = new Map();

/**
 * Add a record with an expiration
 * @param {string} token 
 * @param {object} data 
 * @param {number} ttlMs 
 */
export function addTemporaryRecord(token, data, ttlMs) {
  // If there's an existing record, clear its timeout
  if (sessions.has(token)) {
    clearTimeout(sessions.get(token).timeoutId);
  }
  const timeoutId = setTimeout(() => {
    sessions.delete(token);
  }, ttlMs);

  sessions.set(token, { record: data, timeoutId });
}

/**
 * Retrieve a record if it exists
 * @param {string} token 
 * @returns {object|null}
 */
export function getTemporaryRecord(token) {
  const entry = sessions.get(token);
  if (!entry) return null;
  return entry.record;
}

/**
 * Manually remove a record
 * @param {string} token 
 */
export function removeTemporaryRecord(token) {
  if (sessions.has(token)) {
    clearTimeout(sessions.get(token).timeoutId);
    sessions.delete(token);
  }
}