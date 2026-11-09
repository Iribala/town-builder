/**
 * gltf-min.js — minimal glTF 2.0 loader for the Town Builder asset subset.
 *
 * Supported (see static/models/ — all 75 shipped assets conform):
 *   .gltf (JSON) with external .bin buffers — GLB is NOT supported
 *   accessors: SCALAR/VEC2/VEC3, FLOAT / UNSIGNED_BYTE / UNSIGNED_SHORT / UNSIGNED_INT
 *   primitives: mode 4 (TRIANGLES) only
 *   attributes: POSITION, NORMAL (generated if absent), TEXCOORD_0
 *   materials: pbrMetallicRoughness { baseColorTexture, baseColorFactor,
 *              metallicFactor, roughnessFactor }, emissiveFactor, alphaMode,
 *              doubleSided (doubleSided is accepted but rasterization stays
 *              two-sided — CULL_FACE is disabled globally)
 *   nodes: hierarchical, TRS only (node.matrix throws)
 *   images: external files (png/jpg/webp), decoded via createImageBitmap
 *
 * Everything else throws (sparse accessors, animations/skins, extensions,
 * KHR_* materials, GLB) with a clear message naming the offending asset,
 * rather than silently producing wrong renders.
 *
 * parseGLTF() is dependency-free and GL-free so it can run in Node for the
 * test suite; loadGLTF() layers fetch + image decode on top.
 */
import {
    Group, Mesh, BufferGeometry, BufferAttribute,
    MeshStandardMaterial, Color, Texture,
} from './three-shim.js';
import { Matrix4, Quaternion, Euler, Vector3 } from './glmath.js';

const GL = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5124: Int32Array, 5125: Uint32Array, 5126: Float32Array,
};
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4 };
const TYPE_VECS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export class GltfMinError extends Error {
    constructor(message, assetUrl) {
        super(assetUrl ? `${assetUrl}: ${message}` : message);
        this.name = 'GltfMinError';
        this.assetUrl = assetUrl;
    }
}

/**
 * Parse a glTF JSON document given its external buffers.
 * @param {object} json  the parsed .gltf document
 * @param {ArrayBuffer[]} buffers  ArrayBuffer for each json.buffers entry
 * @param {string} [assetUrl]  used in error messages
 * @returns {{ root: Group, textureRequests: Array<{index:number, uri:string, mimeType?:string}>, stats: object }}
 */
