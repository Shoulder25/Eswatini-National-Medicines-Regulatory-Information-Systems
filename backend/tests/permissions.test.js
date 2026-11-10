const assert = require('node:assert/strict');
const test = require('node:test');
const { getEffectivePermissions } = require('../src/services/permissions');
const { PERMISSION_CODES } = require('../src/config/roles');

test('effective permissions combine account-role and position-role grants', async () => {
  let parameters;
  const connection = {
    async execute(sql, values) {
      assert.match(sql, /role_permissions/);
      assert.match(sql, /r\.active = TRUE/);
      assert.match(sql, /app_user_permissions/);
      assert.match(sql, /permission_code NOT IN/);
      parameters = values;
      return [[
        { permission_code: 'invite_admin' },
        { permission_code: 'start_replacement' },
      ], []];
    },
  };

  const permissions = await getEffectivePermissions(connection, {
    userId: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
    roleCode: 'HEAD_OF_IT',
    positionCode: 'BOARD_CHAIR',
  });

  assert.deepEqual(parameters, [
    'HEAD_OF_IT',
    'BOARD_CHAIR',
    '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
    ...Object.values(PERMISSION_CODES),
  ]);
  assert.deepEqual(permissions, ['invite_admin', 'start_replacement']);
});
