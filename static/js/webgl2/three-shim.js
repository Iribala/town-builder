/**
 * three-shim.js — vanilla JS + WebGL2 drop-in for the subset of the
 * three.js API that Town Builder's first-party client actually uses.
 *
 * This is NOT a reimplementation of three.js. It implements exactly what
 * our client calls (see docs/plans/vanilla-js-threejs.md §1):
 *   scene graph nodes, basic geometries (plane/circle/cone), a line-based
 *   grid, PBR (GGX) + unlit + line + sprite draws, hemisphere ambient
 *   lighting (stands in for the PMREM env map), ACES tone mapping with
 *   sRGB output encoding, frustum culling math helpers, AABB collision,
 *   and triangle raycasting.
 *
 * Everything GL-related is created lazily inside WebGLRenderer; importing
 * this module in Node (for the glTF parse tests) touches no GL at all.
 *
 * Coordinate conventions match WebGL/three: right-handed, column-major
 * matrices, camera looks down −Z.
 */
import {
    Vector2, Vector3, Quaternion, Euler, Matrix4, Matrix3, Spherical,
    Ray, Plane, degToRad, setEulerFromQuaternion,
} from './glmath.js';

export {
    Vector2, Vector3, Quaternion, Euler, Matrix4, Matrix3, Spherical,
    Ray, Plane,
};

export const REVISION = 'webgl2-1';
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'linear-srgb';
export const NoToneMapping = 0;
export const ACESFilmicToneMapping = 1;
export const DoubleSide = 2;
export const FrontSide = 0;
export const BackSide = 1;

/* ---------------------------------------------------------------- Color */
export class Color {
    constructor(value = 0xffffff) {
        this.r = 1; this.g = 1; this.b = 1;
        this.set(value);
    }
    set(value) {
        if (value && typeof value === 'object' && 'r' in value) {
            this.r = value.r; this.g = value.g; this.b = value.b;
            return this;
        }
        if (typeof value === 'number') return this.setHex(value);
        if (typeof value === 'string') return this.setStyle(value);
        return this;
    }
    setHex(hex) {
        this.r = ((hex >> 16) & 255) / 255;
        this.g = ((hex >> 8) & 255) / 255;
        this.b = (hex & 255) / 255;
        return this;
    }
    setStyle(str) {
        const s = String(str).trim();
        if (s[0] === '#') {
            let h = s.slice(1);
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            const n = parseInt(h, 16);
            return this.setHex(n);
        }
        const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (m) {
            this.r = +m[1] / 255; this.g = +m[2] / 255; this.b = +m[3] / 255;
        }
        return this;
    }
    clone() { return new Color().setRGB(this.r, this.g, this.b); }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
    getHex() { return (Math.round(this.r * 255) << 16) | (Math.round(this.g * 255) << 8) | Math.round(this.b * 255); }
    toArray() { return [this.r, this.g, this.b]; }
}

/* ------------------------------------------------------------- Material */
let materialId = 0;
export class Material {
    constructor() {
        this.id = ++materialId;
        this.transparent = false;
        this.opacity = 1;
        this.color = new Color(0xffffff);
        this.visible = true;
        this.disposed = false;
    }
    clone() { const m = new this.constructor(); m.copy(this); return m; }
    copy(m) {
        this.transparent = m.transparent; this.opacity = m.opacity;
        this.color = m.color.clone(); this.visible = m.visible;
        return this;
    }
    dispose() { this.disposed = true; }
}

export class MeshBasicMaterial extends Material {
    constructor(params = {}) {
        super();
        this.type = 'MeshBasicMaterial';
        this.map = null;
        Object.assign(this, params);
        if (params.color !== undefined) this.color = new Color(params.color);
    }
    copy(m) { super.copy(m); this.map = m.map ?? null; return this; }
}

export class MeshStandardMaterial extends Material {
    constructor(params = {}) {
        super();
        this.type = 'MeshStandardMaterial';
        this.roughness = 1;
        this.metalness = 0;
        this.map = null;
        this.emissive = new Color(0x000000);
        this.emissiveIntensity = 1;
        this.envMapIntensity = 1;
        Object.assign(this, params);
        if (params.color !== undefined) this.color = new Color(params.color);
        if (params.emissive !== undefined) this.emissive = new Color(params.emissive);
    }
    copy(m) {
        super.copy(m);
        this.roughness = m.roughness; this.metalness = m.metalness;
        this.map = m.map ?? null;
        this.emissive = m.emissive.clone(); this.emissiveIntensity = m.emissiveIntensity;
        this.envMapIntensity = m.envMapIntensity;
        return this;
    }
}

export class LineBasicMaterial extends Material {
    constructor(params = {}) {
        super();
        this.type = 'LineBasicMaterial';
        this.vertexColors = false;
        this.linewidth = 1;
        Object.assign(this, params);
        if (params.color !== undefined) this.color = new Color(params.color);
    }
    copy(m) { super.copy(m); this.vertexColors = m.vertexColors; this.linewidth = m.linewidth; return this; }
}

export class SpriteMaterial extends Material {
    constructor(params = {}) {
        super();
        this.type = 'SpriteMaterial';
        this.map = null;
        this.depthTest = true;
        this.depthWrite = false;
        Object.assign(this, params);
        if (params.color !== undefined) this.color = new Color(params.color);
    }
    copy(m) { super.copy(m); this.map = m.map ?? null; this.depthTest = m.depthTest; this.depthWrite = m.depthWrite; return this; }
}

/* -------------------------------------------------------- BufferGeometry */
export class BufferAttribute {
    constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
        this.count = array.length / itemSize;
    }
}