export function parseGLTF(json, buffers, assetUrl = 'model.gltf') {
    if (!json.asset || json.asset.version !== '2.0') {
        throw new GltfMinError('not a glTF 2.0 asset', assetUrl);
    }
    if (json.extensionsUsed?.length) {
        throw new GltfMinError(`unsupported extensions: ${json.extensionsUsed.join(', ')}`, assetUrl);
    }
    if (json.animations?.length) {
        throw new GltfMinError('animations are not supported', assetUrl);
    }
    if (json.skins?.length) {
        throw new GltfMinError('skins are not supported', assetUrl);
    }
    if (!json.meshes?.length) {
        throw new GltfMinError('no meshes in asset', assetUrl);
    }

    const stats = { primitives: 0, triangles: 0, textures: 0 };

    // ---- accessors -----------------------------------------------------
    const readAccessor = (index) => {
        const acc = json.accessors?.[index];
        if (!acc) throw new GltfMinError(`missing accessor ${index}`, assetUrl);
        if (acc.sparse) throw new GltfMinError(`sparse accessor ${index} is not supported`, assetUrl);
        const viewIndex = acc.bufferView;
        if (viewIndex === undefined) throw new GltfMinError(`accessor ${index} has no bufferView`, assetUrl);
        const view = json.bufferViews[viewIndex];
        const buffer = buffers[view.buffer];
        if (!buffer) throw new GltfMinError(`buffer ${view.buffer} missing`, assetUrl);
        const componentType = acc.componentType;
        const TypedArray = GL[componentType];
        if (!TypedArray) throw new GltfMinError(`unsupported componentType ${componentType}`, assetUrl);
        const components = TYPE_VECS[acc.type];
        const componentBytes = COMPONENT_BYTES[componentType];
        const elementBytes = components * componentBytes;
        const byteStride = view.byteStride ?? elementBytes;
        const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
        const count = acc.count;
        const out = new TypedArray(count * components);
        if (byteStride === elementBytes) {
            const src = new TypedArray(buffer.slice(base, base + count * elementBytes));
            out.set(src);
        } else {
            // Interleaved/strided access — copy element-wise
            const data = buffer;
            for (let i = 0; i < count; i++) {
                const offset = base + i * byteStride;
                const slice = data.slice(offset, offset + elementBytes);
                out.set(new TypedArray(slice), i * components);
            }
        }
        return { array: out, itemSize: components, count, normalized: !!acc.normalized };
    };

    // ---- images / textures (URI requests resolved by the caller) --------
    const images = json.images || [];
    const textureRequests = [];
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img.uri) {
            throw new GltfMinError(`image ${i} has no uri (embedded images unsupported)`, assetUrl);
        }
        textureRequests.push({ index: i, uri: img.uri, mimeType: img.mimeType });
        stats.textures += 1;
    }

    // ---- materials ------------------------------------------------------
    const materialBuilders = (json.materials || []).map((mat, index) => () => {
        const pbr = mat.pbrMetallicRoughness || {};
        const unsupported = [];
        for (const key of Object.keys(pbr)) {
            if (!['baseColorTexture', 'baseColorFactor', 'metallicFactor', 'roughnessFactor'].includes(key)) {
                unsupported.push('pbrMetallicRoughness.' + key);
            }
        }
        for (const key of Object.keys(mat)) {
            if (!['name', 'pbrMetallicRoughness', 'emissiveFactor', 'alphaMode', 'doubleSided', 'metallicRoughnessTexture', 'normalTexture'].includes(key)) {
                unsupported.push(key);
            }
        }
        if (mat.normalTexture || mat.metallicRoughnessTexture) {
            unsupported.push(mat.normalTexture ? 'normalTexture' : 'metallicRoughnessTexture');
        }
        if (unsupported.length) {
            // Tolerated, but loud about it — the model will render without them
            console.warn(`${assetUrl}: material ${index} ("${mat.name ?? ''}"): unsupported slots ignored: ${unsupported.join(', ')}`);
        }
        const material = new MeshStandardMaterial();
        if (pbr.baseColorFactor) {
            material.color = new Color(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]);
            material.opacity = pbr.baseColorFactor[3] ?? 1;
        }
        material.metalness = pbr.metallicFactor ?? 1;
        material.roughness = pbr.roughnessFactor ?? 1;
        if (mat.emissiveFactor) {
            material.emissive = new Color(mat.emissiveFactor[0], mat.emissiveFactor[1], mat.emissiveFactor[2]);
        }
        const alphaMode = mat.alphaMode || 'OPAQUE';
        if (alphaMode === 'BLEND') material.transparent = true;
        material.userData = { alphaMode, doubleSided: !!mat.doubleSided };
        if (pbr.baseColorTexture !== undefined) {
            const tex = json.textures?.[pbr.baseColorTexture.index];
            if (!tex) throw new GltfMinError(`material references missing texture ${pbr.baseColorTexture.index}`, assetUrl);
            material.userData.baseColorTextureIndex = { texture: pbr.baseColorTexture.index, texIntoImage: tex.source };
        }
        return material;
    });

    // ---- meshes ---------------------------------------------------------
    const meshBuilders = (json.meshes || []).map((meshDef, meshIndex) => () => {
        const group = new Group();
        group.name = meshDef.name || `mesh_${meshIndex}`;
        for (const [primIndex, prim] of (meshDef.primitives || []).entries()) {
            stats.primitives += 1;
            const mode = prim.mode ?? 4;
            if (mode !== 4) {
                throw new GltfMinError(`primitive mode ${mode} unsupported (only TRIANGLES=4)`, assetUrl);
            }
            const geometry = new BufferGeometry();
            const position = readAccessor(prim.attributes.POSITION);
            stats.triangles += position.count / 3;
            geometry.setAttribute('position', new BufferAttribute(new Float32Array(position.array), 3));

            let normals;
            if (prim.attributes.NORMAL !== undefined) {
                normals = readAccessor(prim.attributes.NORMAL);
            } else {
                normals = generateFlatNormals(geometry);
            }
            geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals.array), 3));

            if (prim.attributes.TEXCOORD_0 !== undefined) {
                const uv = readAccessor(prim.attributes.TEXCOORD_0);
                geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv.array), 2));
            } else {
                // Constant 0 UV — allows untextured baseColorFactor materials
                const uv = new Float32Array(position.count * 2);
                geometry.setAttribute('uv', new BufferAttribute(uv, 2));
            }

            if (prim.indices !== undefined) {
                const index = readAccessor(prim.indices);
                geometry.setIndex(new BufferAttribute(index.array, 1));
            }

            const material = prim.material !== undefined
                ? materialBuilders[prim.material]()
                : new MeshStandardMaterial();

            const mesh = new Mesh(geometry, material);
            mesh.name = `${group.name}_${primIndex}`;
            group.add(mesh);
        }
        return group;
    });

    // ---- scene graph ----------------------------------------------------
    const root = new Group();
    root.name = 'gltf_root';
    const sceneDef = (json.scenes?.[json.scene ?? 0]) ?? {};
    const nodeDefs = json.nodes || [];

    const buildNode = (index) => {
        const def = nodeDefs[index];
        const node = new Group();
        node.name = def.name || `node_${index}`;
        if (def.matrix) {
            throw new GltfMinError(`node "${node.name}" uses matrix transform (TRS only)`, assetUrl);
        }
        if (def.translation) node.position.set(def.translation[0], def.translation[1], def.translation[2]);
        if (def.rotation) {
            // node rotation is stored as quaternion XYZW; convert to our Euler for the TRS path
            _q.set(def.rotation[0], def.rotation[1], def.rotation[2], def.rotation[3]);
            _q2e(_q, node.rotation);
        }
        if (def.scale) node.scale.set(def.scale[0], def.scale[1], def.scale[2]);
        if (def.mesh !== undefined) {
            node.add(meshBuilders[def.mesh]());
        }
        for (const childIndex of def.children || []) {
            node.add(buildNode(childIndex));
        }
        return node;
    };

    const sceneNodes = sceneDef.nodes ?? nodeDefs.map((_, i) => i).filter(i => !nodeDefs.some(n => (n.children || []).includes(i)));
    for (const i of sceneNodes) root.add(buildNode(i));

    return { root, textureRequests, stats };
}

