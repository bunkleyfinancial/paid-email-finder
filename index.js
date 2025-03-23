const express = require('express');
const mongoose = require('mongoose');
const { Client, Environment } = require('square');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Improved CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['chrome-extension://*', 'https://paid-email-finder-o7ey.vercel.app'] 
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// Serve static files (for other static assets if needed)
// app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_ENVIRONMENT = process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Production;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const squareClient = new Client({
  accessToken: SQUARE_ACCESS_TOKEN,
  environment: SQUARE_ENVIRONMENT
});

const SubscriptionSchema = new mongoose.Schema({
  customerId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['active', 'expired', 'canceled'], default: 'active' },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  paymentHistory: [{ 
    paymentId: String,
    amount: Number,
    date: { type: Date, default: Date.now }
  }]
});

const Subscription = mongoose.model('Subscription', SubscriptionSchema);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

async function createOrUpdateSubscription(customerId, paymentId, amount) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  
  try {
    const subscription = await Subscription.findOneAndUpdate(
      { customerId },
      { 
        status: 'active',
        endDate
      },
      { upsert: true, new: true }
    );
    
    subscription.paymentHistory.push({
      paymentId,
      amount,
      date: new Date()
    });
    
    await subscription.save();
    return subscription;
  } catch (error) {
    console.error('Subscription error:', error);
    throw error;
  }
}

function generateAuthToken(customerId) {
  return jwt.sign({ customerId }, JWT_SECRET, { expiresIn: '30d' });
}

app.post('/api/process-payment', async (req, res) => {
  // Add timeout handling for the payment process
  const timeoutDuration = 25000; // 25 seconds
  const timeoutId = setTimeout(() => {
    console.log('Payment request timed out after', timeoutDuration, 'ms');
    return res.status(504).json({
      success: false,
      error: 'Request timed out - the payment service took too long to respond'
    });
  }, timeoutDuration);

  const { sourceId, customerId, amount } = req.body;
  
  if (!sourceId || !customerId || !amount) {
    clearTimeout(timeoutId); // Clear timeout on early return
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters' 
    });
  }
  
  try {
    const paymentsApi = squareClient.paymentsApi;
    const response = await paymentsApi.createPayment({
      sourceId: sourceId,
      idempotencyKey: `${customerId}-${Date.now()}`,
      amountMoney: {
        amount: parseInt(amount),
        currency: 'USD'
      },
      customerId: customerId,
      locationId: SQUARE_LOCATION_ID,
      note: 'Chrome Extension Subscription'
    });
    
    const paymentId = response.result.payment.id;
    
    const subscription = await createOrUpdateSubscription(
      customerId, 
      paymentId, 
      parseInt(amount)
    );
    
    const token = generateAuthToken(customerId);
    
    clearTimeout(timeoutId); // Clear timeout on success
    res.status(200).json({
      success: true,
      paymentId: paymentId,
      token: token,
      expiresAt: subscription.endDate
    });
  } catch (error) {
    clearTimeout(timeoutId); // Clear timeout on error
    console.error('Payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Payment processing failed'
    });
  }
});

