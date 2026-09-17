import { container } from '@orchesty/nodejs-sdk';
import Redis from 'ioredis';
import { REDIS_SERVICE_NAME } from '../../../src';
import { IDraft } from '../../../src/service/comparator';
import RedisStorage from '../../../src/storage/RedisStorage';

let redisStorage: RedisStorage;
let redis: Redis;

async function insertData(key: string): Promise<void> {
    const pipeline = redisStorage.getPipeline();
    const dataToStore = ['id1', 'hash1', 'id2', 'hash2', 'id3', 'hash3'];
    redisStorage.hmSet(pipeline, key, dataToStore);
    await pipeline.exec();
}

describe('RedisStorage', () => {
    beforeAll(() => {
        redis = container.getNamed(REDIS_SERVICE_NAME);
        redisStorage = container.get(RedisStorage);
    });

    it('lock', async () => {
        await redisStorage.lock('test');
        const isLocked = await redis.get('test-lock');

        expect(isLocked).toBe('1');
    });

    it('lock - already locked', async () => {
        await redisStorage.lock('test');

        try {
            await redisStorage.lock('test');
        } catch (err: unknown) {
            expect((err as Error).message).toBe('Master key test is already locked.');
        }
    });

    it('unlock', async () => {
        await redisStorage.lock('test');
        await redisStorage.unlock('test');

        const isLocked = await redis.get('test-lock');

        expect(isLocked).toBe(null);
    });

    it('getValues', async () => {
        await insertData('testVal');
        const res = await redisStorage.getValues('testVal', ['id1', 'id_non_exists', 'id3', 'id4']);

        expect(res).toStrictEqual(
            ['hash1', null, 'hash3', null],
        );
    });

    it('getKeys', async () => {
        await insertData('testKey');
        const res = await redisStorage.getKeys('testKey');

        expect(res).toStrictEqual(
            ['id1', 'id2', 'id3'],
        );
    });

    it('getCount', async () => {
        await insertData('testCount');
        const res = await redisStorage.getCount('testCount');

        expect(res).toBe(3);
    });

    it('delete - masterKey', async () => {
        const key = 'testDeleteMaster';
        await insertData(key);
        await redisStorage.delete(key);

        const exists = await redis.get(key);

        expect(exists).toBe(null);
    });

    it('delete - externalId', async () => {
        const key = 'testDeleteExternalId';
        await insertData(key);
        await redisStorage.delete(key, 'id2');

        const count = await redisStorage.getCount(key);

        expect(count).toBe(2);
    });

    it('saveDraft & getDraft', async () => {
        const draft: IDraft = { masterKey: 'draftMaster', idField: 'id', ttl: 120, items: { id1: 'hash1' }, deleted: ['id2'] };
        await redisStorage.saveDraft('draft-1', draft, 60);

        const stored = await redisStorage.getDraft('draft-1');
        const ttls = await Promise.all([
            redis.ttl(redisStorage.getDraftKey('draft-1')),
            redis.ttl(redisStorage.getDraftItemsKey('draft-1')),
            redis.ttl(redisStorage.getDraftDeletedKey('draft-1')),
        ]);

        expect(stored).toStrictEqual(draft);
        expect(ttls.every((ttl) => ttl > 0)).toBe(true);
    });

    it('getDraftMeta', async () => {
        const draft: IDraft = { masterKey: 'metaMaster', idField: 'id', ttl: 120, items: { id1: 'hash1' }, deleted: [] };
        await redisStorage.saveDraft('draft-meta', draft, 60);

        const meta = await redisStorage.getDraftMeta('draft-meta');
        const missing = await redisStorage.getDraftMeta('missing');

        expect(meta).toStrictEqual({ masterKey: 'metaMaster', idField: 'id', ttl: 120 });
        expect(missing).toBeNull();
    });

    it('getDraft - missing', async () => {
        const stored = await redisStorage.getDraft('missing');

        expect(stored).toBeNull();
    });

    it('confirmDraft', async () => {
        const key = 'testConfirmDraft';
        await insertData(key);
        const draft: IDraft = { masterKey: key, idField: 'id', ttl: 120, items: { id1: 'hash1new', id4: 'hash4' }, deleted: ['id2'] };
        await redisStorage.saveDraft('draft-2', draft, 60);

        await redisStorage.confirmDraft('draft-2', draft);

        const values = await redisStorage.getValues(key, ['id1', 'id2', 'id3', 'id4']);
        const ttl = await redis.ttl(key);
        const stored = await redisStorage.getDraft('draft-2');
        const draftKeys = await redis.keys('draft-2-draft*');

        expect(values).toStrictEqual(['hash1new', null, 'hash3', 'hash4']);
        expect(ttl).toBeGreaterThan(0);
        expect(stored).toBeNull();
        expect(draftKeys).toStrictEqual([]);
    });

    it('confirmDraftItem - item', async () => {
        const key = 'testConfirmItem';
        await insertData(key);
        const draft: IDraft = { masterKey: key, idField: 'id', ttl: 120, items: { id1: 'hash1new', id4: 'hash4' }, deleted: ['id2'] };
        await redisStorage.saveDraft('draft-3', draft, 60);

        await redisStorage.confirmDraftItem('draft-3', 'id4');

        const values = await redisStorage.getValues(key, ['id1', 'id2', 'id3', 'id4']);
        const ttl = await redis.ttl(key);
        const stored = await redisStorage.getDraft('draft-3');

        expect(values).toStrictEqual(['hash1', 'hash2', 'hash3', 'hash4']);
        expect(ttl).toBeGreaterThan(0);
        expect(stored).toStrictEqual({ ...draft, items: { id1: 'hash1new' } });
    });

    it('confirmDraftItem - deleted', async () => {
        const key = 'testConfirmDeleted';
        await insertData(key);
        const draft: IDraft = { masterKey: key, idField: 'id', items: { id4: 'hash4' }, deleted: ['id2'] };
        await redisStorage.saveDraft('draft-4', draft, 60);

        await redisStorage.confirmDraftItem('draft-4', 'id2');

        const values = await redisStorage.getValues(key, ['id1', 'id2', 'id3', 'id4']);
        const stored = await redisStorage.getDraft('draft-4');

        expect(values).toStrictEqual(['hash1', null, 'hash3', null]);
        expect(stored).toStrictEqual({ ...draft, deleted: [] });
    });

    it('confirmDraftItem - unknown item and missing draft', async () => {
        const key = 'testConfirmUnknown';
        await insertData(key);
        const draft: IDraft = { masterKey: key, idField: 'id', ttl: 120, items: { id4: 'hash4' }, deleted: [] };
        await redisStorage.saveDraft('draft-5', draft, 60);

        await redisStorage.confirmDraftItem('draft-5', 'id9');
        await redisStorage.confirmDraftItem('missing', 'id4');

        const values = await redisStorage.getValues(key, ['id1', 'id2', 'id3', 'id4', 'id9']);
        const stored = await redisStorage.getDraft('draft-5');

        expect(values).toStrictEqual(['hash1', 'hash2', 'hash3', null, null]);
        expect(stored).toStrictEqual(draft);
    });

    it('confirmDraftItem - last item removes the draft', async () => {
        const key = 'testConfirmLast';
        const draft: IDraft = { masterKey: key, idField: 'id', ttl: 120, items: { id1: 'hash1', id2: 'hash2' }, deleted: ['id3'] };
        await redisStorage.saveDraft('draft-6', draft, 60);

        await redisStorage.confirmDraftItem('draft-6', 'id1');
        const afterFirst = await redisStorage.getDraft('draft-6');
        await redisStorage.confirmDraftItem('draft-6', 'id3');
        const afterSecond = await redisStorage.getDraft('draft-6');
        await redisStorage.confirmDraftItem('draft-6', 'id2');
        const afterLast = await redisStorage.getDraft('draft-6');

        const values = await redisStorage.getValues(key, ['id1', 'id2', 'id3']);
        const draftKeys = await redis.keys('draft-6-draft*');

        expect(afterFirst).toStrictEqual({ ...draft, items: { id2: 'hash2' } });
        expect(afterSecond).toStrictEqual({ ...draft, items: { id2: 'hash2' }, deleted: [] });
        expect(afterLast).toBeNull();
        expect(values).toStrictEqual(['hash1', 'hash2', null]);
        expect(draftKeys).toStrictEqual([]);
    });
});
