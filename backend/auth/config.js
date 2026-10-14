const COOKIE_NAME = 'taxi_token';
const TOKEN_ISSUER = 'taxi-management-api';
const TOKEN_AUDIENCE = 'taxi-management-web';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

module.exports = { COOKIE_NAME, TOKEN_ISSUER, TOKEN_AUDIENCE, getJwtSecret };