app.get('/api/verify-subscription/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const subscription = await Subscription.findOne({ customerId });
    
    if (!subscription) {
      return res.status(404).json({ subscribed: false });
    }
    
    const isActive = subscription.status === 'active' && 
                    new Date(subscription.endDate) > new Date();
    
    let token = null;
    if (isActive) {
      token = generateAuthToken(customerId);
    }
    
    res.status(200).json({
      subscribed: isActive,
      expiresAt: subscription.endDate,
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.status(200).json({ 
    valid: true,
    user: { customerId: req.user.customerId }
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Direct route for payment.html with embedded HTML
app.get('/payment.html', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Subscribe to Premium</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f9f9f9;
      color: #333;
    }
    
    .container {
      max-width: 600px;
      margin: 30px auto;
      padding: 30px;
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    h1 {
      margin-top: 0;
      color: #333;
      text-align: center;
    }
    
    .pricing {
      text-align: center;
      margin: 30px 0;
      padding: 20px;
      background-color: #f5f5f5;
      border-radius: 8px;
    }
    
    .price {
      font-size: 28px;
      font-weight: bold;
      color: #333;
    }
    
    .period {
      font-size: 14px;
      color: #666;
    }
    
    .features {
      margin: 20px 0;
    }
    
    .features ul {
      padding-left: 20px;
    }
    
    .features li {
      margin-bottom: 8px;
    }
    
    #payment-form {
      margin-top: 30px;
    }
    
    #card-container {
      min-height: 140px;
      margin-bottom: 20px;
      border: 1px solid #ddd;
      padding: 12px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) inset;
      background-color: #fff;
    }
    
    #payment-status {
      text-align: center;
      margin: 10px 0;
      font-weight: bold;
      min-height: 20px;
    }
    
    #submit-button {
      width: 100%;
      padding: 12px;
      background-color: #4285f4;
      color: white;
      font-weight: bold;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    
    #submit-button:hover {
      background-color: #3367d6;
    }
    
    #success-message {
      display: none;
      text-align: center;
      padding: 20px;
      background-color: #e6f4ea;
      border-radius: 4px;
      margin-top: 20px;
    }
    
    .back-link {
      display: block;
      text-align: center;
      margin-top: 20px;
      color: #4285f4;
      text-decoration: none;
    }
    
    .back-link:hover {
      text-decoration: underline;
    }
    
    .button {
      display: block;
      width: 100%;
      padding: 10px;
      margin: 20px 0 10px;
      border: none;
      border-radius: 4px;
      background-color: #4285f4;
      color: white;
      font-weight: bold;
      cursor: pointer;
      text-align: center;
    }
    
    .button:hover {
      background-color: #3367d6;
    }

    .error-message {
      color: #d32f2f;
      background-color: #ffebee;
      padding: 10px;
      border-radius: 4px;
      margin: 10px 0;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Access Premium Features</h1>
    
    <div class="pricing">
      <div class="price">$7.00</div>
      <div class="period">per month</div>
    </div>
    
    <div class="features">
      <h3>Premium Features:</h3>
      <ul>
        <li>Find ALL emails across the website</li>
        <li>Find context like name & title (limited)</li>
        <li>Scan up to 50 pages in the Site Tree</li>
        <li>Copy in a spreadsheet format</li>
        <li>Quickly Visualize your prospects</li>
      </ul>
    </div>
    
    <div id="error-message" class="error-message"></div>
    
    <form id="payment-form">
      <div id="card-container"></div>
      <button id="submit-button" type="submit">Pay Now</button>
      <div id="payment-status"></div>
    </form>
    
    <div id="success-message">
      <h2>Thank you for subscribing!</h2>
      <p>Your premium access has been activated.</p>
      <p>You can now close this tab and return to the extension.</p>
    </div>
    
    <a href="#" id="back-link" class="back-link">Cancel and go back</a>
  </div>
  
  <!-- Load Square Web Payments SDK -->
  <script src="https://web.squarecdn.com/v1/square.js"></script>
  <script>
    // Extract customerID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const customerId = urlParams.get('customerId') || 'unknown_customer';
    
    // Configuration variables
    // Note: In production, these values should be loaded from environment variables through a server endpoint
    const appId = 'sq0idp-lIyL_advCVL9hAxPjtrMYw';
    const locationId = 'L83T5AER8G0H8';
    
    document.getElementById('back-link').addEventListener('click', function(e) {
      e.preventDefault();
      window.close();
    });
    
    async function initializePaymentForm() {
      if (!window.Square) {
        showError('Square.js failed to load. Please refresh the page and try again.');
        return;
      }
      
      const payments = window.Square.payments(appId, locationId);
      
      try {
        const card = await payments.card();
        await card.attach('#card-container');
        
        const form = document.getElementById('payment-form');
        
        form.addEventListener('submit', async function(event) {
          event.preventDefault();
          
          try {
            document.getElementById('payment-status').textContent = 'Processing payment...';
            document.getElementById('submit-button').disabled = true;
            hideError();
            
            const tokenResult = await card.tokenize();
            
            if (tokenResult.status === 'OK') {
              // Send token to server for processing
              const response = await fetch('/api/process-payment', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  sourceId: tokenResult.token,
                  customerId: customerId,
                  amount: 700 // in cents ($7.00/mo)
                })
              });
              
              if (!response.ok) {
                throw new Error(\`Payment processing failed with status: \${response.status}\`);
              }
              
              const result = await response.json();
              
              if (result.success) {
                document.getElementById('payment-status').textContent = 'Payment successful!';
                document.getElementById('payment-form').style.display = 'none';
                document.getElementById('success-message').style.display = 'block';
                
                // Store subscription info for the extension to find
                localStorage.setItem('crawlSpaceSubscription', JSON.stringify({
                  token: result.token,
                  status: true,
                  expiresAt: result.expiresAt,
                  customerId: customerId
                }));
                
                // Add a return button
                const returnButton = document.createElement('button');
                returnButton.textContent = 'Return to Extension';
                returnButton.className = 'button';
                returnButton.onclick = function() {
                  window.close();
                };
                document.getElementById('success-message').appendChild(returnButton);
              } else {
                showError(result.error || 'Unknown payment error');
                document.getElementById('submit-button').disabled = false;
              }
            } else {
              showError(tokenResult.errors[0].message || 'Card tokenization failed');
              document.getElementById('submit-button').disabled = false;
            }
          } catch (e) {
            console.error('Payment error:', e);
            showError(e.message || 'Payment processing error');
            document.getElementById('submit-button').disabled = false;
          }
        });
      } catch (e) {
        console.error('Square initialization error:', e);
        showError('Could not initialize payment form: ' + e.message);
      }
    }
    
    function showError(message) {
      const errorElement = document.getElementById('error-message');
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      document.getElementById('payment-status').textContent = '';
    }
    
    function hideError() {
      const errorElement = document.getElementById('error-message');
      errorElement.textContent = '';
      errorElement.style.display = 'none';
    }
    
    document.addEventListener('DOMContentLoaded', function() {
      initializePaymentForm();
    });
  </script>
</body>
</html>`);
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;