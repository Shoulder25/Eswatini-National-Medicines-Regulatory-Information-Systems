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

    const adminTesterHasAdminRole = req.user.role === 'ADMIN_TESTER' && roles.includes('ADMIN');
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
  const allowedPositions = ['BOARD_CHAIR', 'BOARD_VICE_CHAIR'];
  if (!req.user) {
    return authorizationFailure(req, res, 401, 'UNAUTHENTICATED', 'Authentication is required');
  }

  if (req.user.role !== 'OFFICER' || !allowedPositions.includes(req.user.officerPosition)) {
    return authorizationFailure(req, res, 403, 'FORBIDDEN', 'Board Officer approval is required');
  }

  return next();
}

module.exports = { requireBoardOfficer, requirePermission, requireRole };
