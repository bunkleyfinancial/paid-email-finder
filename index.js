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

// Serve static files (including payment.html)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_ENVIRONMENT = process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox;

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
  const { sourceId, customerId, amount } = req.body;
  
  if (!sourceId || !customerId || !amount) {
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
    
    res.status(200).json({
      success: true,
      paymentId: paymentId,
      token: token,
      expiresAt: subscription.endDate
    });
  } catch (error) {
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

// Note: payment.html is now served as a static file from the public directory

app.get('/payment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;