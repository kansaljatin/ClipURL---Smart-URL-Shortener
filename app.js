const express = require('express');
const path = require('path');
const morgan = require('morgan')
const cors = require('cors')
const urlRoutes = require('./routes/urlRoutes');
const dotenv = require('dotenv')
dotenv.config()

const app = express();

// Middleware
app.use(express.json());
app.use(cors())
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'))
app.use(express.static(path.join(__dirname, 'public')));

// Routes (API + redirect)
app.use(urlRoutes);

module.exports = app;
