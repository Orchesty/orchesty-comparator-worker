import ABatchNode from '@orchesty/nodejs-sdk/dist/lib/Batch/ABatchNode';
import OnRepeatException from '@orchesty/nodejs-sdk/dist/lib/Exception/OnRepeatException';
import BatchProcessDto from '@orchesty/nodejs-sdk/dist/lib/Utils/BatchProcessDto';
import {
    DRAFT_ID_HEADER,
    IDraftMeta,
    IOutput,
    ITEM_ID_HEADER,
    ITEM_OP_HEADER,
} from '../service/comparator';
import RedisStorage from '../storage/RedisStorage';

export const NAME = 'split';

export class ComparatorSplit extends ABatchNode {

    public constructor(
        private readonly redis: RedisStorage,
    ) {
        super();
    }

    public getName(): string {
        return NAME;
    }

    public async processAction(dto: BatchProcessDto<IInput>): Promise<BatchProcessDto> {
        const meta = await this.getMeta(dto.getHeader(DRAFT_ID_HEADER));
        const data = dto.getJsonData();

        if (Array.isArray(data)) {
            data.forEach((item) => {
                this.addItem(dto, item, meta);
            });

            return dto;
        }

        (data.created ?? []).forEach((item) => {
            this.addItem(dto, item, meta, 'created');
        });

        (data.updated ?? []).forEach((item) => {
            this.addItem(dto, item, meta, 'updated');
        });

        (data.deleted ?? []).forEach((id) => {
            dto.addItem(JSON.stringify(id), undefined, undefined, {
                ...meta ? { [ITEM_ID_HEADER]: id } : null,
                [ITEM_OP_HEADER]: 'deleted',
            });
        });

        return dto;
    }

    private async getMeta(draftId?: string): Promise<IDraftMeta | null> {
        if (!draftId) {
            return null;
        }

        try {
            return await this.redis.getDraftMeta(draftId);
        } catch (e: unknown) {
            throw new OnRepeatException(60, 20, (e as { message?: string }).message);
        }
    }

    private addItem(dto: BatchProcessDto, item: Item, meta: IDraftMeta | null, operation?: Operation): void {
        dto.addItem(item, undefined, undefined, {
            ...meta ? { [ITEM_ID_HEADER]: String(item[meta.idField]) } : null,
            ...operation ? { [ITEM_OP_HEADER]: operation } : null,
        });
    }

}

type Item = Record<string, unknown>;
type Operation = 'created' | 'updated' | 'deleted';

export type IInput = IOutput | Item[];