const _q = new Quaternion();
const _e = new Euler();
function _q2e(q, target) {
    // ZYX intrinsic (three.js 'XYZ' order) from quaternion
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    _e.x = Math.atan2(sinr_cosp, cosr_cosp);
    const sinp = 2 * (w * y - z * x);
    _e.y = Math.abs(sinp) >= 1 ? (sinp > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.asin(sinp);
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    _e.z = Math.atan2(siny_cosp, cosy_cosp);
    target.copy(_e);
    return target;
}

function generateFlatNormals(geometry) {
    const pos = geometry.getAttribute('position');
    const count = pos.count;
    const normals = new Float32Array(count * 3);
    const index = geometry.index ? geometry.index.array : null;
    const p = pos.array;
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3(), n = new Vector3();
    const triCount = index ? index.length / 3 : count / 3;
    for (let t = 0; t < triCount; t++) {
        const i0 = index ? index[t * 3] : t * 3;
        const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
        const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
        a.fromArray(p, i0 * 3); b.fromArray(p, i1 * 3); c.fromArray(p, i2 * 3);
        ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac).normalize();
        for (const i of [i0, i1, i2]) {
            normals[i * 3] = n.x; normals[i * 3 + 1] = n.y; normals[i * 3 + 2] = n.z;
        }
    }
    return { array: normals, itemSize: 3 };
}

