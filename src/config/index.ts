import { getEnv } from '@orchesty/nodejs-sdk/dist/lib/Config/Config';

const redis = {
    dsn: getEnv('REDIS_DSN'),
};

export default {
    redis,
};
