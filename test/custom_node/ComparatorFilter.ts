import { container } from '@orchesty/nodejs-sdk';
import BatchProcessDto, { IBatchMessage } from '@orchesty/nodejs-sdk/dist/lib/Utils/BatchProcessDto';
import { RESULT_CODE } from '@orchesty/nodejs-sdk/dist/lib/Utils/Headers';
import ProcessDto from '@orchesty/nodejs-sdk/dist/lib/Utils/ProcessDto';
import ResultCode from '@orchesty/nodejs-sdk/dist/lib/Utils/ResultCode';
import NodeTester from '@orchesty/nodejs-sdk/dist/test/Testers/NodeTester';
import crypto from 'crypto';
import Redis from 'ioredis';
import { REDIS_SERVICE_NAME } from '../../src';
import { ComparatorConfirm } from '../../src/custom_node/ComparatorConfirm';
import { ComparatorFilter, NAME as COMPARATOR_FILTER } from '../../src/custom_node/ComparatorFilter';
import { ComparatorSplit, IInput as ISplitInput } from '../../src/custom_node/ComparatorSplit';
import {
    Comparator,
    DRAFT_ID_HEADER,
    HASH_ALG,
    IConfiguration,
    IInput,
    ITEM_ID_HEADER,
    ITEM_OP_HEADER,
} from '../../src/service/comparator';
import RedisStorage from '../../src/storage/RedisStorage';

let tester: NodeTester;
let redis: Redis;
let redisStorage: RedisStorage;
let node: ComparatorFilter;
let confirmNode: ComparatorConfirm;
let splitNode: ComparatorSplit;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createDto(items: Record<string, unknown>[], configuration: IConfiguration): ProcessDto<IInput> {
    const dto = new ProcessDto<IInput>();
    dto.setNewJsonData({ items, configuration });

    return dto;
}

