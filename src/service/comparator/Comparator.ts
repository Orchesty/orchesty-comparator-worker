import crypto from 'crypto';
import RedisStorage from '../../storage/RedisStorage';
import { IConfiguration, IDraft, IInput, IOutput } from './types';

export const HASH_ALG = 'sha1';
export const DRAFT_ID_HEADER = 'comparator-draft-id';
export const ITEM_ID_HEADER = 'comparator-item-id';
export const ITEM_OP_HEADER = 'comparator-item-op';
export const DEFAULT_CONFIRMATION_TTL = 24 * 60 * 60;

export class Comparator {

    public constructor(
        private readonly redis: RedisStorage,
    ) {
    }

    public async compare(input: IInput, correlationId: string, draft?: IDraft): Promise<IOutput> {
        const config = input.configuration;
        const output = this.getEmptyOutput();

        const ids = input.items.map((it) => String(it[config.idField]));
        if (!ids.length) {
            return output;
        }

        const hashes = await this.redis.getValues(config.masterKey, ids);
        const dataToStore: string[] = [];
        const bufferedData: string[] = [];

        input.items.forEach((it, index) => {
            const externalId = it[config.idField] as string;
            const hash = this.createHash(structuredClone(it), config.excludedFields);

            if (!hashes[index]) {
                this.prepareDataToStore(config, dataToStore, bufferedData, externalId, hash);
                output.created.push(it);

                return;
            }

            if (hashes[index] !== hash) {
                this.prepareDataToStore(config, dataToStore, bufferedData, externalId, hash);
                output.updated.push(it);
            }
        });

        const pipeline = this.redis.getPipeline();
        let hasCommands = false;

        if (dataToStore.length > 0) {
            if (draft) {
                this.addToDraft(draft, dataToStore);
            } else {
                this.redis.hmSet(pipeline, config.masterKey, dataToStore, config.ttl);
                hasCommands = true;
            }
        }

        if (bufferedData.length > 0) {
            const bufferKey = this.redis.getBufferKey(correlationId);
            this.redis.hmSet(pipeline, bufferKey, bufferedData, config.ttl ?? 3600);
            hasCommands = true;
        }

        if (hasCommands) {
            await pipeline.exec();
        }

        return output;
    }

    public async getDeletedItems(config: IConfiguration, correlationId: string, draft?: IDraft): Promise<string[]> {
        if (!config.totalCount && !config.isLast) {
            return [];
        }

        const bufferedKey = this.redis.getBufferKey(correlationId);
        if (config.totalCount) {
            const totalBuffered = await this.redis.getCount(bufferedKey);
            if (totalBuffered !== config.totalCount) {
                return [];
            }
        }

        const bufferedItems = await this.redis.getKeys(bufferedKey);
        const existingItems = await this.redis.getKeys(config.masterKey);
        const deletedItems = existingItems.filter((id) => !bufferedItems.includes(id));

        if (deletedItems.length > 0) {
            if (draft) {
                draft.deleted.push(...deletedItems);
            } else {
                const pipeline = this.redis.getPipeline();
                pipeline.hdel(config.masterKey, ...deletedItems);
                await pipeline.exec();
            }
        }

        return deletedItems;
    }

    public getEmptyOutput(): IOutput {
        return { created: [], updated: [], deleted: [] };
    }

    public createDraft(config: IConfiguration): IDraft {
        return { masterKey: config.masterKey, idField: config.idField, ttl: config.ttl, items: {}, deleted: [] };
    }

    public isDraftEmpty(draft: IDraft): boolean {
        return Object.keys(draft.items).length === 0 && draft.deleted.length === 0;
    }

    private createHash(data: object, excludedFields: string[] = []): string {
        const hasher = crypto.createHash(HASH_ALG);
        this.clearData(data, excludedFields);

        hasher.update(JSON.stringify(data));
        return hasher.digest('hex');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private clearData(data: any, excludedFields: string[]): void {
        excludedFields.forEach((path) => {
            const keys = path.split('.');
            const last = keys.length - 1;

            const local = keys.slice(0, last).reduce((acc, key) => acc?.[key] ?? null, data);

            if (local) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete local[keys[last]];
            }
        });
    }

    private prepareDataToStore(
        config: IConfiguration,
        dataToStore: string[],
        bufferedData: string[],
        externalId: string,
        hash: string,
    ): void {
        dataToStore.push(externalId, hash);

        if (config.deleted === true) {
            bufferedData.push(externalId, hash);
        }
    }

    private addToDraft(draft: IDraft, dataToStore: string[]): void {
        for (let i = 0; i < dataToStore.length; i += 2) {
            // eslint-disable-next-line no-param-reassign
            draft.items[dataToStore[i]] = dataToStore[i + 1];
        }
    }

}
