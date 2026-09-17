import { container, expressApp, routes } from '@orchesty/nodejs-sdk';
import BatchRouter from '@orchesty/nodejs-sdk/dist/lib/Batch/BatchRouter';
import CommonLoader from '@orchesty/nodejs-sdk/dist/lib/Commons/CommonLoader';
import CustomNodeRouter from '@orchesty/nodejs-sdk/dist/lib/CustomNode/CustomNodeRouter';
import Metrics from '@orchesty/nodejs-sdk/dist/lib/Metrics/Metrics';
import DatabaseClient from '@orchesty/nodejs-sdk/dist/lib/Storage/Database/Client';
import Node from '@orchesty/nodejs-sdk/dist/lib/Storage/Database/Document/Node';
import NodeRepository from '@orchesty/nodejs-sdk/dist/lib/Storage/Database/Document/NodeRepository';
import Redis from 'ioredis';
import config from './config';
import { ComparatorConfirm } from './custom_node/ComparatorConfirm';
import { ComparatorFilter } from './custom_node/ComparatorFilter';
import { ComparatorInvalidate } from './custom_node/ComparatorInvalidate';
import { ComparatorSplit } from './custom_node/ComparatorSplit';
import { Comparator } from './service/comparator';
import RedisStorage from './storage/RedisStorage';

export const REDIS_SERVICE_NAME = 'redis';

// eslint-disable-next-line @typescript-eslint/require-await
export async function initialize(): Promise<void> {
    const redis = new Redis(config.redis.dsn);
    const redisStorage = new RedisStorage(redis);

    const loader = new CommonLoader(container);
    const databaseClient = new DatabaseClient(container);
    const comparator = new Comparator(redisStorage);

    container.set(loader);
    container.set(comparator);
    container.set(databaseClient);
    container.setNamed(REDIS_SERVICE_NAME, redis);
    container.set(redisStorage);
    container.set(new Metrics());
    container.setRepository(new NodeRepository(Node, databaseClient));

    container.setCustomNode(new ComparatorFilter(comparator, redisStorage));
    container.setCustomNode(new ComparatorInvalidate(redisStorage));
    container.setCustomNode(new ComparatorConfirm(redisStorage));
    container.setBatch(new ComparatorSplit(redisStorage));

    routes.push(new CustomNodeRouter(expressApp, loader));
    routes.push(new BatchRouter(expressApp, loader));
}
