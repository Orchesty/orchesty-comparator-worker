process.env.APP_ENV = 'prod';
process.env.TENANT_ID = 'docker';
process.env.CRYPT_SECRET = 'ThisIsNotSoSecret';
process.env.ORCHESTY_API_KEY = 'ThisIsNotSoSecretApiKey';

if (process.env.JEST_DOCKER) {
  process.env.REDIS_DSN = 'redis://redis:6379';
} else {
  process.env.REDIS_DSN = 'redis://127.0.0.1:6379';
}
