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

    if (!roles.includes(req.user.role)) {
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

module.exports = { requirePermission, requireRole };
