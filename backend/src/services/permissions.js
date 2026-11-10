const { PERMISSION_CODES } = require('../config/roles');

const ROLE_MANAGED_PERMISSIONS = Object.values(PERMISSION_CODES);

async function getEffectivePermissions(connection, {
  userId,
  roleCode,
  positionCode = null,
}) {
  const [rows] = await connection.execute(
    `SELECT rp.permission_code FROM role_permissions rp
     JOIN roles r ON r.role_code = rp.role_code AND r.active = TRUE
     WHERE rp.role_code IN (?, ?)
     UNION
     SELECT permission_code FROM app_user_permissions
     WHERE user_id = ? AND revoked_at IS NULL
       AND permission_code NOT IN (${ROLE_MANAGED_PERMISSIONS.map(() => '?').join(', ')})
     ORDER BY permission_code`,
    [roleCode, positionCode || '', userId, ...ROLE_MANAGED_PERMISSIONS],
  );
  return rows.map((row) => row.permission_code);
}

module.exports = { getEffectivePermissions };
