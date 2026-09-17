import { container } from '@orchesty/nodejs-sdk';
import OnRepeatException from '@orchesty/nodejs-sdk/dist/lib/Exception/OnRepeatException';
import ProcessDto from '@orchesty/nodejs-sdk/dist/lib/Utils/ProcessDto';
import NodeTester from '@orchesty/nodejs-sdk/dist/test/Testers/NodeTester';
import { ComparatorConfirm, NAME as COMPARATOR_CONFIRM } from '../../src/custom_node/ComparatorConfirm';
import {
    DRAFT_ID_HEADER,
    IDraft,
    ITEM_ID_HEADER,
    ITEM_OP_HEADER,
} from '../../src/service/comparator';
import RedisStorage from '../../src/storage/RedisStorage';

let tester: NodeTester;
let redisStorage: RedisStorage;
let node: ComparatorConfirm;

const MASTER_KEY = 'confirmKey';
const DRAFT_ID = 'fixed-draft';
const DRAFT: IDraft = { masterKey: MASTER_KEY, idField: 'id', ttl: 120, items: { id1: 'hash1new', id3: 'hash3' }, deleted: ['id2'] };

function createItemDto(itemId: string, operation?: string): ProcessDto {
    const dto = new ProcessDto();
    dto.setNewJsonData({ any: 'payload' });
    dto.addHeader(DRAFT_ID_HEADER, DRAFT_ID);
    dto.addHeader(ITEM_ID_HEADER, itemId);

    if (operation) {
        dto.addHeader(ITEM_OP_HEADER, operation);
    }

    return dto;
}

describe('Tests for ComparatorConfirm', () => {
    beforeAll(() => {
        tester = new NodeTester(container, __filename);
        redisStorage = container.get(RedisStorage);
        node = new ComparatorConfirm(redisStorage);
    });

    beforeEach(async () => {
        const pipeline = redisStorage.getPipeline();
        redisStorage.hmSet(pipeline, MASTER_KEY, ['id1', 'hash1', 'id2', 'hash2']);
        await pipeline.exec();

        await redisStorage.saveDraft(DRAFT_ID, DRAFT, 60);
    });

    it('process - ok', async () => {
        await tester.testCustomNode(COMPARATOR_CONFIRM);

        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);
        const draft = await redisStorage.getDraft(DRAFT_ID);

        expect(values).toStrictEqual(['hash1new', null, 'hash3']);
        expect(draft).toBeNull();
    });

    it('process - without draft header', async () => {
        const dto = new ProcessDto();
        dto.setNewJsonData({ any: 'payload' });
        dto.addHeader(ITEM_ID_HEADER, 'id1');
        dto.addHeader(ITEM_OP_HEADER, 'updated');

        const result = await node.processAction(dto);
        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);

        expect(result.getJsonData()).toStrictEqual({ any: 'payload' });
        expect(result.getHeaders()).toStrictEqual({});
        expect(values).toStrictEqual(['hash1', 'hash2', null]);
    });

    it('process - unknown draft', async () => {
        const dto = new ProcessDto();
        dto.setNewJsonData({ any: 'payload' });
        dto.addHeader(DRAFT_ID_HEADER, 'unknown');

        const result = await node.processAction(dto);
        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);

        expect(result.getJsonData()).toStrictEqual({ any: 'payload' });
        expect(result.getHeader(DRAFT_ID_HEADER)).toBeUndefined();
        expect(values).toStrictEqual(['hash1', 'hash2', null]);
    });

    it('process - single item', async () => {
        const result = await node.processAction(createItemDto('id3', 'created'));
        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);
        const draft = await redisStorage.getDraft(DRAFT_ID);

        expect(result.getJsonData()).toStrictEqual({ any: 'payload' });
        expect(result.getHeaders()).toStrictEqual({});
        expect(values).toStrictEqual(['hash1', 'hash2', 'hash3']);
        expect(draft).toStrictEqual({ ...DRAFT, items: { id1: 'hash1new' } });
    });

    it('process - single deleted item', async () => {
        const result = await node.processAction(createItemDto('id2', 'deleted'));
        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);
        const draft = await redisStorage.getDraft(DRAFT_ID);

        expect(result.getHeaders()).toStrictEqual({});
        expect(values).toStrictEqual(['hash1', null, null]);
        expect(draft).toStrictEqual({ ...DRAFT, deleted: [] });
    });

    it('process - unknown item', async () => {
        const result = await node.processAction(createItemDto('id9'));
        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);
        const draft = await redisStorage.getDraft(DRAFT_ID);

        expect(result.getHeaders()).toStrictEqual({});
        expect(values).toStrictEqual(['hash1', 'hash2', null]);
        expect(draft).toStrictEqual(DRAFT);
    });

    it('process - all items confirmed one by one', async () => {
        await node.processAction(createItemDto('id1'));
        await node.processAction(createItemDto('id2'));
        await node.processAction(createItemDto('id3'));
        await node.processAction(createItemDto('id3'));

        const values = await redisStorage.getValues(MASTER_KEY, ['id1', 'id2', 'id3']);
        const draft = await redisStorage.getDraft(DRAFT_ID);

        expect(values).toStrictEqual(['hash1new', null, 'hash3']);
        expect(draft).toBeNull();
    });

    it('process - redis failure is repeated', async () => {
        const spy = jest.spyOn(redisStorage, 'getDraft').mockRejectedValueOnce(new Error('Redis down'));
        const dto = new ProcessDto();
        dto.addHeader(DRAFT_ID_HEADER, DRAFT_ID);

        await expect(node.processAction(dto)).rejects.toBeInstanceOf(OnRepeatException);
        expect(dto.getHeader(DRAFT_ID_HEADER)).toBe(DRAFT_ID);

        spy.mockRestore();
    });
});
