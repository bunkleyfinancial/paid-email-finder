const express = require('express');
const mongoose = require('mongoose');
const { Client, Environment } = require('square');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*', // In production, specify your allowed domains
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Environment variables
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_ENVIRONMENT = process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox;

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Configure Square client
const squareClient = new Client({
  accessToken: SQUARE_ACCESS_TOKEN,
  environment: SQUARE_ENVIRONMENT
});

// Subscription Schema
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

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Function to create or update a subscription
async function createOrUpdateSubscription(customerId, paymentId, amount) {
  // Calculate end date (30 days from now for monthly subscription)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  
  try {
    // Find and update or create new subscription
    const subscription = await Subscription.findOneAndUpdate(
      { customerId },
      { 
        status: 'active',
        endDate
      },
      { upsert: true, new: true }
    );
    
    // Add payment to history
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

// Generate JWT token
function generateAuthToken(customerId) {
  return jwt.sign({ customerId }, JWT_SECRET, { expiresIn: '30d' });
}

// ROUTES

// Process payment and create subscription
app.post('/api/process-payment', async (req, res) => {
  const { sourceId, customerId, amount } = req.body;
  
  if (!sourceId || !customerId || !amount) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters' 
    });
  }
  
  try {
    // Create payment with Square API
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
    
    // Payment was successful
    const paymentId = response.result.payment.id;
    
    // Create or update subscription
    const subscription = await createOrUpdateSubscription(
      customerId, 
      paymentId, 
      parseInt(amount)
    );
    
    // Generate token for client
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

// Verify subscription
app.get('/api/verify-subscription/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const subscription = await Subscription.findOne({ customerId });
    
    if (!subscription) {
      return res.status(404).json({ subscribed: false });
    }
    
    // Check if subscription is active and not expired
    const isActive = subscription.status === 'active' && 
                    new Date(subscription.endDate) > new Date();
    
    // Generate a new token if active
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

// Verify token validity
app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.status(200).json({ 
    valid: true,
    user: { customerId: req.user.customerId }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Start server if not in production (Vercel handles this automatically)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export for serverless functions
module.exports = app;