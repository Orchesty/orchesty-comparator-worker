export interface IConfiguration {
    idField: string;
    masterKey: string;
    passAsListOfExistingItems?: boolean;
    excludedFields?: string[];
    stopOnEmptyArray?: boolean;
    ttl?: number;
    skipComparison?: boolean;
    lock?: boolean;
    deleted?: boolean;
    totalCount?: number;
    isLast?: boolean;
    requireConfirmation?: boolean;
    confirmationTtl?: number;
}

export interface IDraft {
    masterKey: string;
    idField: string;
    items: Record<string, string>;
    deleted: string[];
    ttl?: number;
}

export type IDraftMeta = Omit<IDraft, 'items' | 'deleted'>;

export interface IInput {
    items: Record<string, unknown>[];
    configuration: IConfiguration;
}

export interface IOutput {
    created: Record<string, unknown>[];
    updated: Record<string, unknown>[];
    deleted: string[];
}