export class BufferGeometry {
    constructor() {
        this.attributes = {};
        this.index = null;
        this.boundingBox = null;
        this.boundingSphere = null;
        this._glCache = null;
    }
    setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
    getAttribute(name) { return this.attributes[name]; }
    setIndex(index) {
        if (index instanceof BufferAttribute) {
            this.index = index;
        } else if (ArrayBuffer.isView(index)) {
            this.index = new BufferAttribute(index, 1);
        } else {
            // Plain array: pack as uint16 when possible, else uint32
            let max = 0;
            for (const i of index) if (i > max) max = i;
            const TypedArray = max < 65536 ? Uint16Array : Uint32Array;
            this.index = new BufferAttribute(new TypedArray(index), 1);
        }
        return this;
    }
    computeBoundingBox() {
        const pos = this.attributes.position;
        if (!pos) return this.boundingBox = new Box3();
        const min = new Vector3(Infinity, Infinity, Infinity);
        const max = new Vector3(-Infinity, -Infinity, -Infinity);
        const a = pos.array;
        for (let i = 0; i < a.length; i += 3) {
            if (a[i] < min.x) min.x = a[i];
            if (a[i + 1] < min.y) min.y = a[i + 1];
            if (a[i + 2] < min.z) min.z = a[i + 2];
            if (a[i] > max.x) max.x = a[i];
            if (a[i + 1] > max.y) max.y = a[i + 1];
            if (a[i + 2] > max.z) max.z = a[i + 2];
        }
        this.boundingBox = new Box3(min, max);
        return this.boundingBox;
    }
    computeBoundingSphere() {
        this.computeBoundingBox();
        const c = this.boundingBox.getCenter(new Vector3());
        this.boundingSphere = { center: c, radius: this.boundingBox.getSize(new Vector3()).length() / 2 };
        return this.boundingSphere;
    }
    clone() {
        const g = new BufferGeometry();
        for (const name of Object.keys(this.attributes)) {
            const attr = this.attributes[name];
            g.attributes[name] = new BufferAttribute(attr.array.slice(), attr.itemSize);
        }
        if (this.index) g.index = new BufferAttribute(this.index.array.slice(), 1);
        return g;
    }
    dispose() {
        if (this._glCache) {
            this._glCache.delete();
            this._glCache = null;
        }
        this.boundingBox = null;
    }
    /** Override point: called by the renderer to release GL objects. */
}

function buildPlane(width, height, wSegs = 1, hSegs = 1) {
    const g = new BufferGeometry();
    const w = width, h = height;
    const xSegs = Math.max(1, wSegs), ySegs = Math.max(1, hSegs);
    const positions = [], normals = [], uvs = [], indices = [];
    for (let iy = 0; iy <= ySegs; iy++) {
        const y = (iy / ySegs - 0.5) * h;
        for (let ix = 0; ix <= xSegs; ix++) {
            const x = (ix / xSegs - 0.5) * w;
            positions.push(x, -y, 0);
            normals.push(0, 0, 1);
            uvs.push(ix / xSegs, 1 - iy / ySegs);
        }
    }
    for (let iy = 0; iy < ySegs; iy++) {
        for (let ix = 0; ix < xSegs; ix++) {
            const a = iy * (xSegs + 1) + ix;
            const b = a + xSegs + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(indices);
    return g;
}

export class PlaneGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
        super();
        this.parameters = { width, height, widthSegments, heightSegments };
        const built = buildPlane(width, height, widthSegments, heightSegments);
        this.attributes = built.attributes;
        this.index = built.index;
    }
}

export class CircleGeometry extends BufferGeometry {
    constructor(radius = 1, segments = 32) {
        super();
        this.parameters = { radius, segments };
        const positions = [0, 0, 0], normals = [0, 0, 1], uvs = [0.5, 0.5], indices = [];
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            positions.push(Math.cos(t) * radius, Math.sin(t) * radius, 0);
            normals.push(0, 0, 1);
            uvs.push(0.5 + Math.cos(t) * 0.5, 0.5 + Math.sin(t) * 0.5);
        }
        for (let i = 1; i <= segments; i++) indices.push(0, i + 1, i);
        this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
        this.setIndex(indices);
    }
}

export class ConeGeometry extends BufferGeometry {
    constructor(radius = 1, height = 1, radialSegments = 8, heightSegments = 1, openEnded = false) {
        super();
        this.parameters = { radius, height, radialSegments, heightSegments, openEnded };
        const positions = [], normals = [], uvs = [], indices = [];
        const half = height / 2;
        const slope = radius / height; // for normal computation
        // Side
        for (let iy = 0; iy <= heightSegments; iy++) {
            const v = iy / heightSegments;
            const y = half - v * height;
            const r = radius * (1 - v);
            for (let i = 0; i <= radialSegments; i++) {
                const t = (i / radialSegments) * Math.PI * 2;
                const cx = Math.cos(t), sz = Math.sin(t);
                positions.push(cx * r, y, sz * r);
                const ny = slope;
                const inv = 1 / Math.sqrt(1 + ny * ny);
                normals.push(cx * inv, ny * inv, sz * inv);
                uvs.push(i / radialSegments, v);
            }
        }
        const ring = radialSegments + 1;
        for (let iy = 0; iy < heightSegments; iy++) {
            for (let i = 0; i < radialSegments; i++) {
                const a = iy * ring + i;
                const b = a + ring;
                indices.push(a, a + 1, b, b, a + 1, b + 1);
            }
        }
        // Base cap (facing down)
        if (!openEnded) {
            const baseCenter = positions.length / 3;
            positions.push(0, -half, 0);
            normals.push(0, -1, 0);
            uvs.push(0.5, 0.5);
            const baseRingStart = radialSegments + 1 + (heightSegments - 1) * ring;
            for (let i = 0; i < radialSegments; i++) {
                indices.push(baseCenter, baseRingStart + i + 1, baseRingStart + i);
            }
        }
        this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
        this.setIndex(indices);
    }
}

export class BoxGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, depth = 1) {
        super();
        this.parameters = { width, height, depth };
        const w = width / 2, h = height / 2, d = depth / 2;
        // 6 faces: +x, -x, +y, -y, +z, -z — (pos, normal, uv) quads
        const faces = [
            [[w, -h, d], [w, h, d], [w, h, -d], [w, -h, -d], [1, 0, 0]],
            [[-w, -h, -d], [-w, h, -d], [-w, h, d], [-w, -h, d], [-1, 0, 0]],
            [[-w, h, d], [-w, h, -d], [w, h, -d], [w, h, d], [0, 1, 0]],
            [[-w, -h, -d], [-w, -h, d], [w, -h, d], [w, -h, -d], [0, -1, 0]],
            [[-w, -h, d], [-w, h, d], [w, h, d], [w, -h, d], [0, 0, 1]],
            [[w, -h, -d], [w, h, -d], [-w, h, -d], [-w, -h, -d], [0, 0, -1]],
        ];
        const positions = [], normals = [], uvs = [], indices = [];
        let offset = 0;
        for (const [a, b, c, dd, n] of faces) {
            positions.push(...a, ...b, ...c, ...dd);
            for (let i = 0; i < 4; i++) normals.push(...n);
            uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
            indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
            offset += 4;
        }
        this.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        this.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
        this.setIndex(indices);
    }
}

