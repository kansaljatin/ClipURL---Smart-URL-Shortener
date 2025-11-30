const app = require('./app');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');

const PORT = process.env.PORT || 8000;

(async () => {
  try {
    await connectDB();
    await connectRedis();

    app.listen(PORT, () => {
      console.log('Server running on port', PORT);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message || err);
    process.exit(1);
  }
})();
