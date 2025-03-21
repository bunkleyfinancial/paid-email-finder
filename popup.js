document.addEventListener('DOMContentLoaded', function() {
  // Check subscription status immediately
  checkSubscriptionStatus();
  
  // Set up button click handlers
  document.getElementById('subscribe-button').addEventListener('click', openSubscribePage);
  document.getElementById('crawl-basic').addEventListener('click', findEmailsBasic);
});

// Check if the user has an active subscription
function checkSubscriptionStatus() {
  chrome.storage.sync.get(['subscriptionToken', 'customerId', 'subscriptionExpiry'], async function(data) {
      const token = data.subscriptionToken;
      const customerId = data.customerId;
      const expiry = data.subscriptionExpiry;
      
      // If we have no customer ID yet, generate one
      if (!customerId) {
          const newCustomerId = 'cust_' + Math.random().toString(36).substring(2, 15);
          chrome.storage.sync.set({ 'customerId': newCustomerId });
      }
      
      // If we have a token and it's not expired
      if (token && expiry && new Date(expiry) > new Date()) {
          // Verify with the server
          try {
              const response = await fetch('https://your-api.com/verify-token', {
                  method: 'GET',
                  headers: {
                      'Authorization': `Bearer ${token}`
                  }
              });
              
              const result = await response.json();
              
              if (result.valid) {
                  // Token is valid, enable premium features
                  enablePremiumFeatures();
              } else {
                  // Token is invalid, disable premium features
                  disablePremiumFeatures();
              }
          } catch (error) {
              console.error('Verification error:', error);
              disablePremiumFeatures();
          }
      } else {
          // No token or expired token
          disablePremiumFeatures();
      }
  });
}

// Enable premium features in the UI
function enablePremiumFeatures() {
  document.getElementById('subscription-status').textContent = 'Premium';
  document.getElementById('subscription-status').className = 'status-badge status-premium';
  
  // Get the premium button and enable it
  const premiumButton = document.getElementById('crawl-premium');
  if (premiumButton) {
      premiumButton.disabled = false;
      premiumButton.classList.remove('disabled');
      
      // Add click event listener
      premiumButton.addEventListener('click', findEmailsPremium);
  }
  
  // Show premium features if any are hidden
  const premiumFeatures = document.getElementsByClassName('premium-feature');
  for (let i = 0; i < premiumFeatures.length; i++) {
      premiumFeatures[i].style.display = 'block';
  }
  
  // Hide the subscribe button
  document.getElementById('subscribe-button').style.display = 'none';
  
  // Show subscription info
  chrome.storage.sync.get(['subscriptionExpiry'], function(data) {
      if (data.subscriptionExpiry) {
          const expiryDate = new Date(data.subscriptionExpiry);
          const expiryFormatted = expiryDate.toLocaleDateString();
          
          const subInfoElem = document.createElement('div');
          subInfoElem.id = 'subscription-info';
          subInfoElem.innerHTML = `Premium subscription active until ${expiryFormatted}`;
          subInfoElem.className = 'subscription-info';
          
          // Insert after status element
          const statusElem = document.getElementById('subscription-status');
          statusElem.parentNode.insertBefore(subInfoElem, statusElem.nextSibling);
      }
  });
}

// Disable premium features in the UI
function disablePremiumFeatures() {
  document.getElementById('subscription-status').textContent = 'Free';
  document.getElementById('subscription-status').className = 'status-badge status-free';
  
  // Get the premium button and disable it
  const premiumButton = document.getElementById('crawl-premium');
  if (premiumButton) {
      premiumButton.disabled = true;
      premiumButton.classList.add('disabled');
      
      // Remove any existing event listeners
      premiumButton.replaceWith(premiumButton.cloneNode(true));
  }
  
  // Show the subscribe button
  document.getElementById('subscribe-button').style.display = 'block';
  
  // Remove subscription info if it exists
  const subInfoElem = document.getElementById('subscription-info');
  if (subInfoElem) {
      subInfoElem.remove();
  }
}

