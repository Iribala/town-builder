# Django Integration Data Inconsistency - RESOLVED

Issues identified in commit `97a980b` ("Fix async flow and normalize town data") have been addressed.

## Resolution Summary

All data now flows consistently in the **normalized dict-of-categories format** with `{x, y, z}` vector representations:

```
Frontend sends: [1, 2, 3] arrays or {x, y, z} dicts
     ↓
FastAPI normalizes → {x:1, y:2, z:3} dicts → Redis ✓
     ↓
FastAPI sends normalized → Django ✓
     ↓
Django returns → FastAPI normalizes → returns to client ✓
```

---

## Resolved Issues

### 1. Data Format Mismatch Between Django and Local Storage ✓

**Fix**: `app/routes/town.py` now passes `canonical_town_data` (normalized) to Django instead of `town_data_to_save` (original).

### 2. API Response Returns Unnormalized Data ✓

**Fix**: `load_town()` and `load_town_from_django()` now return `canonical_town_data`/`canonical_layout` in their responses.

### 3. Unused `denormalize_to_layout_list()` Function ✓

**Fix**: Added documentation explaining the function is kept for potential future use but currently unused.

### 4. Shallow Copy in Batch Operations ✓

**Fix**: Changed `town_data.copy()` to `copy.deepcopy(town_data)` in `app/services/batch_operations.py`.

### 5. Category List Inconsistencies ✓

**Fix**: Updated `DEFAULT_TOWN_DATA` in `app/services/storage.py` to include all 8 categories matching `_CATEGORIES` in normalization.py.

---

## Remaining Questions (for future consideration)

### Are "street" and "roads" separate categories or duplicates?

Both appear in `_CATEGORIES`. This needs investigation with the frontend to determine:
- If they serve different purposes (keep both)
- If one is deprecated (remove it and migrate data)

For now, both are supported to maintain backwards compatibility.

---

## Files Modified

1. `app/services/batch_operations.py` - Added `import copy`, changed to `copy.deepcopy()`
2. `app/services/storage.py` - Updated `DEFAULT_TOWN_DATA` with all 8 categories
3. `app/services/django_client.py` - Updated parameter names and docstrings for clarity
4. `app/routes/town.py` - Pass normalized data to Django, return normalized data in responses
5. `app/utils/normalization.py` - Added documentation to `denormalize_to_layout_list()`
