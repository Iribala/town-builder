# Django Integration Data Inconsistency TODO

Issues identified in commit `97a980b` ("Fix async flow and normalize town data") that need to be addressed.

## Critical Issues

### 1. Data Format Mismatch Between Django and Local Storage

**Location**: `app/routes/town.py` (lines 151, 187, 197)

**Problem**: Normalized data is stored locally but original unnormalized data is sent to Django.

```python
canonical_town_data = normalize_layout_data(town_data_to_save)
# ...
await update_town(town_id, request_payload, town_data_to_save, ...)  # Sends original
await set_town_data(canonical_town_data)  # Stores normalized
```

**Impact**:
- Redis/local storage has `{x, y, z}` dict format
- Django backend has original format (arrays or mixed)
- Data diverges between systems

**Fix Options**:
- Option A: Send `canonical_town_data` to Django instead of `town_data_to_save`
- Option B: Use `denormalize_to_layout_list()` before sending to Django if list format is required

---

### 2. API Response Returns Unnormalized Data

**Locations**:
- `app/routes/town.py:267` - `load_town()`
- `app/routes/town.py:311` - `load_town_from_django()`

**Problem**: These endpoints return original data while Redis stores normalized data.

```python
# load_town()
canonical_town_data = normalize_layout_data(town_data)
await set_town_data(canonical_town_data)
return {..., "data": town_data}  # Returns original, not canonical

# load_town_from_django()
canonical_layout = normalize_layout_data(layout_data)
await set_town_data(canonical_layout)
return {..., "data": town_data}  # Returns original
```

**Impact**: Clients receive different formats depending on data source:
- Direct API call → unnormalized
- SSE broadcast → normalized

**Fix**: Return `canonical_town_data` / `canonical_layout` in the response.

---

### 3. Unused `denormalize_to_layout_list()` Function

**Location**: `app/utils/normalization.py:47`

**Problem**: Function is defined but never called. If Django expects list format (array of objects with `category` field), this should be used.

**Fix**: Either:
- Use this function when preparing Django payloads
- Remove if not needed

---

## Medium Priority Issues

### 4. Shallow Copy in Batch Operations

**Location**: `app/services/batch_operations.py:36`

```python
town_data = await get_town_data()
original_town_data = town_data.copy()  # Shallow copy
```

**Problem**: Shallow copy shares nested objects. Modifying items in `town_data` affects `original_town_data`, breaking rollback logic.

**Fix**: Use `copy.deepcopy(town_data)` instead.

---

### 5. Category List Inconsistencies

**Locations**:
- `app/utils/normalization.py:5` - `_CATEGORIES`
- `app/services/storage.py:13` - `DEFAULT_TOWN_DATA`

**Problem**: Category lists don't match.

`_CATEGORIES`:
```python
["buildings", "vehicles", "trees", "props", "street", "park", "terrain", "roads"]
```

`DEFAULT_TOWN_DATA`:
```python
{"buildings": [], "terrain": [], "roads": [], "props": []}
```

Missing from `DEFAULT_TOWN_DATA`: `vehicles`, `trees`, `street`, `park`

**Fix**: Update `DEFAULT_TOWN_DATA` to include all categories.

---

## Questions to Resolve

1. **What format does Django expect for `layout_data`?**
   - Dict of categories: `{"buildings": [...], "vehicles": [...]}`
   - List with category field: `[{"category": "buildings", ...}, ...]`

2. **Are "street" and "roads" separate categories or duplicates?**
   - Frontend uses both in the categories array
   - Need to clarify intended usage

3. **Should position/rotation/scale be stored as arrays or dicts?**
   - Frontend sends arrays: `[x, y, z]`
   - Frontend expects dicts: `{x, y, z}`
   - Normalization converts to dicts
   - What does Django expect?

---

## Suggested Implementation Order

1. Fix shallow copy issue (quick win, prevents bugs)
2. Update `DEFAULT_TOWN_DATA` to include all categories
3. Decide on Django data format and update save logic accordingly
4. Update load endpoints to return normalized data
5. Remove or integrate `denormalize_to_layout_list()`