/* ---------------------------------------------------------------- Scene */
let _id = 0;
export class Object3D {
    constructor() {
        this.id = ++_id;
        this.name = '';
        this.type = 'Object3D';
        this.parent = null;
        this.children = [];
        this.visible = true;
        this.isObject3D = true;
        this.position = new Vector3();
        this.rotation = new Euler()._init(() => {
            if (this._syncing) return;
            this._syncing = true;
            this.quaternion.setFromEuler(this.rotation);
            this._syncing = false;
        });
        this.scale = new Vector3(1, 1, 1);
        this.quaternion = new Quaternion()._init(() => {
            if (this._syncing) return;
            this._syncing = true;
            setEulerFromQuaternion(this.rotation, this.quaternion);
            this._syncing = false;
        });
        this.matrixWorld = new Matrix4();
        this.matrixWorldNeedsUpdate = true;
        this.userData = {};
        this._syncing = false;
    }
    add(...objects) {
        for (const obj of objects) {
            if (obj === this) continue;
            if (obj.parent) obj.parent.remove(obj);
            obj.parent = this;
            this.children.push(obj);
        }
        return this;
    }
    remove(...objects) {
        for (const obj of objects) {
            const i = this.children.indexOf(obj);
            if (i !== -1) {
                this.children.splice(i, 1);
                obj.parent = null;
            }
        }
        return this;
    }
    clear() { while (this.children.length) this.remove(this.children[0]); return this; }
    traverse(fn) {
        fn(this);
        for (const child of this.children) child.traverse(fn);
    }
    traverseVisible(fn) {
        if (!this.visible) return;
        fn(this);
        for (const child of this.children) child.traverseVisible(fn);
    }
    updateMatrixWorld(force = false) {
        // rotation↔quaternion stay consistent through their on-change
        // callbacks; compose purely from the quaternion here.
        const local = new Matrix4().compose(this.position, this.quaternion, this.scale);
        if (this.parent === null) {
            this.matrixWorld.copy(local);
        } else {
            this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, local);
        }
        for (const child of this.children) child.updateMatrixWorld(force || this.matrixWorldNeedsUpdate);
        this.matrixWorldNeedsUpdate = false;
    }
    updateWorldMatrix(updateParents, updateChildren) {
        if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
        this.updateMatrixWorld();
        if (updateChildren) for (const child of this.children) child.updateWorldMatrix(false, true);
    }
    translateX(d) { return this.translateOnAxis(_X, d); }
    translateY(d) { return this.translateOnAxis(_Y, d); }
    translateZ(d) { return this.translateOnAxis(_Z, d); }
    translateOnAxis(axis, d) {
        _v1.copy(axis).applyQuaternion(this.quaternion);
        this.position.addScaledVector(_v1, d);
        this.matrixWorldNeedsUpdate = true;
        return this;
    }
    getWorldPosition(target) {
        this.updateWorldMatrix(true, false);
        return target.setFromMatrixPosition(this.matrixWorld);
    }
    getWorldDirection(target) {
        this.updateWorldMatrix(true, false);
        const e = this.matrixWorld.elements;
        target.set(-e[8], -e[9], -e[10]);
        return target.normalize();
    }
    lookAt(a, b, c) {
        let target;
        if (a instanceof Vector3) target = _v1.copy(a);
        else target = _v1.set(typeof a === 'number' ? a : (a?.x ?? 0), typeof b === 'number' ? b : (b?.y ?? 0), typeof c === 'number' ? c : (c?.z ?? 0));
        const eye = this.parent === null ? _v2.copy(this.position) : this.getWorldPosition(_v2);
        const isCamLike = this.isCamera || this.isDirectionalLight || this.isSpotLight;
        // Three.js convention: cameras look down −Z (so z = eye − target);
        // objects face +Z toward the target (so z = target − eye).
        const zAxis = isCamLike ? _v3.subVectors(eye, target) : _v3.subVectors(target, eye);
        if (zAxis.lengthSq() < 1e-10) zAxis.set(0, 0, 1);
        zAxis.normalize();
        const xAxis = new Vector3().crossVectors(_UP, zAxis);
        if (xAxis.lengthSq() < 1e-10) {
            zAxis.x += 0.0001;
            zAxis.normalize();
            xAxis.crossVectors(_UP, zAxis);
        }
        xAxis.normalize();
        const yAxis = new Vector3().crossVectors(zAxis, xAxis);
        const m = new Matrix4();
        const te = m.elements;
        // Column-major storage: basis vectors are COLUMNS
        te[0] = xAxis.x; te[1] = xAxis.y; te[2] = xAxis.z;   // column 0 = right
        te[4] = yAxis.x; te[5] = yAxis.y; te[6] = yAxis.z;   // column 1 = up
        te[8] = zAxis.x; te[9] = zAxis.y; te[10] = zAxis.z;  // column 2 = back
        te[3] = 0; te[7] = 0; te[11] = 0;
        te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
        this.quaternion.setFromRotationMatrix(m);
        // three.js syncs matrixWorldNeedsUpdate through the quaternion onChange
        this.matrixWorldNeedsUpdate = true;
    }
    setScalarScale(s) { this.scale.set(s, s, s); return this; }
    clone() { return new Object3D().copy(this); }
    copy(source) {
        this.position.copy(source.position);
        this.rotation.copy(source.rotation);
        this.scale.copy(source.scale);
        this.visible = source.visible;
        this.userData = { ...source.userData };
        this.name = source.name;
        for (const child of source.children) this.add(child.clone());
        return this;
    }
}
const _X = new Vector3(1, 0, 0), _Y = new Vector3(0, 1, 0), _Z = new Vector3(0, 0, 1);
const _UP = new Vector3(0, 1, 0);
const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();

