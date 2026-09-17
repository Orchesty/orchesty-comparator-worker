import { container } from '@orchesty/nodejs-sdk';
import OnRepeatException from '@orchesty/nodejs-sdk/dist/lib/Exception/OnRepeatException';
import BatchProcessDto from '@orchesty/nodejs-sdk/dist/lib/Utils/BatchProcessDto';
import NodeTester from '@orchesty/nodejs-sdk/dist/test/Testers/NodeTester';
import { ComparatorSplit, IInput, NAME as COMPARATOR_SPLIT } from '../../src/custom_node/ComparatorSplit';
import {
    DRAFT_ID_HEADER,
    IDraft,
    ITEM_ID_HEADER,
    ITEM_OP_HEADER,
} from '../../src/service/comparator';
import RedisStorage from '../../src/storage/RedisStorage';

let tester: NodeTester;
let redisStorage: RedisStorage;
let node: ComparatorSplit;

const DRAFT_ID = 'fixed-draft';

function createDto(data: IInput, draftId?: string): BatchProcessDto<IInput> {
    const dto = new BatchProcessDto<IInput>();
    dto.setBridgeData(JSON.stringify(data));

    if (draftId) {
        dto.addHeader(DRAFT_ID_HEADER, draftId);
    }

    return dto;
}

describe('Tests for ComparatorSplit', () => {
    beforeAll(() => {
        tester = new NodeTester(container, __filename);
        redisStorage = container.get(RedisStorage);
        node = new ComparatorSplit(redisStorage);
    });

    beforeEach(async () => {
        const draft: IDraft = { masterKey: 'splitKey', idField: 'id', items: { any: 'hash' }, deleted: [] };
        await redisStorage.saveDraft(DRAFT_ID, draft, 60);
    });

    it('process - ok', async () => {
        await tester.testBatch(COMPARATOR_SPLIT);
    });

    it('process - without draft', async () => {
        const result = await node.processAction(createDto({ created: [{ id: 1 }], updated: [], deleted: ['3'] }, 'unknown'));

        expect(result.getMessages()).toStrictEqual([
            { headers: { [ITEM_OP_HEADER]: 'created' }, body: '{"id":1}' },
            { headers: { [ITEM_OP_HEADER]: 'deleted' }, body: '"3"' },
        ]);
        expect(result.getHeader(DRAFT_ID_HEADER)).toBe('unknown');
    });

    it('process - without draft header', async () => {
        const result = await node.processAction(createDto({ created: [], updated: [{ id: 2 }], deleted: [] }));

        expect(result.getMessages()).toStrictEqual([
            { headers: { [ITEM_OP_HEADER]: 'updated' }, body: '{"id":2}' },
        ]);
    });

    it('process - list of items', async () => {
        const result = await node.processAction(createDto([{ id: 1 }, { id: 2 }], DRAFT_ID));

        expect(result.getMessages()).toStrictEqual([
            { headers: { [ITEM_ID_HEADER]: '1' }, body: '{"id":1}' },
            { headers: { [ITEM_ID_HEADER]: '2' }, body: '{"id":2}' },
        ]);
    });

    it('process - empty output', async () => {
        const result = await node.processAction(createDto({ created: [], updated: [], deleted: [] }, DRAFT_ID));

        expect(result.getMessages()).toStrictEqual([]);
    });

    it('process - redis failure is repeated', async () => {
        const spy = jest.spyOn(redisStorage, 'getDraftMeta').mockRejectedValueOnce(new Error('Redis down'));
        const dto = createDto({ created: [{ id: 1 }], updated: [], deleted: [] }, DRAFT_ID);

        await expect(node.processAction(dto)).rejects.toBeInstanceOf(OnRepeatException);
        expect(dto.getMessages()).toStrictEqual([]);

        spy.mockRestore();
    });
});
