require('dotenv').config();

const pool = require('./config/database');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const server = createApp({ database: pool }).listen(port, () => {
  console.log(`eNMRIS API listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    pool.end().catch((error) => {
      console.error('Failed to close MySQL pool:', error.name);
      process.exitCode = 1;
    });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