export class Group extends Object3D {
    constructor() { super(); this.type = 'Group'; }
    clone() { return new Group().copy(this); }
}

export class Scene extends Object3D {
    constructor() {
        super();
        this.type = 'Scene';
        this.background = null;
        this.environment = null;
    }
    clone() { return new Scene().copy(this); }
}

export class Mesh extends Object3D {
    constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
        super();
        this.type = 'Mesh';
        this.isMesh = true;
        this.geometry = geometry;
        this.material = material;
    }
    clone() { return new Mesh(this.geometry, this.material).copy(this); }
    copy(source) {
        super.copy(source);
        this.geometry = source.geometry;
        this.material = source.material;
        return this;
    }
}

export class Sprite extends Object3D {
    constructor(material = new SpriteMaterial()) {
        super();
        this.type = 'Sprite';
        this.isSprite = true;
        this.material = material;
    }
    clone() { return new Sprite(this.material).copy(this); }
    copy(source) {
        super.copy(source);
        this.material = source.material;
        return this;
    }
}

/* --------------------------------------------------------------- Lights */
export class AmbientLight extends Object3D {
    constructor(color = 0xffffff, intensity = 1) {
        super();
        this.isAmbientLight = true;
        this.type = 'AmbientLight';
        this.color = new Color(color);
        this.intensity = intensity;
    }
}

export class DirectionalLight extends Object3D {
    constructor(color = 0xffffff, intensity = 1) {
        super();
        this.isDirectionalLight = true;
        this.type = 'DirectionalLight';
        this.color = new Color(color);
        this.intensity = intensity;
        this.castShadow = false;
    }
}

/* --------------------------------------------------------------- Camera */
export class Camera extends Object3D {
    constructor() {
        super();
        this.isCamera = true;
        this.type = 'Camera';
        this.matrixWorldInverse = new Matrix4();
        this.projectionMatrix = new Matrix4();
        this.projectionMatrixInverse = new Matrix4();
    }
    updateMatrixWorld(force = false) {
        super.updateMatrixWorld(force);
        this.matrixWorldInverse.copy(this.matrixWorld).invert();
    }
}

export class PerspectiveCamera extends Camera {
    constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
        super();
        this.isPerspectiveCamera = true;
        this.type = 'PerspectiveCamera';
        this.fov = fov;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this.updateProjectionMatrix();
    }
    updateProjectionMatrix() {
        this.projectionMatrix.makePerspectiveFov(this.fov, this.aspect, this.near, this.far);
        this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }
}

/* ------------------------------------------------------------- Textures */
let textureId = 0;
export class Texture {
    constructor() {
        this.id = ++textureId;
        this.image = null;
        this.needsUpdate = true;
        this.colorSpace = SRGBColorSpace;
        this.flipY = true;
        this.disposed = false;
        this._glTex = null;
    }
    clone() {
        const t = new Texture();
        t.image = this.image; t.colorSpace = this.colorSpace; t.flipY = this.flipY;
        return t;
    }
    dispose() {
        this.disposed = true;
        if (this._glTex) {
            // The owning renderer performs the delete lazily via _pendingGLDeletes.
            _pendingTextureDeletes.push(this._glTex);
            this._glTex = null;
        }
    }
}
export class CanvasTexture extends Texture {
    constructor(canvas) {
        super();
        this.image = canvas;
        this.colorSpace = SRGBColorSpace;
    }
}
const _pendingTextureDeletes = [];

/* --------------------------------------------------------------- Timer */
export class Timer {
    constructor() {
        this._start = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        this._last = this._start;
        this._delta = 0;
    }
    _now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }
    getDelta() {
        const now = this._now();
        this._delta = now - this._last;
        this._last = now;
        return this._delta;
    }
    getElapsed() { return this._now() - this._start; }
}

