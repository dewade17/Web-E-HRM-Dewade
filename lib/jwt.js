import jwt from 'jsonwebtoken';

export function signAuthToken(payload, opts = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d', ...opts });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