// Open the subscription page
function openSubscribePage() {
  chrome.storage.sync.get(['customerId'], function(data) {
      let customerId = data.customerId;
      
      // If no customer ID exists, create one
      if (!customerId) {
          customerId = 'cust_' + Math.random().toString(36).substring(2, 15);
          chrome.storage.sync.set({ 'customerId': customerId });
      }
      
      // Open the subscribe page with the customer ID
      chrome.tabs.create({ url: `subscribe.html?customerId=${customerId}` });
  });
}

// Basic email finder function (free tier) - only scans current page
function findEmailsBasic() {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.scripting.executeScript({
          target: {tabId: tabs[0].id},
          function: findEmailsOnPage,
      }, (results) => {
          const emails = results[0]?.result || [];
          if (emails.length > 0) {
              copyToClipboard(emails.join("\n"));
              displayEmails(emails);
          } else {
              document.getElementById('results').innerHTML = '<p>No emails found.</p>';
          }
      });
  });
}

// Function to find emails on the current page
function findEmailsOnPage() {
  const bodyText = document.body.innerText;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const emails = bodyText.match(emailPattern) || [];
  const uniqueEmails = [...new Set(emails)];

  return uniqueEmails;
}

// Premium email finder function (premium tier) - crawls entire website
function findEmailsPremium() {
  chrome.storage.sync.get(['subscriptionToken'], function(data) {
      if (!data.subscriptionToken) {
          alert('Premium subscription required');
          return;
      }

      // Show loading state
      document.getElementById('results').innerHTML = '<p>Crawling website for emails (Premium)...</p>';

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const currentTab = tabs[0];
          try {
              // Start the crawling process
              chrome.scripting.executeScript({
                  target: { tabId: currentTab.id },
                  function: () => {
                      // This will be replaced by the actual crawling after we pass it to executeScript
                      return { started: true };
                  }
              }, () => {
                  // Now we need to execute a more complex function with the crawling logic
                  chrome.scripting.executeScript({
                      target: { tabId: currentTab.id },
                      function: crawlDomain,
                  }, (results) => {
                      if (results && results[0] && results[0].result) {
                          const emailsWithContext = results[0].result;
                          if (emailsWithContext.length > 0) {
                              copyToClipboard(emailsWithContext);
                              displayEmailsWithContext(emailsWithContext);
                          } else {
                              document.getElementById('results').innerHTML = '<p>No emails found.</p>';
                          }
                      } else {
                          document.getElementById('results').innerHTML = '<p>Error finding emails.</p>';
                      }
                  });
              });
          } catch (error) {
              console.error("Error in crawl process:", error);
              document.getElementById('results').innerHTML = '<p>Error: ' + error.message + '</p>';
          }
      });
  });
}