/* -------------------------------------------------------------- Frustum */
const _planeMatrix = new Matrix4();
export class Frustum {
    constructor() { this.planes = Array.from({ length: 6 }, () => new Plane(new Vector3(0, 1, 0), 0)); }
    setFromProjectionMatrix(m) {
        const e = m.elements;
        const rows = [
            [e[0], e[4], e[8], e[12]],
            [e[1], e[5], e[9], e[13]],
            [e[2], e[6], e[10], e[14]],
            [e[3], e[7], e[11], e[15]],
        ];
        const add = (a, b, p) => {
            p.normal.set(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
            let c = a[3] + b[3];
            const len = p.normal.length();
            if (len > 0) { p.normal.divideScalar(len); c /= len; }
            p.constant = c;
        };
        const sub = (a, b, p) => {
            p.normal.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            let c = a[3] - b[3];
            const len = p.normal.length();
            if (len > 0) { p.normal.divideScalar(len); c /= len; }
            p.constant = c;
        };
        add(rows[3], rows[0], this.planes[0]); // left
        sub(rows[3], rows[0], this.planes[1]); // right
        add(rows[3], rows[1], this.planes[2]); // bottom
        sub(rows[3], rows[1], this.planes[3]); // top
        add(rows[3], rows[2], this.planes[4]); // near
        sub(rows[3], rows[2], this.planes[5]); // far
        return this;
    }
    intersectsBox(box) {
        if (box.isEmpty()) return false;
        for (const plane of this.planes) {
            const v = plane.normal.x >= 0 ? box.max : box.min;
            const v2 = plane.normal.y >= 0 ? box.max : box.min;
            const v3 = plane.normal.z >= 0 ? box.max : box.min;
            if (plane.normal.x * v.x + plane.normal.y * v2.y + plane.normal.z * v3.z + plane.constant < 0) return false;
        }
        return true;
    }
}

/* --------------------------------------------------------------- Box3 */
export class Box3 {
    constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
        this.min = min;
        this.max = max;
    }
    isEmpty() {
        return this.min.x > this.max.x || this.min.y > this.max.y || this.min.z > this.max.z;
    }
    set(min, max) { this.min = min.clone ? min.clone() : new Vector3().copy(min); this.max = max.clone ? max.clone() : new Vector3().copy(max); return this; }
    makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
    expandByPoint(p) {
        this.min.x = Math.min(this.min.x, p.x);
        this.min.y = Math.min(this.min.y, p.y);
        this.min.z = Math.min(this.min.z, p.z);
        this.max.x = Math.max(this.max.x, p.x);
        this.max.y = Math.max(this.max.y, p.y);
        this.max.z = Math.max(this.max.z, p.z);
        return this;
    }
    expandByObject(object) {
        object.updateMatrixWorld();
        object.traverse(child => {
            if (!child.geometry) return;
            const pos = child.geometry.getAttribute('position');
            if (!pos) return;
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
            const bb = child.geometry.boundingBox;
            const e = child.matrixWorld.elements;
            for (let i = 0; i < 8; i++) {
                const corner = new Vector3(
                    i & 1 ? bb.max.x : bb.min.x,
                    i & 2 ? bb.max.y : bb.min.y,
                    i & 4 ? bb.max.z : bb.min.z
                );
                corner.applyMatrix4(child.matrixWorld);
                this.expandByPoint(corner);
            }
            void e;
        });
        return this;
    }
    setFromObject(object) { return this.makeEmpty().expandByObject(object); }
    setFromArray(points) {
        for (const p of points) this.expandByPoint(p);
        return this;
    }
    applyMatrix4(matrix) {
        const points = [
            new Vector3(this.min.x, this.min.y, this.min.z),
            new Vector3(this.max.x, this.min.y, this.min.z),
            new Vector3(this.min.x, this.max.y, this.min.z),
            new Vector3(this.min.x, this.min.y, this.max.z),
            new Vector3(this.max.x, this.max.y, this.min.z),
            new Vector3(this.max.x, this.min.y, this.max.z),
            new Vector3(this.min.x, this.max.y, this.max.z),
            new Vector3(this.max.x, this.max.y, this.max.z),
        ];
        this.makeEmpty();
        for (const p of points) p.applyMatrix4(matrix);
        for (const p of points) this.expandByPoint(p);
        return this;
    }
    intersectsBox(box) {
        return (
            this.max.x >= box.min.x && this.min.x <= box.max.x &&
            this.max.y >= box.min.y && this.min.y <= box.max.y &&
            this.max.z >= box.min.z && this.min.z <= box.max.z
        );
    }
    getCenter(target) { return target.set(
        (this.min.x + this.max.x) / 2,
        (this.min.y + this.max.y) / 2,
        (this.min.z + this.max.z) / 2
    ); }
    getSize(target) { return target.set(
        this.max.x - this.min.x,
        this.max.y - this.min.y,
        this.max.z - this.min.z
    ); }
    translate(offset) { this.min.add(offset); this.max.add(offset); return this; }
    clone() { return new Box3(this.min.clone(), this.max.clone()); }
}

/* ------------------------------------------------------------ Raycaster */
export class Raycaster {
    constructor(near = 0, far = Infinity) {
        this.ray = new Ray();
        this.near = near;
        this.far = far;
    }
    setFromCamera(coords, camera) {
        camera.updateWorldMatrix(true, false);
        const origin = this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
        // Unproject NDC (z=0.5) into world space via the inverse projections
        const e = camera.projectionMatrixInverse.elements;
        const ix = e[0] * coords.x + e[4] * coords.y + e[8] * 0.5 + e[12];
        const iy = e[1] * coords.x + e[5] * coords.y + e[9] * 0.5 + e[13];
        const iz = e[2] * coords.x + e[6] * coords.y + e[10] * 0.5 + e[14];
        const iw = e[3] * coords.x + e[7] * coords.y + e[11] * 0.5 + e[15];
        const world = new Vector3(ix / iw, iy / iw, iz / iw).applyMatrix4(camera.matrixWorld);
        this.ray.direction.copy(world.sub(origin).normalize());
    }
    intersectObject(object, recursive = false, intersects = []) {
        if (object.isMesh && object.geometry) this.#intersectMesh(object, intersects);
        if (recursive) {
            for (const child of object.children) this.intersectObject(child, true, intersects);
        }
        return intersects;
    }
    intersectObjects(objects, recursive = false, intersects = []) {
        for (const object of objects) this.intersectObject(object, recursive, intersects);
        intersects.sort((a, b) => a.distance - b.distance);
        return intersects;
    }
    #intersectMesh(mesh, intersects) {
        const geometry = mesh.geometry;
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) return;
        // AABB prefilter when available
        if (geometry.boundingBox || true) {
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const box = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
            const rayBoxDist = rayBoxDistance(this.ray, box);
            if (rayBoxDist === null || rayBoxDist > this.far) return;
        }
        const a = posAttr.array;
        const index = geometry.index ? geometry.index.array : null;
        const triCount = index ? index.length / 3 : a.length / 9;
        const vA = new Vector3(), vB = new Vector3(), vC = new Vector3(), target = new Vector3();
        for (let t = 0; t < triCount; t++) {
            let i0, i1, i2;
            if (index) {
                i0 = index[t * 3]; i1 = index[t * 3 + 1]; i2 = index[t * 3 + 2];
            } else {
                i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
            }
            vA.fromArray(a, i0 * 3).applyMatrix4(mesh.matrixWorld);
            vB.fromArray(a, i1 * 3).applyMatrix4(mesh.matrixWorld);
            vC.fromArray(a, i2 * 3).applyMatrix4(mesh.matrixWorld);
            const hit = this.ray.intersectTriangle(vA, vB, vC, target);
            if (hit) {
                const distance = hit.distanceTo(this.ray.origin);
                if (distance < this.near || distance > this.far) continue;
                intersects.push({
                    distance,
                    point: hit.clone(),
                    object: mesh,
                    face: { a: i0, b: i1, c: i2 },
                });
            }
        }
    }
}

function rayBoxDistance(ray, box) {
    let tMin = 0, tMax = Infinity;
    const o = ray.origin, d = ray.direction;
    for (const axis of ['x', 'y', 'z']) {
        const od = o[axis], dd = d[axis];
        const bmin = box.min[axis], bmax = box.max[axis];
        if (Math.abs(dd) < 1e-9) {
            if (od < bmin || od > bmax) return null;
            continue;
        }
        let t1 = (bmin - od) / dd, t2 = (bmax - od) / dd;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }
    return tMin;
}

