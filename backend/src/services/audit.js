const crypto = require('node:crypto');

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
  await connection.execute(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, action, entity_name, record_id,
        before_value, after_value, reason, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      actorType,
      actorId,
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
