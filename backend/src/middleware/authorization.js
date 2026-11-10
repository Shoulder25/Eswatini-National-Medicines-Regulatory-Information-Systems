const {
  BOARD_POSITION_CODES,
  PERMISSION_CODES,
  ROLE_CODES,
} = require('../config/roles');

function authorizationFailure(req, res, status, code, message) {
  return res.status(status).json({
    error: { code, message },
    requestId: req.requestId,
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return authorizationFailure(req, res, 401, 'UNAUTHENTICATED', 'Authentication is required');
    }

    const adminTesterHasAdminRole =
      req.user.role === ROLE_CODES.ADMIN_TESTER && roles.includes(ROLE_CODES.ADMIN);
    if (!roles.includes(req.user.role) && !adminTesterHasAdminRole) {
      return authorizationFailure(req, res, 403, 'FORBIDDEN', 'Caller lacks the required role');
    }

    return next();
  };
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return authorizationFailure(req, res, 401, 'UNAUTHENTICATED', 'Authentication is required');
    }

    if (
      !Array.isArray(req.user.permissions) ||
      !permissions.some((permission) => req.user.permissions.includes(permission))
    ) {
      return authorizationFailure(req, res, 403, 'FORBIDDEN', 'Caller lacks the required permission');
    }

    return next();
  };
}

function requireBoardOfficer(req, res, next) {
  return requirePermission(PERMISSION_CODES.APPROVE_ADMIN_REPLACEMENT)(req, res, () => {
    if (
      req.user.roleCode !== ROLE_CODES.OFFICER ||
      !BOARD_POSITION_CODES.includes(req.user.officerPosition)
    ) {
      return authorizationFailure(req, res, 403, 'FORBIDDEN', 'An active Board Officer account is required');
    }
    return next();
  });
}

module.exports = { requireBoardOfficer, requirePermission, requireRole };