/* ------------------------------------------------------- GridHelper */
export class GridHelper extends Object3D {
    constructor(size = 10, divisions = 10, colorCenterLine = 0x444444, colorGrid = 0x888888) {
        super();
        this.type = 'GridHelper';
        this.isLineSegments = true;
        const half = size / 2;
        const step = size / divisions;
        const positions = [], colors = [];
        const c1 = new Color(colorCenterLine), c2 = new Color(colorGrid);
        for (let i = 0; i <= divisions; i++) {
            const p = -half + i * step;
            const isCenter = i === divisions / 2;
            const c = isCenter ? c1 : c2;
            positions.push(-half, 0, p, half, 0, p);
            positions.push(p, 0, -half, p, 0, half);
            for (let k = 0; k < 2; k++) colors.push(c.r, c.g, c.b);
            for (let k = 0; k < 2; k++) colors.push(c.r, c.g, c.b);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
        this.geometry = geometry;
        this.material = new LineBasicMaterial({ vertexColors: true });
    }
}

/* --------------------------------------------------------- WebGLRenderer */
const VERT_COMMON = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aColor;
uniform mat4 uProjView;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vUV = aUV;
    vColor = aColor;
    gl_Position = uProjView * world;
}`;

const VERT_SPRITE = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform mat4 uProjView;
uniform mat4 uModel;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUV;
void main() {
    vUV = aCorner * 0.5 + 0.5;
    vec3 center = (uModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float sx = length(vec3(uModel[0][0], uModel[0][1], uModel[0][2]));
    float sy = length(vec3(uModel[1][0], uModel[1][1], uModel[1][2]));
    vec3 world = center + uRight * aCorner.x * sx + uUp * aCorner.y * sy;
    gl_Position = uProjView * vec4(world, 1.0);
}`;

const FRAG_STANDARD = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
uniform sampler2D uMap;
uniform int uUseMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uRoughness;
uniform float uMetalness;
uniform float uEnvIntensity;
uniform vec3 uEmissive;
uniform float uEmissiveIntensity;
uniform vec3 uViewPos;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uAmbient;
uniform int uToneMap;
out vec4 outColor;
const float PI = 3.14159265359;
vec3 acesFit(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 srgb(vec3 c) {
    return pow(max(c, 0.0), vec3(1.0 / 2.2));
}
void main() {
    vec3 base = uColor;
    if (uUseMap == 1) base *= texture(uMap, vUV).rgb;
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uViewPos - vWorldPos);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);
    float NoL = max(dot(N, L), 0.0);
    float NoV = max(dot(N, V), 1e-4);
    float NoH = max(dot(N, H), 0.0);
    float rough = max(uRoughness, 0.045);
    float alpha = rough * rough;
    float alpha2 = alpha * alpha;
    // GGX distribution
    float denom = NoH * NoH * (alpha2 - 1.0) + 1.0;
    float D = alpha2 / max(PI * denom * denom, 1e-6);
    // Smith geometry (Schlick-GGX)
    float k = (rough + 1.0); k = k * k / 8.0;
    float gv = NoV / (NoV * (1.0 - k) + k);
    float glv = max(NoL, 1e-4) / (max(NoL, 1e-4) * (1.0 - k) + k);
    float G = gv * glv;
    // Fresnel-Schlick
    vec3 F0 = mix(vec3(0.04), base, uMetalness);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 specular = (D * F * G) / max(4.0 * NoV * max(NoL, 1e-4), 1e-4);
    vec3 kD = (vec3(1.0) - F) * (1.0 - uMetalness);
    vec3 diffuse = kD * base / PI;
    // Hemisphere ambient (stands in for the PMREM env map)
    float hemiT = N.y * 0.5 + 0.5;
    vec3 hemi = mix(uHemiGround, uHemiSky, hemiT) * uEnvIntensity;
    vec3 ambient = hemi + uAmbient;
    vec3 color = ambient * base
        + (diffuse + specular) * uLightColor * uLightIntensity * NoL;
    color += uEmissive * uEmissiveIntensity;
    if (uToneMap == 1) color = acesFit(color);
    color = srgb(color);
    outColor = vec4(color, uOpacity);
}`;

const FRAG_BASIC = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
uniform sampler2D uMap;
uniform int uUseMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform int uToneMap;
out vec4 outColor;
vec3 acesFit(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
    vec3 base = uColor;
    if (uUseMap == 1) base *= texture(uMap, vUV).rgb;
    vec3 color = base;
    if (uToneMap == 1) {
        color = acesFit(color);
        color = pow(max(color, 0.0), vec3(1.0 / 2.2));
    }
    outColor = vec4(color, uOpacity);
}`;

const FRAG_LINE = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
uniform vec3 uColor;
uniform int uVertexColors;
uniform int uToneMap;
out vec4 outColor;
void main() {
    vec3 c = uVertexColors == 1 ? vColor : uColor;
    outColor = vec4(c, 1.0);
}`;

const FRAG_SPRITE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 outColor;
void main() {
    vec4 tex = texture(uMap, vUV);
    outColor = vec4(uColor * tex.rgb, uOpacity * tex.a);
}`;

