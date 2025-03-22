chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "crawlBasic") {
      const emails = findEmailsOnPage();
      sendResponse({ contacts: emails });
  } else if (request.action === "crawlPremium") {
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
      return true;
  }
  return true;
});

function findEmailsOnPage() {
  const bodyText = document.body.innerText;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const emails = bodyText.match(emailPattern) || [];
  const uniqueEmails = [...new Set(emails)];

  return uniqueEmails;
}

async function verifyPremiumAndFindEmails(token) {
  try {
      const verifyResponse = await fetch('https://paid-email-finder-o7ey-i2arq6e68-joshuas-projects-e1236601.vercel.app/api/verify-token', {
          method: 'GET',
          headers: {
              'Authorization': `Bearer ${token}`
          }
      });
      
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResult.valid) {
          throw new Error('Premium subscription required');
      }
      
      return findEmailsWithContext();
  } catch (error) {
      console.error('Token verification error:', error);
      throw new Error('Premium verification failed');
  }
}

function findEmailsWithContext() {
  const uniqueEmails = new Set();
  const emailsWithContext = [];
  
  const html = document.documentElement.innerHTML;
  const bodyText = document.body.innerText;
  
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match;
  
  while ((match = emailPattern.exec(html)) !== null) {
      const email = match[0];
      
      if (uniqueEmails.has(email)) {
          continue;
      }
      
      uniqueEmails.add(email);
      
      const emailIndex = bodyText.indexOf(email);
      let prefix = "";
      
      if (emailIndex !== -1) {
          prefix = bodyText.substring(Math.max(0, emailIndex - 50), emailIndex).trim();
      } else {
          prefix = "No visible context";
      }
      
      emailsWithContext.push([prefix, email]);
  }
  
  return emailsWithContext;
}