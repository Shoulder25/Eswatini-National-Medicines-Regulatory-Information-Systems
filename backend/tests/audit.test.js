const assert = require('node:assert/strict');
const test = require('node:test');
const { writeAudit } = require('../src/services/audit');

test('audit records the actor role code and current display-label snapshot', async () => {
  let inserted;
  const connection = {
    async execute(sql, values) {
      if (sql.includes('COALESCE(position_role.role_code')) {
        return [[{
          role_code: 'BOARD_CHAIR',
          display_label: 'Chair - current label',
        }], []];
      }
      if (sql.includes('INSERT INTO audit_log')) {
        inserted = values;
        return [{ affectedRows: 1 }, []];
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    },
  };

  await writeAudit(connection, {
    actorId: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
    action: 'TEST_ACTION',
    entityName: 'app_users',
  });

  assert.equal(inserted[3], 'BOARD_CHAIR');
  assert.equal(inserted[4], 'Chair - current label');
});