export class WebGLRenderer {
    constructor(params = {}) {
        this.domElement = typeof document !== 'undefined'
            ? document.createElement('canvas')
            : null;
        this.capabilities = { isWebGL2: true };
        this.toneMapping = ACESFilmicToneMapping;
        this.toneMappingExposure = 1.0;
        this.setClearColor(0x87ceeb, 1);
        this._programs = new Map();
        this._gl = null;
        this._attribs = {};
        this._uniformCache = new Map();
        this._textureCache = new Map();
        if (this.domElement) {
            const gl = this.domElement.getContext('webgl2', {
                antialias: params.antialias !== false,
                powerPreference: params.powerPreference || 'high-performance',
            });
            if (!gl) throw new Error('WebGL2 is not available');
            this._gl = gl;
            this._initGL();
        }
    }
    _initGL() {
        const gl = this._gl;
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.clearColor(this._clearR, this._clearG, this._clearB, this._clearA);
    }
    getContext() { return this._gl; }
    setClearColor(hex, alpha = 1) {
        this._clearHex = hex;
        this._clearR = ((hex >> 16) & 255) / 255;
        this._clearG = ((hex >> 8) & 255) / 255;
        this._clearB = (hex & 255) / 255;
        this._clearA = alpha;
        if (this._gl) this._gl.clearColor(this._clearR, this._clearG, this._clearB, this._clearA);
    }
    setPixelRatio(ratio) {
        this.pixelRatio = ratio;
        this.setSize(this.domElement.width / (this._lastDpr || 1), this.domElement.height / (this._lastDpr || 1), false);
    }
    setSize(width, height, updateStyle = true) {
        this._width = width;
        this._height = height;
        this._lastDpr = this.pixelRatio || 1;
        if (this.domElement) {
            this.domElement.width = Math.max(1, Math.floor(width * this._lastDpr));
            this.domElement.height = Math.max(1, Math.floor(height * this._lastDpr));
            if (updateStyle) {
                this.domElement.style.width = width + 'px';
                this.domElement.style.height = height + 'px';
            }
            if (this._gl) this._gl.viewport(0, 0, this.domElement.width, this.domElement.height);
        }
    }
    getSize(target) { target.set(this._width, this._height); return target; }
    _compileProgram(vsSrc, fsSrc, key) {
        if (this._programs.has(key)) return this._programs.get(key);
        const gl = this._gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSrc);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            throw new Error('Vertex shader compile failed: ' + gl.getShaderInfoLog(vs));
        }
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSrc);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            throw new Error('Fragment shader compile failed: ' + gl.getShaderInfoLog(fs));
        }
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        const entry = {
            program,
            uniforms: this._collectUniforms(program),
        };
        this._programs.set(key, entry);
        return entry;
    }
    _collectUniforms(program) {
        const gl = this._gl;
        const uniforms = {};
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(program, i);
            const name = info.name.replace(/\[0\]$/, '');
            uniforms[name] = gl.getUniformLocation(program, name);
        }
        return uniforms;
    }
    _programFor(material) {
        if (material.type === 'MeshStandardMaterial') {
            const key = 'standard|' + (material.map ? 'map|' : 'plain|');
            return this._compileProgram(VERT_COMMON, FRAG_STANDARD, key);
        }
        if (material.type === 'MeshBasicMaterial') {
            const key = 'basic|' + (material.map ? 'map|' : 'plain|');
            return this._compileProgram(VERT_COMMON, FRAG_BASIC, key);
        }
        if (material.type === 'LineBasicMaterial') {
            return this._compileProgram(VERT_COMMON, FRAG_LINE, 'line');
        }
        if (material.type === 'SpriteMaterial') {
            return this._compileProgram(VERT_SPRITE, FRAG_SPRITE, 'sprite');
        }
        throw new Error('Unsupported material type: ' + material.type);
    }
    _glGeometry(geometry) {
        if (geometry._glCache) return geometry._glCache;
        const gl = this._gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const buffers = [];
        const pos = geometry.getAttribute('position');
        const bindAttr = (attr, loc) => {
            const buffer = gl.createBuffer();
            buffers.push(buffer);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, attr.array, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
        };
        if (pos) bindAttr(pos, 0);
        const normal = geometry.getAttribute('normal');
        if (normal) bindAttr(normal, 1);
        else gl.disableVertexAttribArray(1);
        const uv = geometry.getAttribute('uv');
        if (uv) bindAttr(uv, 2);
        else gl.disableVertexAttribArray(2);
        const color = geometry.getAttribute('color');
        if (color) bindAttr(color, 3);
        else gl.disableVertexAttribArray(3);
        let indexBuffer = null;
        if (geometry.index) {
            indexBuffer = gl.createBuffer();
            buffers.push(indexBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            const arr = geometry.index.array;
            const type = arr instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
            geometry._indexType = type;
        }
        gl.bindVertexArray(null);
        const cache = {
            vao,
            buffers,
            indexBuffer,
            indexCount: geometry.index ? geometry.index.count : 0,
            delete: () => {
                gl.deleteVertexArray(vao);
                for (const b of buffers) gl.deleteBuffer(b);
            },
        };
        geometry._glCache = cache;
        return cache;
    }
    _glTexture(texture) {
        if (texture._glTex) return texture._glTex;
        const gl = this._gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const srgb = texture.colorSpace === SRGBColorSpace;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY ? 1 : 0);
        gl.texImage2D(
            gl.TEXTURE_2D, 0,
            srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
            gl.RGBA, gl.UNSIGNED_BYTE, texture.image
        );
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.generateMipmap(gl.TEXTURE_2D);
        texture._glTex = tex;
        texture.needsUpdate = false;
        return tex;
    }
    _drawMesh(mesh, projView, viewPos, lights) {
        const gl = this._gl;
        const geometry = mesh.geometry;
        const material = mesh.material;
        const cache = this._glGeometry(geometry);
        const entry = this._programFor(material);
        gl.useProgram(entry.program);

        const model = mesh.matrixWorld;
        const normalMatrix = model.normalMatrix(new Matrix3());
        gl.uniformMatrix4fv(entry.uniforms.uProjView, false, projView.elements);
        gl.uniformMatrix4fv(entry.uniforms.uModel, false, model.elements);
        if (entry.uniforms.uNormalMatrix) gl.uniformMatrix3fv(entry.uniforms.uNormalMatrix, false, normalMatrix.elements);

        gl.uniform3f(entry.uniforms.uViewPos, viewPos.x, viewPos.y, viewPos.z);
        if (entry.uniforms.uLightDir) gl.uniform3f(entry.uniforms.uLightDir, lights.dir.x, lights.dir.y, lights.dir.z);
        if (entry.uniforms.uLightColor) gl.uniform3f(entry.uniforms.uLightColor, lights.color.r, lights.color.g, lights.color.b);
        if (entry.uniforms.uLightIntensity) gl.uniform1f(entry.uniforms.uLightIntensity, lights.intensity);
        if (entry.uniforms.uHemiSky) gl.uniform3f(entry.uniforms.uHemiSky, 0.70, 0.90, 0.98);
        if (entry.uniforms.uHemiGround) gl.uniform3f(entry.uniforms.uHemiGround, 0.18, 0.55, 0.34);
        if (entry.uniforms.uAmbient) gl.uniform3f(entry.uniforms.uAmbient, lights.ambient.r, lights.ambient.g, lights.ambient.b);
        if (entry.uniforms.uToneMap) gl.uniform1i(entry.uniforms.uToneMap, this.toneMapping === ACESFilmicToneMapping ? 1 : 0);

        if (entry.uniforms.uColor) gl.uniform3f(entry.uniforms.uColor, material.color.r, material.color.g, material.color.b);
        if (entry.uniforms.uOpacity) gl.uniform1f(entry.uniforms.uOpacity, material.opacity);

        if (material.type === 'MeshStandardMaterial') {
            gl.uniform1f(entry.uniforms.uRoughness, material.roughness);
            gl.uniform1f(entry.uniforms.uMetalness, material.metalness);
            gl.uniform1f(entry.uniforms.uEnvIntensity, material.envMapIntensity ?? 1);
            gl.uniform3f(entry.uniforms.uEmissive, material.emissive.r, material.emissive.g, material.emissive.b);
            gl.uniform1f(entry.uniforms.uEmissiveIntensity, material.emissiveIntensity);
        }
        if (entry.uniforms.uVertexColors) gl.uniform1i(entry.uniforms.uVertexColors, material.vertexColors ? 1 : 0);

        const useMap = !!material.map;
        if (useMap) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._glTexture(material.map));
            if (entry.uniforms.uMap) gl.uniform1i(entry.uniforms.uMap, 0);
            if (entry.uniforms.uUseMap) gl.uniform1i(entry.uniforms.uUseMap, 1);
        } else if (entry.uniforms.uUseMap) {
            gl.uniform1i(entry.uniforms.uUseMap, 0);
        }

        // Rasterization state per material
        gl.depthMask(material.transparent ? false : true);
        if (material.transparent) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } else {
            gl.disable(gl.BLEND);
        }

        gl.bindVertexArray(cache.vao);
        const prim = material.type === 'LineBasicMaterial' ? gl.LINES : gl.TRIANGLES;
        if (geometry.index) {
            gl.drawElements(prim, cache.indexCount, geometry._indexType, 0);
        } else {
            const pos = geometry.getAttribute('position');
            gl.drawArrays(prim, 0, pos ? pos.count : 0);
        }
        gl.bindVertexArray(null);
        gl.depthMask(true);
    }
    _drawSprite(sprite, projView, viewPos, lights) {
        const gl = this._gl;
        if (!this._spriteVao) {
            this._spriteVao = gl.createVertexArray();
            gl.bindVertexArray(this._spriteVao);
            const quad = gl.createBuffer();
            const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
            gl.bindBuffer(gl.ARRAY_BUFFER, quad);
            gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.bindVertexArray(null);
        }
        const material = sprite.material;
        const entry = this._programFor(material);
        gl.useProgram(entry.program);
        gl.uniformMatrix4fv(entry.uniforms.uProjView, false, projView.elements);
        gl.uniformMatrix4fv(entry.uniforms.uModel, false, sprite.matrixWorld.elements);
        // Camera right/up in world space
        const e = lights.viewMatrix.elements;
        gl.uniform3f(entry.uniforms.uRight, e[0], e[1], e[2]);
        gl.uniform3f(entry.uniforms.uUp, e[4], e[5], e[6]);
        if (entry.uniforms.uColor) gl.uniform3f(entry.uniforms.uColor, material.color.r, material.color.g, material.color.b);
        if (entry.uniforms.uOpacity) gl.uniform1f(entry.uniforms.uOpacity, material.opacity);
        if (material.map) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._glTexture(material.map));
            if (entry.uniforms.uMap) gl.uniform1i(entry.uniforms.uMap, 0);
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        if (material.depthTest === false) gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(this._spriteVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        gl.depthMask(true);
        if (material.depthTest === false) gl.enable(gl.DEPTH_TEST);
    }
    render(scene, camera) {
        if (!this._gl) throw new Error('WebGLRenderer created without a document (headless)');
        const gl = this._gl;
        scene.updateMatrixWorld();
        camera.updateMatrixWorld();
        this._flushPendingDeletes();

        gl.clearColor(this._clearR, this._clearG, this._clearB, this._clearA);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Gather lights (defaults if absent)
        let ambient = new Color(0xffffff), ambientI = 0.6;
        let dirColor = new Color(0xffffff), dirI = 1.2, dirPos = new Vector3(10, 20, 10);
        scene.traverse(node => {
            if (node.isAmbientLight) { ambient = node.color; ambientI = node.intensity; }
            if (node.isDirectionalLight) {
                dirColor = node.color; dirI = node.intensity;
                dirPos = node.getWorldPosition ? node.getWorldPosition(new Vector3()) : dirPos;
            }
        });
        const lights = {
            ambient: new Color(ambient.r * ambientI, ambient.g * ambientI, ambient.b * ambientI),
            dir: dirPos.clone().normalize(),
            color: dirColor,
            intensity: dirI,
            viewMatrix: camera.matrixWorldInverse,
        };

        const projView = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
        const viewPos = camera.getWorldPosition(new Vector3());

        // Collect drawables: opaque first, then transparent, sprites last
        const opaque = [], transparent = [], sprites = [], lines = [];
        scene.traverseVisible(node => {
            if (node.isSprite) { sprites.push(node); return; }
            if (node.isLineSegments || node.isGridHelper || (node.isObject3D && node.type === 'GridHelper')) { lines.push(node); return; }
            if (!node.isMesh) return;
            if (!node.material || node.material.visible === false) return;
            (node.material.transparent ? transparent : opaque).push(node);
        });

        for (const mesh of opaque) this._drawMesh(mesh, projView, viewPos, lights);
        for (const node of lines) this._drawMesh(node, projView, viewPos, lights);
        for (const mesh of transparent) this._drawMesh(mesh, projView, viewPos, lights);
        for (const sprite of sprites) this._drawSprite(sprite, projView, viewPos, lights);

        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    _flushPendingDeletes() {
        if (!this._gl || _pendingTextureDeletes.length === 0) return;
        for (const tex of _pendingTextureDeletes.splice(0)) {
            this._gl.deleteTexture(tex);
        }
    }
    dispose() {
        if (!this._gl) return;
        for (const entry of this._programs.values()) this._gl.deleteProgram(entry.program);
        this._programs.clear();
        this._gl.getExtension('WEBGL_lose_context')?.loseContext();
        this._gl = null;
    }
}
