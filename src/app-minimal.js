const express = require('express');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const inboxRoutes = require('./routes/inbox/inboxRoutes.js');

const app = express();

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: 'development-secret',
  name: 'expense.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Routes
app.get('/', (req, res) => {
  res.redirect('/inbox');
});

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

app.use('/inbox', inboxRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = app;
