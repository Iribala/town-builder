export const TOWN_CATEGORIES = [
    'buildings',
    'vehicles',
    'trees',
    'props',
    'street',
    'park',
    'terrain',
    'roads'
];

export function normalizeTownItems(rawData) {
    if (!rawData) {
        return [];
    }

    if (Array.isArray(rawData)) {
        return rawData;
    }

    if (typeof rawData === 'object') {
        const items = [];
        for (const category of TOWN_CATEGORIES) {
            const categoryItems = rawData[category] || [];
            for (const item of categoryItems) {
                items.push({
                    category,
                    modelName: item.model || item.modelName,
                    position: item.position,
                    rotation: item.rotation,
                    scale: item.scale,
                    id: item.id
                });
            }
        }
        return items;
    }

    return [];
}

export function applyTransformToObject(object, item) {
    if (!object || !item) {
        return;
    }

    if (item.position) {
        if (Array.isArray(item.position)) {
            object.position.fromArray(item.position);
        } else if (typeof item.position === 'object') {
            object.position.set(item.position.x || 0, item.position.y || 0, item.position.z || 0);
        }
    }

    if (item.rotation) {
        if (Array.isArray(item.rotation)) {
            object.rotation.set(item.rotation[0] || 0, item.rotation[1] || 0, item.rotation[2] || 0);
        } else if (typeof item.rotation === 'object') {
            object.rotation.set(item.rotation.x || 0, item.rotation.y || 0, item.rotation.z || 0);
        }
    }

    if (item.scale) {
        if (Array.isArray(item.scale)) {
            object.scale.fromArray(item.scale);
        } else if (typeof item.scale === 'object') {
            object.scale.set(item.scale.x || 1, item.scale.y || 1, item.scale.z || 1);
        }
    }

    if (item.id) {
        object.userData.id = item.id;
    }
}

export async function loadItemsWithConcurrency(items, loadItem, options = {}) {
    const concurrency = options.concurrency || 8;
    const onError = options.onError || (() => {});
    const workers = [];
    let index = 0;

    async function runWorker() {
        while (index < items.length) {
            const currentIndex = index;
            index += 1;
            const item = items[currentIndex];
            try {
                await loadItem(item, currentIndex);
            } catch (error) {
                onError(error, item);
            }
        }
    }

    const workerCount = Math.min(concurrency, items.length);
    for (let i = 0; i < workerCount; i += 1) {
        workers.push(runWorker());
    }
    await Promise.all(workers);
}

