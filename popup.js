document.addEventListener('DOMContentLoaded', function() {
    checkSubscriptionStatus();
    
    document.getElementById('subscribe-button').addEventListener('click', openSubscribePage);
    document.getElementById('crawl-basic').addEventListener('click', findEmailsBasic);
  });
  
  function checkSubscriptionStatus() {
    chrome.storage.sync.get(['subscriptionToken', 'customerId', 'subscriptionExpiry'], async function(data) {
        const token = data.subscriptionToken;
        const customerId = data.customerId;
        const expiry = data.subscriptionExpiry;
        
        if (!customerId) {
            const newCustomerId = 'cust_' + Math.random().toString(36).substring(2, 15);
            chrome.storage.sync.set({ 'customerId': newCustomerId });
        }
        
        if (token && expiry && new Date(expiry) > new Date()) {
            try {
                const response = await fetch('https://paid-email-finder-o7ey-i2arq6e68-joshuas-projects-e1236601.vercel.app/api/verify-token', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                const result = await response.json();
                
                if (result.valid) {
                    enablePremiumFeatures();
                } else {
                    disablePremiumFeatures();
                }
            } catch (error) {
                console.error('Verification error:', error);
                disablePremiumFeatures();
            }
        } else {
            disablePremiumFeatures();
        }
    });
  }
  
  function enablePremiumFeatures() {
    document.getElementById('subscription-status').textContent = 'Premium';
    document.getElementById('subscription-status').className = 'status-badge status-premium';
    
    const premiumButton = document.getElementById('crawl-premium');
    if (premiumButton) {
        premiumButton.disabled = false;
        premiumButton.classList.remove('disabled');
        
        premiumButton.addEventListener('click', findEmailsPremium);
    }
    
    const premiumFeatures = document.getElementsByClassName('premium-feature');
    for (let i = 0; i < premiumFeatures.length; i++) {
        premiumFeatures[i].style.display = 'block';
    }
    
    document.getElementById('subscribe-button').style.display = 'none';
    
    chrome.storage.sync.get(['subscriptionExpiry'], function(data) {
        if (data.subscriptionExpiry) {
            const expiryDate = new Date(data.subscriptionExpiry);
            const expiryFormatted = expiryDate.toLocaleDateString();
            
            const subInfoElem = document.createElement('div');
            subInfoElem.id = 'subscription-info';
            subInfoElem.innerHTML = `Premium subscription active until ${expiryFormatted}`;
            subInfoElem.className = 'subscription-info';
            
            const statusElem = document.getElementById('subscription-status');
            statusElem.parentNode.insertBefore(subInfoElem, statusElem.nextSibling);
        }
    });
  }
  
  function disablePremiumFeatures() {
    document.getElementById('subscription-status').textContent = 'Free';
    document.getElementById('subscription-status').className = 'status-badge status-free';
    
    const premiumButton = document.getElementById('crawl-premium');
    if (premiumButton) {
        premiumButton.disabled = true;
        premiumButton.classList.add('disabled');
        
        premiumButton.replaceWith(premiumButton.cloneNode(true));
    }
    
    document.getElementById('subscribe-button').style.display = 'block';
    
    const subInfoElem = document.getElementById('subscription-info');
    if (subInfoElem) {
        subInfoElem.remove();
    }
  }
  
  function openSubscribePage() {
      chrome.storage.sync.get(['customerId'], function(data) {
          let customerId = data.customerId;
          
          if (!customerId) {
              customerId = 'cust_' + Math.random().toString(36).substring(2, 15);
              chrome.storage.sync.set({ 'customerId': customerId });
          }
          
          // Open the payment page on Vercel instead of a local HTML file
          chrome.tabs.create({ 
              url: `https://paid-email-finder-o7ey.vercel.app/payment.html?customerId=${customerId}`
          });
          
          // Inform background script to start checking for subscription
          chrome.runtime.sendMessage({
              action: "subscribe_initiated",
              customerId: customerId
          });
      });
  }
  
  chrome.runtime.onMessage.addListener(function(message) {
      if (message.action === "subscription_updated") {
          checkSubscriptionStatus();
      }
  });
  
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
  
  function findEmailsOnPage() {
    const bodyText = document.body.innerText;
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  
    const emails = bodyText.match(emailPattern) || [];
    const uniqueEmails = [...new Set(emails)];
  
    return uniqueEmails;
  }
  
  function findEmailsPremium() {
    chrome.storage.sync.get(['subscriptionToken'], function(data) {
        if (!data.subscriptionToken) {
            alert('Premium subscription required');
            return;
        }
  
        document.getElementById('results').innerHTML = '<p>Crawling website for emails (Premium)...</p>';
  
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const currentTab = tabs[0];
            try {
                chrome.scripting.executeScript({
                    target: { tabId: currentTab.id },
                    function: () => {
                        return { started: true };
                    }
                }, () => {
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
  
  function crawlDomain() {
    const visitedLinks = new Set();
    const emailsWithContext = [];
    const uniqueEmails = new Set();
    const maxPagesToVisit = 50;
    let pagesVisited = 0;
    
    const currentUrl = window.location.href;
    const domainPattern = /^(https?:\/\/[^/]+)/i;
    const domainMatch = currentUrl.match(domainPattern);
    const baseDomain = domainMatch ? domainMatch[1] : '';
    
    function isSameDomain(url) {
        return url.startsWith(baseDomain);
    }
    
    function getLinksOnPage() {
        return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
    }
    
    function extractEmailsWithContext(html, bodyText) {
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
    }
    
    function processCurrentPage() {
        visitedLinks.add(currentUrl);
        pagesVisited++;
        
        const html = document.documentElement.innerHTML;
        const bodyText = document.body.innerText;
        
        extractEmailsWithContext(html, bodyText);
        
        const links = getLinksOnPage();
        
        const linkQueue = [];
        for (const link of links) {
            if (!visitedLinks.has(link) && isSameDomain(link)) {
                linkQueue.push(link);
            }
        }
        
        async function processLink(link) {
            if (visitedLinks.has(link) || !isSameDomain(link)) {
                return;
            }
            
            visitedLinks.add(link);
            pagesVisited++;
            
            try {
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
                
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                const scriptsAndStyles = doc.querySelectorAll('script, style');
                scriptsAndStyles.forEach(el => el.remove());
                
                const bodyText = doc.body ? doc.body.textContent : '';
                
                extractEmailsWithContext(html, bodyText);
                
                const newLinks = Array.from(doc.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => href && href.startsWith('http') && !visitedLinks.has(href) && isSameDomain(href));
                
                for (const newLink of newLinks) {
                    if (!linkQueue.includes(newLink)) {
                        linkQueue.push(newLink);
                    }
                }
            } catch (error) {
                console.log(`Error processing ${link}: ${error.message}`);
            }
        }
        
        return linkQueue.reduce((promise, link) => {
            return promise.then(() => {
                if (pagesVisited < maxPagesToVisit) {
                    return processLink(link);
                }
            });
        }, Promise.resolve());
    }
    
    return processCurrentPage().then(() => {
        return emailsWithContext;
    });
  }
  
  function copyToClipboard(data) {
    if (Array.isArray(data)) {
        if (data.length > 0 && Array.isArray(data[0])) {
            const formattedData = data.map(pair => pair.join("\t")).join("\n");
            navigator.clipboard.writeText(formattedData).then(() => {
                alert(`Copied ${data.length} emails to clipboard!`);
            }).catch(err => {
                alert("Failed to copy: " + err);
            });
        } else {
            navigator.clipboard.writeText(data.join("\n")).then(() => {
                alert(`Copied ${data.length} emails to clipboard!`);
            }).catch(err => {
                alert("Failed to copy: " + err);
            });
        }
    } else if (typeof data === 'string') {
        navigator.clipboard.writeText(data).then(() => {
            alert("Copied to clipboard!");
        }).catch(err => {
            alert("Failed to copy: " + err);
        });
    }
  }
  
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