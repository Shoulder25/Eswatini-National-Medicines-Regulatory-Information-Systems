const { runAdminTesterOperation } = require('./admin-tester-operation');

runAdminTesterOperation('deactivate').catch((error) => {
  console.error(`ADMIN_TESTER deactivation failed: ${error.message}`);
  process.exitCode = 1;
});
