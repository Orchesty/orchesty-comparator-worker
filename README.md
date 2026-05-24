# Orchesty Comparator Worker

## How to install ?

### 1. Add Comparator to your deployment

- extend your docker-compose.yml with the following service:
```yaml
    services:
        ...
        orchesty-comparator-worker:
            image: orchesty/comparator-worker:2.0.0
            environment:
                TENANT_ID: docker
                CRYPT_SECRET: ${CRYPT_SECRET}
                ORCHESTY_API_KEY: ${ORCHESTY_API_KEY}
                REDIS_DSN: redis://redis:6379

        redis:
            image: redis
```


### 2. Register Comparator as a Orchesty Worker

- Go to UI
- Go to Workers
- Click on Create
- Fill in the form
- Click on Save

## How to use it ?

Comparator has a 2 custom nodes.

### 1. Comparator Filter

Input interface:

```json
{
    "items": [ {...} ],                                     // Array of items to compare Eg. [{id: 1, name: "test", "timestamp": 123456789}]
    "configuration": {
        // Required configuration
        "idField": "path.to.id.field",                      // Path to id field in items array: Eg. "id".
        "masterKey": "masterKey",                           // Master key groups items into collection. 
                                                            //  Can be same for all processes, unique for each process or unique for bathes of items. Eg. "products" or "warehouse-1".
        "excludedFields": ["path.to.excluded.field"],       // Array of paths to excluded fields in items array: Eg. ["timestamp"].
        
        // Nullable configuration
        "stopOnEmptyArray": null,                           // If is true, comparator will stop process as success if result of comparison is empty array.
        "ttl": null,                                        // Determines how long the data will be stored in Redis (in seconds). If is set to null, data will be stored until manually deleted.
        
        // Optional configuration
        "deleted": true,                                    // Enable deleted items feature. Default: false.
        "isLast": true,                                     // This marks the last batch of items in the process. This field must be set if you want to use the "deleted" feature.
        "totalCount": 1,                                    // The total number of all items across all batches in the process. This field must be set if you want to use the "deleted" feature.
                                                            // For example: 
                                                            //  Number of products: 200, 
                                                            //  Pagination set to 20, 
                                                            //  Total number of process messages: 10, 
                                                            //  totalCount = 200
        
        "passAsListOfExistingItems": false,                 // If is true, comparator change output interface to list of items only (Merge new and changed items into one array). 
                                                            //  This options can't be used with "deleted" feature.
        "skipComparison": false,                            // If is true, comparator will skip whole comparison and return all items from input.
        "lock": false,                                      // If is true, comparator will lock master key for other processes.
    }   
}
```

Output interfaces:

- Standard output interface:
```json
    {
        "created": [ {...} ],                               // List of items evaluated as a new one base on cache.
        "updated": [ {...} ],                               // List of items evaluated as changed base on cache.    
        "deleted": [ "id" ]                                 // List of ids of items evaluated as deleted base on cache.
    }
```

- Output interface with `passAsListOfExistingItems` option:
```json
    [ {...}, {...} ]                                        // List of items evaluated as a new one or changed base on cache.
```


### 2. Comparator Invalidate

Input interface:

```json
{
    "masterKey": "masterKey",                               // MasterKey refers to the entire collection of records that will be deleted.

    // Optional configuration
    "externalId": "id"                                      // ExternalId identifies the specific record in the collection that will be deleted
}
```


Output interface:

```json
    {}
```


## How to develop ?
1. Run `make init` for start dev environment
2. Tests can be run by `make test` or `make fasttest`
