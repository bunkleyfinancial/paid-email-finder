// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "crawlBasic") {
      // Basic email crawl (current page only)
      const emails = findEmailsOnPage();
      sendResponse({ contacts: emails });
  } else if (request.action === "crawlPremium") {
      // Premium email crawl with token verification
      if (!request.token) {
          sendResponse({ error: "No authentication token provided" });
          return true;
      }
      
      verifyPremiumAndFindEmails(request.token)
          .then(emailsWithContext => {
              sendResponse({ contacts: emailsWithContext });
          })
          .catch(error => {
              sendResponse({ error: error.message });
          });
      return true; // Required for async sendResponse
  }
  return true;
});

// Find emails on the current page
function findEmailsOnPage() {
  const bodyText = document.body.innerText;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const emails = bodyText.match(emailPattern) || [];
  const uniqueEmails = [...new Set(emails)];

  return uniqueEmails;
}

// Verify premium status and find emails with context
async function verifyPremiumAndFindEmails(token) {
  try {
      // First verify the token is valid
      const verifyResponse = await fetch('https://your-api.com/verify-token', {
          method: 'GET',
          headers: {
              'Authorization': `Bearer ${token}`
          }
      });
      
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResult.valid) {
          throw new Error('Premium subscription required');
      }
      
      // If valid, crawl for emails with context
      return findEmailsWithContext();
  } catch (error) {
      console.error('Token verification error:', error);
      throw new Error('Premium verification failed');
  }
}

// Find emails with context for premium users
function findEmailsWithContext() {
  const uniqueEmails = new Set();
  const emailsWithContext = [];
  
  // Get the HTML and visible text of the page
  const html = document.documentElement.innerHTML;
  const bodyText = document.body.innerText;
  
  // Extract emails with context
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match;
  
  while ((match = emailPattern.exec(html)) !== null) {
      const email = match[0];
      
      if (uniqueEmails.has(email)) {
          continue;
      }
      
      uniqueEmails.add(email);
      
      // Get context (text before the email)
      const emailIndex = bodyText.indexOf(email);
      let prefix = "";
      
      if (emailIndex !== -1) {
          // Take up to 50 characters before the email
          prefix = bodyText.substring(Math.max(0, emailIndex - 50), emailIndex).trim();
      } else {
          prefix = "No visible context";
      }
      
      emailsWithContext.push([prefix, email]);
  }
  
  return emailsWithContext;
}