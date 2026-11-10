const crypto = require('node:crypto');
const { ROLE_CODES } = require('../config/roles');

async function writeAudit(connection, {
  actorId = null,
  actorType = actorId ? 'USER' : 'SYSTEM',
  action,
  entityName,
  recordId = null,
  beforeValue = null,
  afterValue = null,
  reason = null,
  requestId = null,
}) {
  let actorRoleCode = actorType === 'CLIENT' ? ROLE_CODES.CLIENT : ROLE_CODES.SYSTEM;
  let actorRoleLabel;
  if (actorType === 'USER') {
    if (!actorId) {
      throw new Error('Cannot audit a user action without an actor ID');
    }
    const [actorRoles] = await connection.execute(
      `SELECT COALESCE(position_role.role_code, account_role.role_code) AS role_code,
              COALESCE(position_role.display_label, account_role.display_label) AS display_label
       FROM app_users u
       JOIN roles account_role ON account_role.role_code = u.role_code
       LEFT JOIN roles position_role ON position_role.role_code = u.officer_position
       WHERE u.id = ?`,
      [actorId],
    );
    if (!Array.isArray(actorRoles) || !actorRoles.length) {
      throw new Error('Cannot audit a user action without its current role snapshot');
    }
    actorRoleCode = actorRoles[0].role_code;
    actorRoleLabel = actorRoles[0].display_label;
  } else {
    const [actorRoles] = await connection.execute(
      'SELECT display_label FROM roles WHERE role_code = ?',
      [actorRoleCode],
    );
    if (!Array.isArray(actorRoles) || !actorRoles.length) {
      throw new Error('Cannot audit this action without its current role snapshot');
    }
    actorRoleLabel = actorRoles[0].display_label;
  }

  await connection.execute(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, actor_role_code, actor_role_label,
        action, entity_name, record_id,
        before_value, after_value, reason, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      actorType,
      actorId,
      actorRoleCode,
      actorRoleLabel,
      action,
      entityName,
      recordId,
      beforeValue === null ? null : JSON.stringify(beforeValue),
      afterValue === null ? null : JSON.stringify(afterValue),
      reason,
      requestId,
    ],
  );
}

module.exports = { writeAudit };
