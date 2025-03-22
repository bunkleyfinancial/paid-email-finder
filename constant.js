// Base URL for all API calls
const API_BASE_URL = 'https://paid-email-finder-o7ey.vercel.app';

// Make constants available to other extension scripts
if (typeof module !== 'undefined') {
  module.exports = { API_BASE_URL };
}