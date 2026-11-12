const { runAdminTesterOperation } = require('./admin-tester-operation');

runAdminTesterOperation('convert').catch((error) => {
  console.error(`ADMIN_TESTER conversion failed: ${error.message}`);
  process.exitCode = 1;
});