// Function to crawl the entire domain for emails
function crawlDomain() {
  const visitedLinks = new Set();
  const emailsWithContext = [];
  const uniqueEmails = new Set();
  const maxPagesToVisit = 50;
  let pagesVisited = 0;
  
  // Get the current domain
  const currentUrl = window.location.href;
  const domainPattern = /^(https?:\/\/[^/]+)/i;
  const domainMatch = currentUrl.match(domainPattern);
  const baseDomain = domainMatch ? domainMatch[1] : '';
  
  // Helper function to check if a URL is on the same domain
  function isSameDomain(url) {
      return url.startsWith(baseDomain);
  }
  
  // Helper function to get all links on a page
  function getLinksOnPage() {
      return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(href => href && href.startsWith('http'));
  }
  
  // Helper function to extract emails with context
  function extractEmailsWithContext(html, bodyText) {
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
  }
  
  // Process the current page
  function processCurrentPage() {
      visitedLinks.add(currentUrl);
      pagesVisited++;
      
      const html = document.documentElement.innerHTML;
      const bodyText = document.body.innerText;
      
      // Extract emails from the current page
      extractEmailsWithContext(html, bodyText);
      
      // Get all links on the current page
      const links = getLinksOnPage();
      
      // Create queue of links to visit
      const linkQueue = [];
      for (const link of links) {
          if (!visitedLinks.has(link) && isSameDomain(link)) {
              linkQueue.push(link);
          }
      }
      
      // Function to process a single link
      async function processLink(link) {
          if (visitedLinks.has(link) || !isSameDomain(link)) {
              return;
          }
          
          visitedLinks.add(link);
          pagesVisited++;
          
          try {
              // Fetch the page content
              const response = await fetch(link, {
                  method: 'GET',
                  headers: {
                      'User-Agent': 'Mozilla/5.0 (compatible; ContactFinderBot/1.0)'
                  }
              });
              
              if (!response.ok) {
                  throw new Error(`Failed to fetch ${link}: ${response.status}`);
              }
              
              const contentType = response.headers.get('content-type');
              if (!contentType || !contentType.includes('text/html')) {
                  return; // Skip non-HTML content
              }
              
              const html = await response.text();
              
              // Create a DOM parser to extract text content
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');
              
              // Remove scripts and styles to get only visible text
              const scriptsAndStyles = doc.querySelectorAll('script, style');
              scriptsAndStyles.forEach(el => el.remove());
              
              const bodyText = doc.body ? doc.body.textContent : '';
              
              // Extract emails from the page
              extractEmailsWithContext(html, bodyText);
              
              // Extract new links to add to the queue
              const newLinks = Array.from(doc.querySelectorAll('a[href]'))
                  .map(a => a.href)
                  .filter(href => href && href.startsWith('http') && !visitedLinks.has(href) && isSameDomain(href));
              
              // Add new links to queue
              for (const newLink of newLinks) {
                  if (!linkQueue.includes(newLink)) {
                      linkQueue.push(newLink);
                  }
              }
          } catch (error) {
              console.log(`Error processing ${link}: ${error.message}`);
          }
      }
      
      // Process links one by one with promise chaining
      return linkQueue.reduce((promise, link) => {
          return promise.then(() => {
              if (pagesVisited < maxPagesToVisit) {
                  return processLink(link);
              }
          });
      }, Promise.resolve());
  }
  
  // Start processing from the current page
  return processCurrentPage().then(() => {
      return emailsWithContext;
  });
}

// Function to copy emails to clipboard
function copyToClipboard(data) {
  if (Array.isArray(data)) {
      // For array of arrays (context, email pairs)
      if (data.length > 0 && Array.isArray(data[0])) {
          const formattedData = data.map(pair => pair.join("\t")).join("\n");
          navigator.clipboard.writeText(formattedData).then(() => {
              alert(`Copied ${data.length} emails to clipboard!`);
          }).catch(err => {
              alert("Failed to copy: " + err);
          });
      } else {
          // For simple array of emails
          navigator.clipboard.writeText(data.join("\n")).then(() => {
              alert(`Copied ${data.length} emails to clipboard!`);
          }).catch(err => {
              alert("Failed to copy: " + err);
          });
      }
  } else if (typeof data === 'string') {
      // For string
      navigator.clipboard.writeText(data).then(() => {
          alert("Copied to clipboard!");
      }).catch(err => {
          alert("Failed to copy: " + err);
      });
  }
}

// Function to display basic emails in the UI
function displayEmails(emails) {
  const resultsDiv = document.getElementById('results');
  if (emails.length === 0) {
      resultsDiv.innerHTML = '<p>No emails found.</p>';
      return;
  }
  
  let html = '<h3>Emails Found:</h3><ul class="contacts-list">';
  
  emails.forEach(email => {
      html += `<li>
          <div class="contact-item">
              <div>📧 ${email}</div>
          </div>
      </li>`;
  });
  
  html += '</ul>';
  resultsDiv.innerHTML = html;
}

// Function to display emails with context in the UI
function displayEmailsWithContext(emailsWithContext) {
  const resultsDiv = document.getElementById('results');
  if (emailsWithContext.length === 0) {
      resultsDiv.innerHTML = '<p>No emails found.</p>';
      return;
  }
  
  let html = '<h3>Emails Found:</h3><ul class="contacts-list">';
  
  emailsWithContext.forEach(pair => {
      const context = pair[0];
      const email = pair[1];
      
      html += `<li>
          <div class="contact-item">
              <div>📧 ${email}</div>
              <div class="context-prefix">${context}</div>
          </div>
      </li>`;
  });
  
  html += '</ul>';
  resultsDiv.innerHTML = html;
}