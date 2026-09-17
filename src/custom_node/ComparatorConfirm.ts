import ACommonNode from '@orchesty/nodejs-sdk/dist/lib/Commons/ACommonNode';
import OnRepeatException from '@orchesty/nodejs-sdk/dist/lib/Exception/OnRepeatException';
import ProcessDto from '@orchesty/nodejs-sdk/dist/lib/Utils/ProcessDto';
import { DRAFT_ID_HEADER, ITEM_ID_HEADER, ITEM_OP_HEADER } from '../service/comparator';
import RedisStorage from '../storage/RedisStorage';

export const NAME = 'confirm';

export class ComparatorConfirm extends ACommonNode {

    public constructor(
        private readonly redis: RedisStorage,
    ) {
        super();
    }

    public getName(): string {
        return NAME;
    }

    public async processAction(dto: ProcessDto): Promise<ProcessDto> {
        const draftId = dto.getHeader(DRAFT_ID_HEADER);

        if (draftId) {
            try {
                await this.confirm(draftId, dto.getHeader(ITEM_ID_HEADER));
            } catch (e: unknown) {
                throw new OnRepeatException(60, 20, (e as { message?: string }).message);
            }
        }

        return dto
            .removeHeader(DRAFT_ID_HEADER)
            .removeHeader(ITEM_ID_HEADER)
            .removeHeader(ITEM_OP_HEADER);
    }

    private async confirm(draftId: string, itemId?: string): Promise<void> {
        if (itemId) {
            await this.redis.confirmDraftItem(draftId, itemId);

            return;
        }

        const draft = await this.redis.getDraft(draftId);

        if (draft) {
            await this.redis.confirmDraft(draftId, draft);
        }
    }

}
