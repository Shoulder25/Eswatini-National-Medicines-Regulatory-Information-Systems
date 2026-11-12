require('dotenv').config();

const pool = require('./config/database');
const { createApp } = require('./app');
const { enforceAdminTesterStartupPolicy } = require('./services/admin-tester-policy');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

let server;

async function start() {
  try {
    await enforceAdminTesterStartupPolicy(pool);
  } catch (error) {
    console.error(
      `Startup aborted: could not enforce the ADMIN_TESTER safety policy. Verify database migrations are applied. (${error.code || error.name})`,
    );
    await pool.end().catch((closeError) => {
      console.error('Failed to close MySQL pool after startup failure:', closeError.name);
    });
    process.exitCode = 1;
    return;
  }

  server = createApp({ database: pool }).listen(port, () => {
    console.log(`eNMRIS API listening on port ${port}`);
  });
  server.on('error', (error) => {
    console.error(`API server failed to start: ${error.message}`);
    pool.end().catch((closeError) => {
      console.error('Failed to close MySQL pool after server failure:', closeError.name);
    });
    process.exitCode = 1;
  });
}

function shutdown() {
  if (!server) {
    pool.end().catch((error) => {
      console.error('Failed to close MySQL pool:', error.name);
      process.exitCode = 1;
    });
    return;
  }
  server.close(() => {
    pool.end().catch((error) => {
      console.error('Failed to close MySQL pool:', error.name);
      process.exitCode = 1;
    });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
start();
