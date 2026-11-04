const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    console.log('[RBAC]', {
      method: req.method,
      url: req.originalUrl,
      userRole: req.user?.role,
      allowedRoles,
    });

    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: insufficient permissions',
      });
    }

    next();
  };
};

module.exports = { authorizeRoles };