async function confirmChild(parent: BatchProcessDto<ISplitInput>, child: IBatchMessage): Promise<ProcessDto> {
    const dto = new ProcessDto();
    dto.setHeaders({ ...parent.getHeaders() });
    Object.entries(child.headers ?? {}).forEach(([key, value]) => {
        dto.addHeader(key, String(value));
    });
    dto.setData(child.body);

    return confirmNode.processAction(dto);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function storeHash(data: any): Promise<void> {
    const hasher = crypto.createHash(HASH_ALG);
    hasher.update(JSON.stringify(data));
    const hash = hasher.digest('hex');

    const pipeline = redisStorage.getPipeline();
    const dataToStore = [String(data.id), hash];
    redisStorage.hmSet(pipeline, 'masterKey', dataToStore);
    await pipeline.exec();
}

describe('Tests for ComparatorFilter', () => {
    beforeAll(() => {
        tester = new NodeTester(container, __filename);
        redis = container.getNamed(REDIS_SERVICE_NAME);
        redisStorage = container.get(RedisStorage);
        node = new ComparatorFilter(
            container.get(Comparator),
            redisStorage,
        );
        confirmNode = new ComparatorConfirm(redisStorage);
        splitNode = new ComparatorSplit(redisStorage);
    });

    it('process - ok', async () => {
        await tester.testCustomNode(COMPARATOR_FILTER);
    });

    it('single page', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }, { id: 3 }],
            updated: [],
            deleted: [],
        });
    });

    it('single page - pass as array', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                passAsListOfExistingItems: true,
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('single page - skip comparison', async () => {
        await storeHash({ id: 1 });
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                passAsListOfExistingItems: true,
                skipComparison: true,
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual([{ id: 1 }]);
    });

    it('single page large', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }, { id: 3 }],
            updated: [],
            deleted: [],
        });
    });

    it('single page exclude', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1, exc: { innr: 1 }, a: 1 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                excludedFields: ['exc.innr'],
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1, exc: { innr: 1 }, a: 1 }],
            updated: [],
            deleted: [],
        });

        // Second run
        dto.setNewJsonData({
            items: [{ id: 1, exc: { innr: 1 }, a: 1 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                excludedFields: ['exc.innr'],
                stopOnEmptyArray: true,
            },
        });

        const result2 = await node.processAction(dto);
        const resultData2 = result2.getJsonData();

        expect(resultData2).toStrictEqual({});
        expect(result2.getHeader(RESULT_CODE)).toBe('1003');
    });

    it('single page with lock', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                lock: true,
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }],
            updated: [],
            deleted: [],
        });
    });

    it('single page locked', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }, { id: 3 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                lock: true,
            },
        });

        await redisStorage.lock('masterKey');
        const result = await node.processAction(dto);
        const resultCode = result.getHeader(RESULT_CODE, '0');

        expect(resultCode).toStrictEqual(ResultCode.REPEAT.toString());
    });

    it('single page with same (ignored)', async () => {
        await storeHash({ id: 2 });

        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }],
            updated: [],
            deleted: [],
        });
    });

    it('single page with update & delete', async () => {
        await storeHash({ id: 2, asd: 123 });
        await storeHash({ id: 3 });

        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
                isLast: true,
            },
        });

        const result = await node.processAction(dto);
        const resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }],
            updated: [{ id: 2 }],
            deleted: ['3'],
        });
    });

    it('buffered pages - creates', async () => {
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                isBuffered: true,
                isLast: false,
                totalCount: 4,
            },
        } as IInput);

        let result = await node.processAction(dto);
        let resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }],
            updated: [],
            deleted: [],
        });

        // Second (last) page
        dto.setNewJsonData({
            items: [{ id: 3 }, { id: 4 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                isBuffered: true,
                isLast: true,
                totalCount: 4,
            },
        } as IInput);

        result = await node.processAction(dto);
        resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 3 }, { id: 4 }],
            updated: [],
            deleted: [],
        });
    });

    it('buffered pages - update & delete', async () => {
        await storeHash({ id: 2, a: 1 });
        await storeHash({ id: 5 });
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
                isLast: false,
                totalCount: 4,
            },
        });

        let result = await node.processAction(dto);
        let resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }],
            updated: [{ id: 2 }],
            deleted: [],
        });

        // Second (last) page
        dto.setNewJsonData({
            items: [{ id: 3 }, { id: 4 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
                isLast: true,
                totalCount: 4,
            },
        });

        result = await node.processAction(dto);
        resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 3 }, { id: 4 }],
            updated: [],
            deleted: ['5'],
        });
    });

    it('buffered pages - out of order', async () => {
        const dto = new ProcessDto<IInput>();
        // Second (last) page
        dto.setNewJsonData({
            items: [{ id: 3 }, { id: 4 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                isBuffered: true,
                isLast: true,
                totalCount: 4,
            },
        } as IInput);

        let result = await node.processAction(dto);
        let resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 3 }, { id: 4 }],
            updated: [],
            deleted: [],
        });

        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                isBuffered: true,
                isLast: false,
                totalCount: 4,
            },
        } as IInput);

        result = await node.processAction(dto);
        resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }],
            updated: [],
            deleted: [],
        });
    });

    it('buffered pages - out of order & deleted', async () => {
        await storeHash({ id: 3 });
        const dto = new ProcessDto<IInput>();
        // Second (last) page
        dto.setNewJsonData({
            items: [{ id: 4 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
                isLast: true,
                totalCount: 3,
            },
        });

        let result = await node.processAction(dto);
        let resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 4 }],
            updated: [],
            deleted: [],
        });

        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
                isLast: false,
                totalCount: 3,
            },
        });

        result = await node.processAction(dto);
        resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }],
            updated: [],
            deleted: ['3'],
        });
    });

    it('buffered pages - but no end config has been provided', async () => {
        await storeHash({ id: 3 });
        const dto = new ProcessDto<IInput>();
        dto.setNewJsonData({
            items: [{ id: 4 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
            },
        });

        let result = await node.processAction(dto);
        let resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 4 }],
            updated: [],
            deleted: [],
        });

        dto.setNewJsonData({
            items: [{ id: 1 }, { id: 2 }],
            configuration: {
                idField: 'id',
                masterKey: 'masterKey',
                deleted: true,
            },
        });

        result = await node.processAction(dto);
        resultData = result.getJsonData();

        expect(resultData).toStrictEqual({
            created: [{ id: 1 }, { id: 2 }],
            updated: [],
            deleted: [],
        });
    });

    it('require confirmation - unconfirmed change is sent again until confirmed', async () => {
        const configuration = { idField: 'id', masterKey: 'masterKey', requireConfirmation: true };

        const first = await node.processAction(createDto([{ id: 1 }], configuration));
        const firstDraftId = first.getHeader(DRAFT_ID_HEADER, '');
        const valuesAfterFirst = await redisStorage.getValues('masterKey', ['1']);

        expect(first.getJsonData()).toStrictEqual({ created: [{ id: 1 }], updated: [], deleted: [] });
        expect(firstDraftId).toMatch(UUID_REGEX);
        expect(valuesAfterFirst).toStrictEqual([null]);

        const second = await node.processAction(createDto([{ id: 1 }], configuration));
        const secondDraftId = second.getHeader(DRAFT_ID_HEADER, '');

        expect(second.getJsonData()).toStrictEqual({ created: [{ id: 1 }], updated: [], deleted: [] });
        expect(secondDraftId).toMatch(UUID_REGEX);
        expect(secondDraftId).not.toBe(firstDraftId);

        await confirmNode.processAction(second);
        const valuesAfterConfirm = await redisStorage.getValues('masterKey', ['1']);

        expect(second.getHeader(DRAFT_ID_HEADER)).toBeUndefined();
        expect(valuesAfterConfirm).not.toStrictEqual([null]);

        const third = await node.processAction(createDto([{ id: 1 }], { ...configuration, stopOnEmptyArray: true }));

        expect(third.getJsonData()).toStrictEqual({});
        expect(third.getHeader(RESULT_CODE)).toBe('1003');
    });

    it('require confirmation - deletes are deferred until confirmed', async () => {
        await storeHash({ id: 3 });
        const configuration = {
            idField: 'id',
            masterKey: 'masterKey',
            deleted: true,
            isLast: true,
            requireConfirmation: true,
        };

        const result = await node.processAction(createDto([{ id: 1 }, { id: 2 }], configuration));
        const keysBeforeConfirm = await redisStorage.getKeys('masterKey');

        expect(result.getJsonData()).toStrictEqual({ created: [{ id: 1 }, { id: 2 }], updated: [], deleted: ['3'] });
        expect(result.getHeader(DRAFT_ID_HEADER)).toMatch(UUID_REGEX);
        expect(keysBeforeConfirm).toStrictEqual(['3']);

        await confirmNode.processAction(result);
        const keysAfterConfirm = await redisStorage.getKeys('masterKey');

        expect(keysAfterConfirm.sort()).toStrictEqual(['1', '2']);
    });

    it('require confirmation - nothing to draft', async () => {
        const configuration = { idField: 'id', masterKey: 'masterKey', skipComparison: true, requireConfirmation: true };

        const result = await node.processAction(createDto([{ id: 1 }], configuration));
        const draftKeys = await redis.keys('*-draft');

        expect(result.getJsonData()).toStrictEqual({ created: [], updated: [{ id: 1 }], deleted: [] });
        expect(result.getHeader(DRAFT_ID_HEADER)).toBeUndefined();
        expect(draftKeys).toStrictEqual([]);
    });

    it('require confirmation - same change drafted twice and confirmed twice', async () => {
        const configuration = { idField: 'id', masterKey: 'masterKey', requireConfirmation: true };

        const first = await node.processAction(createDto([{ id: 1 }], configuration));
        const second = await node.processAction(createDto([{ id: 1 }], configuration));

        expect(first.getHeader(DRAFT_ID_HEADER)).not.toBe(second.getHeader(DRAFT_ID_HEADER));

        await confirmNode.processAction(second);
        await confirmNode.processAction(first);
        const count = await redisStorage.getCount('masterKey');
        const draftKeys = await redis.keys('*-draft');

        expect(count).toBe(1);
        expect(draftKeys).toStrictEqual([]);

        const third = await node.processAction(createDto([{ id: 1 }], configuration));

        expect(third.getJsonData()).toStrictEqual({ created: [], updated: [], deleted: [] });
        expect(third.getHeader(DRAFT_ID_HEADER)).toBeUndefined();
    });

    it('require confirmation - split and confirm item by item', async () => {
        await storeHash({ id: 3 });
        const configuration = {
            idField: 'id',
            masterKey: 'masterKey',
            deleted: true,
            isLast: true,
            requireConfirmation: true,
        };

        const result = await node.processAction(createDto([{ id: 1 }, { id: 2 }], configuration));
        const draftId = result.getHeader(DRAFT_ID_HEADER, '');

        const batch = new BatchProcessDto<ISplitInput>();
        batch.setBridgeData(result.getData());
        batch.setHeaders({ ...result.getHeaders() });
        const children = (await splitNode.processAction(batch)).getMessages();

        expect(children.map((child) => child.headers)).toStrictEqual([
            { [ITEM_ID_HEADER]: '1', [ITEM_OP_HEADER]: 'created' },
            { [ITEM_ID_HEADER]: '2', [ITEM_OP_HEADER]: 'created' },
            { [ITEM_ID_HEADER]: '3', [ITEM_OP_HEADER]: 'deleted' },
        ]);

        const first = await confirmChild(batch, children[0]);
        const keysAfterFirst = await redisStorage.getKeys('masterKey');
        const metaAfterFirst = await redisStorage.getDraftMeta(draftId);

        expect(first.getHeaders()).toStrictEqual({});
        expect(first.getJsonData()).toStrictEqual({ id: 1 });
        expect(keysAfterFirst.sort()).toStrictEqual(['1', '3']);
        expect(metaAfterFirst).not.toBeNull();

        const deleted = await confirmChild(batch, children[2]);
        await confirmChild(batch, children[1]);
        const keysAfterAll = await redisStorage.getKeys('masterKey');
        const draftKeys = await redis.keys('*-draft*');

        expect(deleted.getJsonData()).toBe('3');
        expect(keysAfterAll.sort()).toStrictEqual(['1', '2']);
        expect(draftKeys).toStrictEqual([]);
    });
});