/**
 * Resolve baseColor texture URIs: fetch, decode, and attach as Textures.
 * Kept separate from parseGLTF so Node tests can skip image decoding.
 */
export async function attachTextures({ root, textureRequests }, json, baseUrl, fetchImpl = fetch, assetUrl = baseUrl) {
    const images = json.images || [];
    for (const req of textureRequests) {
        const img = images[req.index];
        if (!img) continue;
        const url = resolveUrl(img.uri, baseUrl);
        const resp = await fetchImpl(url);
        if (!resp.ok) throw new GltfMinError(`image fetch failed (${resp.status}): ${url}`, assetUrl);
        const blob = await resp.blob();
        let bitmap;
        try {
            bitmap = await createImageBitmap(blob);
        } catch (err) {
            throw new GltfMinError(`image decode failed: ${url} (${err?.message ?? err})`, assetUrl);
        }
        const texture = new Texture();
        texture.image = bitmap;
        // glTF spec: baseColorTexture is sRGB
        texture.colorSpace = 'srgb';
        root.traverse(node => {
            const mat = node?.material;
            if (!mat) return;
            const info = mat.userData?.baseColorTextureIndex;
            if (!info) return;
            if (info.texIntoImage === req.index) {
                mat.map = texture;
            }
        });
    }
    return root;
}

/**
 * Resolve a possibly-relative URL against the page (or an explicit base).
 * loadGLTF accepts relative paths like '/static/models/x.gltf'.
 */
function resolveUrl(uri, baseUrl) {
    const scopeBase = (typeof document !== 'undefined' && document.baseURI)
        || (typeof location !== 'undefined' ? location.href : undefined)
        || 'http://localhost/';
    const absoluteBase = new URL(baseUrl, scopeBase).href;
    return new URL(uri, absoluteBase).href;
}

/**
 * Fetch + parse a .gltf (external buffers) into a shim scene Group.
 * @param {string} url  absolute or relative URL of the .gltf file
 */
export async function loadGLTF(url) {
    const pageBase = (typeof document !== 'undefined' && document.baseURI)
        || (typeof location !== 'undefined' ? location.href : undefined)
        || 'http://localhost/';
    const absoluteUrl = new URL(url, pageBase).href;
    const resp = await fetch(absoluteUrl);
    if (!resp.ok) throw new GltfMinError(`fetch failed (${resp.status})`, absoluteUrl);
    const json = await resp.json();

    // External buffers (GLB is intentionally unsupported)
    const buffers = [];
    const baseUrl = absoluteUrl;
    for (const [i, buf] of (json.buffers || []).entries()) {
        if (!buf.uri) {
            throw new GltfMinError(`buffer ${i} has no uri (GLB unsupported)`, baseUrl);
        }
        const bufUrl = resolveUrl(buf.uri, baseUrl);
        const bufResp = await fetch(bufUrl);
        if (!bufResp.ok) throw new GltfMinError(`buffer fetch failed (${bufResp.status}): ${bufUrl}`, baseUrl);
        const bytes = await bufResp.arrayBuffer();
        // Sanity: bufferViews must fit inside this buffer
        for (const view of json.bufferViews || []) {
            if (view.buffer !== i) continue;
            const end = (view.byteOffset || 0) + view.byteLength;
            if (end > bytes.byteLength) {
                throw new GltfMinError(`bufferView ${view.byteLength} exceeds buffer ${i} size`, baseUrl);
            }
        }
        buffers.push(bytes);
    }

    const parsed = parseGLTF(json, buffers, baseUrl);
    await attachTextures(parsed, json, baseUrl, fetch, baseUrl);
    return parsed;
}
