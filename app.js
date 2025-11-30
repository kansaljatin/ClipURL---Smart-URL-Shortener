const express = require('express');
const path = require('path');
const urlRoutes = require('./routes/urlRoutes');
const dotenv = require('dotenv')
dotenv.config()

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes (API + redirect)
app.use(urlRoutes);

module.exports = app;
