import { listen } from '@orchesty/nodejs-sdk';
import { initialize } from './index';

initialize()
    .then(async () => listen())
    .catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
        process.stderr.write(`${err.message}\n${err.stack ?? ''}\n`);
        process.exit(1);
    });
