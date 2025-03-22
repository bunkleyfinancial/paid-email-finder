// Listen for messages from the popup
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
  } else if (message.action === "subscribe_initiated") {
    // Start checking for subscription completion
    startSubscriptionCheck(message.customerId);
    return true;
  }
});

// Check for subscription completion in the payment page
function startSubscriptionCheck(customerId) {
  // Create an alarm to check every 3 seconds
  chrome.alarms.create("checkPaymentPage", { periodInMinutes: 0.05 });
  
  // Store the customerId for later use
  chrome.storage.local.set({ 'pendingCustomerId': customerId });
  
  console.log('Started subscription check for customer ID:', customerId);
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === "checkPaymentPage") {
    checkPaymentPageForSubscription();
  } else if (alarm.name === "checkSubscription") {
    checkSubscriptionStatus();
  }
});

// Check payment page for subscription
function checkPaymentPageForSubscription() {
  chrome.storage.local.get(['pendingCustomerId'], function(data) {
    if (!data.pendingCustomerId) {
      // No pending subscription, stop checking
      chrome.alarms.clear("checkPaymentPage");
      return;
    }
    
    // Find any payment pages that might be open
    chrome.tabs.query({url: "https://paid-email-finder-o7ey.vercel.app/payment.html*"}, function(tabs) {
      if (tabs.length === 0) {
        // No payment pages open, keep the alarm running for a bit in case user is still navigating
        return;
      }
      
      // We found payment pages, check for subscription data
      chrome.scripting.executeScript({
        target: {tabId: tabs[0].id},
        function: function() {
          // Check if subscription data exists in localStorage
          try {
            const subscriptionData = localStorage.getItem('crawlSpaceSubscription');
            if (subscriptionData) {
              const data = JSON.parse(subscriptionData);
              return data;
            }
          } catch (error) {
            console.error('Error reading subscription data:', error);
          }
          return null;
        }
      }).then(results => {
        if (results && results[0] && results[0].result) {
          // We found subscription data, process it
          const data = results[0].result;
          
          // Store the subscription data
          chrome.storage.sync.set({
            'subscriptionToken': data.token,
            'subscriptionStatus': true,
            'subscriptionExpiry': data.expiresAt,
            'customerId': data.customerId
          }, () => {
            console.log('Subscription data stored successfully');
          });
          
          // Notify any open popup pages
          chrome.runtime.sendMessage({
            action: "subscription_updated"
          });
          
          // Clear the subscription data from the page
          chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            function: function() {
              localStorage.removeItem('crawlSpaceSubscription');
            }
          });
          
          // Clear the pending customerId and alarm
          chrome.storage.local.remove('pendingCustomerId');
          chrome.alarms.clear("checkPaymentPage");
          
          // Set up regular subscription checks
          chrome.alarms.create("checkSubscription", { periodInMinutes: 60 * 24 }); // Check daily
        }
      }).catch(error => {
        console.error("Error checking payment page:", error);
      });
    });
  });
}

// Periodically check subscription status
function checkSubscriptionStatus() {
  chrome.storage.sync.get(['subscriptionToken', 'customerId', 'subscriptionExpiry'], async function(data) {
    const token = data.subscriptionToken;
    const customerId = data.customerId;
    
    if (!token || !customerId) {
      console.log('No subscription token or customer ID found');
      return;
    }
    
    try {
      const response = await fetch('https://paid-email-finder-o7ey.vercel.app/api/verify-subscription/' + customerId, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Subscription check failed with status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.subscribed) {
        // Update with fresh token and expiry
        chrome.storage.sync.set({
          'subscriptionToken': result.token,
          'subscriptionStatus': true,
          'subscriptionExpiry': result.expiresAt
        }, () => {
          console.log('Subscription renewed successfully');
        });
      } else {
        // Subscription expired
        chrome.storage.sync.set({
          'subscriptionStatus': false
        }, () => {
          console.log('Subscription marked as expired');
        });
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  });
}

// Set up subscription check on extension start
chrome.runtime.onInstalled.addListener(function() {
  console.log('Extension installed/updated. Setting up subscription check.');
  chrome.alarms.create("checkSubscription", { periodInMinutes: 60 * 24 }); // Check daily
});