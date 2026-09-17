import Redis, { ChainableCommander } from 'ioredis';
import { IDraft, IDraftMeta } from '../service/comparator/types';

type PipelineResults = [Error | null, unknown][] | null;

export default class RedisStorage {

    public constructor(
        private readonly redis: Redis,
    ) {
    }

    public async lock(masterKey: string): Promise<void> {
        const lockKey = this.getLockKey(masterKey);
        const isLocked = await this.redis.get(lockKey);

        if (isLocked !== null) {
            throw new Error(`Master key ${masterKey} is already locked.`);
        }

        await this.redis.set(lockKey, '1', 'EX', 60 * 5);
    }

    public async unlock(masterKey: string): Promise<void> {
        await this.redis.del(this.getLockKey(masterKey));
    }

    public async getValues(masterKey: string, ids: string[]): Promise<(string|null)[]> {
        return this.redis.hmget(masterKey, ...ids);
    }

    public async getKeys(masterKey: string): Promise<string[]> {
        return this.redis.hkeys(masterKey);
    }

    public async getCount(masterKey: string): Promise<number> {
        return this.redis.hlen(masterKey);
    }

    public async delete(masterKey: string, externalId?: string): Promise<number> {
        if (externalId) {
            return this.redis.hdel(masterKey, externalId);
        }

        return this.redis.del(masterKey);
    }

    public hmSet(pipeline: ChainableCommander, masterKey: string, values: string[], ttl?: number): void {
        pipeline.hmset(masterKey, ...values);

        if (ttl) {
            pipeline.expire(masterKey, ttl);
        }
    }

    public getPipeline(): ChainableCommander {
        return this.redis.pipeline();
    }

    public async saveDraft(draftId: string, draft: IDraft, ttl: number): Promise<void> {
        const { items, deleted, ...meta } = draft;
        const itemsKey = this.getDraftItemsKey(draftId);
        const deletedKey = this.getDraftDeletedKey(draftId);
        const flatItems = Object.entries(items).flat();

        const transaction = this.redis.multi();
        transaction.set(this.getDraftKey(draftId), JSON.stringify(meta), 'EX', ttl);

        if (flatItems.length > 0) {
            transaction.hset(itemsKey, ...flatItems);
            transaction.expire(itemsKey, ttl);
        }

        if (deleted.length > 0) {
            transaction.sadd(deletedKey, ...deleted);
            transaction.expire(deletedKey, ttl);
        }

        this.unwrap(await transaction.exec());
    }

    public async getDraftMeta(draftId: string): Promise<IDraftMeta | null> {
        const meta = await this.redis.get(this.getDraftKey(draftId));

        return meta === null ? null : JSON.parse(meta) as IDraftMeta;
    }

    public async getDraft(draftId: string): Promise<IDraft | null> {
        const results = await this.redis.pipeline()
            .get(this.getDraftKey(draftId))
            .hgetall(this.getDraftItemsKey(draftId))
            .smembers(this.getDraftDeletedKey(draftId))
            .exec();
        const [meta, items, deleted] = this.unwrap(results) as [string | null, Record<string, string>, string[]];

        return meta === null ? null : { ...JSON.parse(meta) as IDraftMeta, items, deleted };
    }

    public async confirmDraft(draftId: string, draft: IDraft): Promise<void> {
        const transaction = this.redis.multi();
        const items = Object.entries(draft.items).flat();

        if (items.length > 0) {
            this.hmSet(transaction, draft.masterKey, items, draft.ttl);
        }

        if (draft.deleted.length > 0) {
            transaction.hdel(draft.masterKey, ...draft.deleted);
        }

        transaction.del(this.getDraftKey(draftId), this.getDraftItemsKey(draftId), this.getDraftDeletedKey(draftId));
        this.unwrap(await transaction.exec());
    }

    public async confirmDraftItem(draftId: string, itemId: string): Promise<void> {
        const meta = await this.getDraftMeta(draftId);

        if (meta === null) {
            return;
        }

        const itemsKey = this.getDraftItemsKey(draftId);
        const deletedKey = this.getDraftDeletedKey(draftId);
        const hash = await this.redis.hget(itemsKey, itemId);
        const isDeleted = hash === null && await this.redis.sismember(deletedKey, itemId) === 1;

        if (hash === null && !isDeleted) {
            return;
        }

        const transaction = this.redis.multi();

        if (hash !== null) {
            this.hmSet(transaction, meta.masterKey, [itemId, hash], meta.ttl);
            transaction.hdel(itemsKey, itemId);
        } else {
            transaction.hdel(meta.masterKey, itemId);
            transaction.srem(deletedKey, itemId);
        }

        transaction.hlen(itemsKey);
        transaction.scard(deletedKey);

        const [remainingItems, remainingDeleted] = this.unwrap(await transaction.exec()).slice(-2) as [number, number];

        if (remainingItems + remainingDeleted === 0) {
            await this.redis.del(this.getDraftKey(draftId));
        }
    }

    public getLockKey(masterKey: string): string {
        return `${masterKey}-lock`;
    }

    public getBufferKey(correlationId: string): string {
        return `${correlationId}-buffer`;
    }

    public getDraftKey(draftId: string): string {
        return `${draftId}-draft`;
    }

    public getDraftItemsKey(draftId: string): string {
        return `${draftId}-draft-items`;
    }

    public getDraftDeletedKey(draftId: string): string {
        return `${draftId}-draft-deleted`;
    }

    private unwrap(results: PipelineResults): unknown[] {
        const error = results?.find(([e]) => e !== null)?.[0];

        if (error) {
            throw error;
        }

        return (results ?? []).map(([, value]) => value);
    }

}
