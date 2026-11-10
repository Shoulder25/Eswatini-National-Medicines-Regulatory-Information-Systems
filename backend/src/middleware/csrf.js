function originIsAllowed(req) {
  const origin = req.get('origin');
  if (!origin) {
    return false;
  }

  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin) {
    return origin === configuredOrigin;
  }

  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function requireSameOrigin(req, res, next) {
  if (!originIsAllowed(req)) {
    return res.status(403).json({
      error: { code: 'CSRF_REJECTED', message: 'Request origin is not allowed' },
      requestId: req.requestId,
    });
  }
  return next();
}

module.exports = { originIsAllowed, requireSameOrigin };
