const { createClient } = require('redis');

let client;

async function connectRedis() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  const password = process.env.REDIS_PASSWORD || undefined;

  client = url
    ? createClient({ url })
    : createClient({
        socket: { host, port },
        password,
      });

  client.on('error', (err) => {
    console.error('Redis client error:', err);
  });

  await client.connect();
  console.log('Redis connected');

  return client;
}

function getRedisClient() {
  return client;
}

module.exports = {
  connectRedis,
  getRedisClient,
};
