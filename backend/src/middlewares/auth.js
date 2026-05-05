import { verifyAccessToken } from "../utils/jwt.js";
import { HttpError } from "../utils/httpError.js";

export const authenticate = (req, _res, next) => {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "Authentication required"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    return next();
  } catch {
    return next(new HttpError(401, "Invalid or expired token"));
  }
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) {
    return next(new HttpError(401, "Authentication required"));
  }

  if (!roles.includes(req.user.role)) {
    return next(new HttpError(403, "Insufficient permissions"));
  }

  return next();
};
