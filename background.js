// Listen for messages from the subscribe page
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "subscription_complete") {
    // Store subscription details
    chrome.storage.sync.set({
      'subscriptionToken': message.token,
      'subscriptionStatus': true,
      'subscriptionExpiry': message.expiresAt
    }, function() {
      sendResponse({success: true});
      
      // Notify any open popup pages to refresh their UI
      chrome.runtime.sendMessage({
        action: "subscription_updated"
      });
    });
    
    return true; // Required for async sendResponse
  }
});

// Check if subscription needs to be refreshed (optional)
chrome.alarms.create("checkSubscription", { periodInMinutes: 60 * 24 }); // Check daily

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === "checkSubscription") {
    checkSubscriptionStatus();
  }
});

function checkSubscriptionStatus() {
  chrome.storage.sync.get(['subscriptionToken', 'customerId', 'subscriptionExpiry'], async function(data) {
    const token = data.subscriptionToken;
    const customerId = data.customerId;
    
    if (!token || !customerId) return;
    
    try {
      const response = await fetch('https://paid-email-finder-o7ey-ap12ovqkk-joshuas-projects-e1236601.vercel.app/api/verify-subscription/' + customerId, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const result = await response.json();
      
      if (result.subscribed) {
        // Update with fresh token and expiry
        chrome.storage.sync.set({
          'subscriptionToken': result.token,
          'subscriptionStatus': true,
          'subscriptionExpiry': result.expiresAt
        });
      } else {
        // Subscription expired
        chrome.storage.sync.set({
          'subscriptionStatus': false
        });
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  });
}