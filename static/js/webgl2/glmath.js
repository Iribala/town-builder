/**
 * glmath.js — minimal 3D math for the vanilla WebGL2 renderer.
 * Column-major mat4, matching WebGL and three.js conventions.
 * No external dependencies.
 *
 * Euler and Quaternion are linked through on-change callbacks exactly like
 * three.js: writing `rotation.y = x` propagates into `quaternion`, and
 * mutating `quaternion` propagates back into `rotation`. Both fire
 * `matrixWorldNeedsUpdate` on the owning object via those callbacks.
 */

const DEG_TO_RAD = Math.PI / 180;

const _q1 = null; // (reserved)

export class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    set(x, y) { this.x = x; this.y = y; return this; }
    clone() { return new Vector2(this.x, this.y); }
    copy(v) { this.x = v.x; this.y = v.y; return this; }
}

export class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    divideScalar(s) { this.x /= s; this.y /= s; this.z /= s; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v) {
        const ax = this.x, ay = this.y, az = this.z;
        this.x = ay * v.z - az * v.y;
        this.y = az * v.x - ax * v.z;
        this.z = ax * v.y - ay * v.x;
        return this;
    }
    crossVectors(a, b) {
        this.x = a.y * b.z - a.z * b.y;
        this.y = a.z * b.x - a.x * b.z;
        this.z = a.x * b.y - a.y * b.x;
        return this;
    }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() {
        const l = this.length();
        if (l > 0) this.multiplyScalar(1 / l);
        return this;
    }
    distanceTo(v) {
        const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    distanceToSquared(v) {
        const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }
    lerp(v, t) {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        this.z += (v.z - this.z) * t;
        return this;
    }
    lerpVectors(a, b, t) {
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        return this;
    }
    setFromArray(a, offset = 0) {
        this.x = a[offset]; this.y = a[offset + 1]; this.z = a[offset + 2];
        return this;
    }
    fromArray(a, offset = 0) { return this.setFromArray(a, offset); }
    toArray(a = [], offset = 0) { a[offset] = this.x; a[offset + 1] = this.y; a[offset + 2] = this.z; return a; }
    setFromMatrixPosition(m) {
        this.x = m.elements[12]; this.y = m.elements[13]; this.z = m.elements[14];
        return this;
    }
    applyQuaternion(q) {
        const ix = q.w * this.x + q.y * this.z - q.z * this.y;
        const iy = q.w * this.y + q.z * this.x - q.x * this.z;
        const iz = q.w * this.z + q.x * this.y - q.y * this.x;
        const iw = -q.x * this.x - q.y * this.y - q.z * this.z;
        this.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
        this.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
        this.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
        return this;
    }
    applyMatrix4(m) { return applyMat4ToVec3(m.elements, this); }
    transformDirection(m) {
        const e = m.elements;
        const x = e[0] * this.x + e[4] * this.y + e[8] * this.z;
        const y = e[1] * this.x + e[5] * this.y + e[9] * this.z;
        const z = e[2] * this.x + e[6] * this.y + e[10] * this.z;
        this.set(x, y, z).normalize();
        return this;
    }
    angleTo(v) {
        const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
        if (denominator === 0) return 0;
        let theta = this.dot(v) / denominator;
        theta = Math.min(1, Math.max(-1, theta));
        return Math.acos(theta);
    }
}

function applyMat4ToVec3(e, v) {
    const x = v.x, y = v.y, z = v.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    v.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    v.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    v.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return v;
}

export class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this._onChange = null;
        this._x = x; this._y = y; this._z = z; this._w = w;
        Object.defineProperties(this, {
            x: propAccessor(this, '_x'),
            y: propAccessor(this, '_y'),
            z: propAccessor(this, '_z'),
            w: propAccessor(this, '_w'),
        });
    }
    _init(onChange) { this._onChange = onChange; return this; }
    _changed() { if (this._onChange) this._onChange(); }
    set(x, y, z, w) {
        this._x = x; this._y = y; this._z = z; this._w = w;
        this._changed();
        return this;
    }
    identity() { return this.set(0, 0, 0, 1); }
    clone() { return new Quaternion(this._x, this._y, this._z, this._w); }
    copy(q) { this._x = q.x; this._y = q.y; this._z = q.z; this._w = q.w; this._changed(); return this; }
    multiply(q) {
        const ax = this._x, ay = this._y, az = this._z, aw = this._w;
        const bx = q.x, by = q.y, bz = q.z, bw = q.w;
        this._x = aw * bx + ax * bw + ay * bz - az * by;
        this._y = aw * by - ax * bz + ay * bw + az * bx;
        this._z = aw * bz + ax * by - ay * bx + az * bw;
        this._w = aw * bw - ax * bx - ay * by - az * bz;
        this._changed();
        return this;
    }
    setFromEuler(e) {
        const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
        const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        this._changed();
        return this;
    }
    setFromAxisAngle(axis, angle) {
        const half = angle / 2, s = Math.sin(half);
        this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
        return this;
    }
    setFromRotationMatrix(m) {
        const e = m.elements;
        // Column-major 3x3 basis
        const m00 = e[0], m10 = e[1], m20 = e[2];
        const m01 = e[4], m11 = e[5], m21 = e[6];
        const m02 = e[8], m12 = e[9], m22 = e[10];
        const trace = m00 + m11 + m22;
        if (trace > 0) {
            const s = Math.sqrt(trace + 1.0) * 2;
            this._w = 0.25 * s;
            this._x = (m21 - m12) / s;
            this._y = (m02 - m20) / s;
            this._z = (m10 - m01) / s;
        } else if (m00 > m11 && m00 > m22) {
            const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
            this._x = 0.25 * s;
            this._w = (m21 - m12) / s;
            this._y = (m01 + m10) / s;
            this._z = (m02 + m20) / s;
        } else if (m11 > m22) {
            const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
            this._y = 0.25 * s;
            this._w = (m02 - m20) / s;
            this._x = (m01 + m10) / s;
            this._z = (m12 + m21) / s;
        } else {
            const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
            this._z = 0.25 * s;
            this._w = (m10 - m01) / s;
            this._x = (m02 + m20) / s;
            this._y = (m12 + m21) / s;
        }
        this._changed();
        return this;
    }
    slerp(qb, t) {
        if (t <= 0) return this;
        if (t >= 1) return this.copy(qb);
        let cosHalfTheta = this._w * qb.w + this._x * qb.x + this._y * qb.y + this._z * qb.z;
        let bx = qb.x, by = qb.y, bz = qb.z, bw = qb.w;
        if (cosHalfTheta < 0) {
            cosHalfTheta = -cosHalfTheta;
            bx = -bx; by = -by; bz = -bz; bw = -bw;
        }
        if (cosHalfTheta >= 0.9995) {
            this._x += (bx - this._x) * t;
            this._y += (by - this._y) * t;
            this._z += (bz - this._z) * t;
            this._w += (bw - this._w) * t;
            return this.normalize();
        }
        const halfTheta = Math.acos(cosHalfTheta);
        const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
        this._x = this._x * ratioA + bx * ratioB;
        this._y = this._y * ratioA + by * ratioB;
        this._z = this._z * ratioA + bz * ratioB;
        this._w = this._w * ratioA + bw * ratioB;
        this._changed();
        return this;
    }
    normalize() {
        const l = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
        if (l > 0) { this._x /= l; this._y /= l; this._z /= l; this._w /= l; }
        this._changed();
        return this;
    }
    conjugate() { this._x = -this._x; this._y = -this._y; this._z = -this._z; this._changed(); return this; }
    invert() { return this.conjugate().normalize(); }
}

function propAccessor(obj, key) {
    return {
        get() { return this[key]; },
        set(value) {
            this[key] = value;
            if (this._onChange) this._onChange();
        },
        enumerable: true,
        configurable: false,
    };
}

export class Euler {
    constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
        this._onChange = null;
        this._x = x; this._y = y; this._z = z; this._order = order;
        Object.defineProperties(this, {
            x: propAccessor(this, '_x'),
            y: propAccessor(this, '_y'),
            z: propAccessor(this, '_z'),
            order: {
                get() { return this._order; },
                set(v) { this._order = v; if (this._onChange) this._onChange(); },
                enumerable: true,
            },
        });
    }
    _init(onChange) { this._onChange = onChange; return this; }
    _changed() { if (this._onChange) this._onChange(); }
    set(x, y, z, order = this._order) {
        this._x = x; this._y = y; this._z = z; this._order = order;
        this._changed();
        return this;
    }
    copy(e) { return this.set(e.x, e.y, e.z, e.order); }
    clone() { return new Euler(this._x, this._y, this._z, this._order); }
    equals(e) { return this._x === e.x && this._y === e.y && this._z === e.z && this._order === e.order; }
}

/** XYZ intrinsic, matching three.js default Euler order. */
export function setEulerFromQuaternion(target, q) {
    const m = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, 1));
    const e = m.elements;
    const sy = Math.sqrt(e[0] * e[0] + e[1] * e[1]);
    if (sy > 1e-6) {
        target._x = Math.atan2(e[6], e[10]);
        target._y = Math.atan2(-e[2], sy);
        target._z = Math.atan2(e[1], e[0]);
    } else {
        target._x = Math.atan2(-e[9], e[5]);
        target._y = Math.atan2(-e[2], sy);
        target._z = 0;
    }
    if (target._onChange) target._onChange();
    return target;
}

export class Matrix4 {
    constructor() {
        this.elements = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]);
    }
    clone() {
        const m = new Matrix4();
        m.elements.set(this.elements);
        return m;
    }
    copy(m) { this.elements.set(m.elements); return this; }
    identity() {
        this.elements.fill(0);
        this.elements[0] = 1; this.elements[5] = 1; this.elements[10] = 1; this.elements[15] = 1;
        return this;
    }
    equals(m) {
        const a = this.elements, b = m.elements;
        for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    multiplyMatrices(a, b) {
        const ae = a.elements, be = b.elements, te = this.elements;
        const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
        const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
        const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
        const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
        const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
        const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
        const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
        const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
        te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
        te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
        te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
        te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
        te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
        te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
        te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
        te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
        te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
        te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
        te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
        te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
        te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
        te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
        te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
        te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
        return this;
    }
    multiply(m) { return this.multiplyMatrices(this, m); }
    premultiply(m) { return this.multiplyMatrices(m, this); }
    compose(position, quaternion, scale) {
        const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        const sx = scale.x, sy = scale.y, sz = scale.z;
        const te = this.elements;
        te[0] = (1 - (yy + zz)) * sx;
        te[1] = (xy + wz) * sx;
        te[2] = (xz - wy) * sx;
        te[3] = 0;
        te[4] = (xy - wz) * sy;
        te[5] = (1 - (xx + zz)) * sy;
        te[6] = (yz + wx) * sy;
        te[7] = 0;
        te[8] = (xz + wy) * sz;
        te[9] = (yz - wx) * sz;
        te[10] = (1 - (xx + yy)) * sz;
        te[11] = 0;
        te[12] = position.x;
        te[13] = position.y;
        te[14] = position.z;
        te[15] = 1;
        return this;
    }
    makeTranslation(x, y, z) {
        this.identity();
        this.elements[12] = x; this.elements[13] = y; this.elements[14] = z;
        return this;
    }
    makeRotationX(theta) {
        const c = Math.cos(theta), s = Math.sin(theta);
        this.identity();
        this.elements[5] = c; this.elements[6] = s;
        this.elements[9] = -s; this.elements[10] = c;
        return this;
    }
    makeRotationY(theta) {
        const c = Math.cos(theta), s = Math.sin(theta);
        this.identity();
        this.elements[0] = c; this.elements[2] = -s;
        this.elements[8] = s; this.elements[10] = c;
        return this;
    }
    makeRotationZ(theta) {
        const c = Math.cos(theta), s = Math.sin(theta);
        this.identity();
        this.elements[0] = c; this.elements[1] = s;
        this.elements[4] = -s; this.elements[5] = c;
        return this;
    }
    makePerspective(left, right, bottom, top, near, far) {
        const te = this.elements;
        te.fill(0);
        const x = (2 * near) / (right - left);
        const y = (2 * near) / (top - bottom);
        const a = (right + left) / (right - left);
        const b = (top + bottom) / (top - bottom);
        const c = -(far + near) / (far - near);
        const d = -(2 * far * near) / (far - near);
        te[0] = x; te[5] = y; te[8] = a; te[9] = b; te[10] = c; te[11] = -1; te[14] = d;
        return this;
    }
    makePerspectiveFov(fovDeg, aspect, near, far) {
        const top = near * Math.tan((fovDeg * DEG_TO_RAD) / 2);
        const height = 2 * top;
        const width = height * aspect;
        return this.makePerspective(-width / 2, width / 2, -height / 2, height / 2, near, far);
    }
    composePositionOnly(position) {
        this.identity();
        this.elements[12] = position.x; this.elements[13] = position.y; this.elements[14] = position.z;
        return this;
    }
    /** General 4x4 inverse via Gaussian elimination with partial pivoting. */
    invert() {
        const t = this.elements;
        // Column-major → row-major for elimination
        const a = [
            [t[0], t[4], t[8], t[12]],
            [t[1], t[5], t[9], t[13]],
            [t[2], t[6], t[10], t[14]],
            [t[3], t[7], t[11], t[15]],
        ];
        const inv = solveInPlace(a);
        if (!inv) return this.identity();
        this.elements.set([
            inv[0][0], inv[1][0], inv[2][0], inv[3][0],
            inv[0][1], inv[1][1], inv[2][1], inv[3][1],
            inv[0][2], inv[1][2], inv[2][2], inv[3][2],
            inv[0][3], inv[1][3], inv[2][3], inv[3][3],
        ]);
        return this;
    }
    transpose() {
        const te = this.elements;
        for (let i = 1; i < 4; i++) {
            for (let j = 0; j < i; j++) {
                const a = i * 4 + j, b = j * 4 + i;
                const t = te[a]; te[a] = te[b]; te[b] = t;
            }
        }
        return this;
    }
    /** Upper-left 3x3 as a normal matrix (inverse transpose), via elimination. */
    normalMatrix(out = new Matrix3()) {
        const e = this.elements;
        const m = new Matrix3();
        m.elements.set([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]);
        m.invert().transpose();
        out.elements.set(m.elements);
        return out;
    }
    transformPoint(v) {
        return applyMat4ToVec3(this.elements, v);
    }
}

export class Matrix3 {
    constructor() {
        this.elements = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    identity() {
        this.elements.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        return this;
    }
    /** General 3x3 inverse via Gaussian elimination. Singular → identity. */
    invert() {
        const t = this.elements;
        const a = [
            [t[0], t[3], t[6]],
            [t[1], t[4], t[7]],
            [t[2], t[5], t[8]],
        ];
        const inv = solveInPlace(a);
        if (!inv) return this.identity();
        this.elements.set([
            inv[0][0], inv[1][0], inv[2][0],
            inv[0][1], inv[1][1], inv[2][1],
            inv[0][2], inv[1][2], inv[2][2],
        ]);
        return this;
    }
    transpose() {
        const te = this.elements;
        const t1 = te[1]; te[1] = te[3]; te[3] = t1;
        const t2 = te[2]; te[2] = te[6]; te[6] = t2;
        const t3 = te[5]; te[5] = te[7]; te[7] = t3;
        return this;
    }
}

/**
 * Invert a small (3x3 or 4x4) row-major matrix via Gaussian elimination
 * with partial pivoting. Returns the inverse matrix, or null when singular.
 */
function solveInPlace(a) {
    const n = a.length;
    const aug = a.map((row, i) => {
        const out = row.slice();
        for (let j = 0; j < n; j++) out.push(i === j ? 1 : 0);
        return out;
    });
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
        }
        if (Math.abs(aug[pivot][col]) < 1e-12) return null;
        if (pivot !== col) { const tmp = aug[pivot]; aug[pivot] = aug[col]; aug[col] = tmp; }
        const invPivot = 1 / aug[col][col];
        for (let j = 0; j < 2 * n; j++) aug[col][j] *= invPivot;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = aug[row][col];
            if (factor === 0) continue;
            for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
        }
    }
    return aug.map(row => row.slice(n));
}

export class Spherical {
    constructor(radius = 1, phi = 0, theta = 0) {
        this.radius = radius;
        this.phi = phi;
        this.theta = theta;
    }
    setFromVector3(v, optionalTarget = this) {
        const radius = v.length();
        const theta = Math.atan2(v.x, v.z);
        const phi = Math.acos(Math.max(-1, Math.min(1, v.y / (radius || 1))));
        optionalTarget.radius = radius;
        optionalTarget.theta = theta;
        optionalTarget.phi = phi;
        return optionalTarget;
    }
    makeSafe() {
        const EPS = 0.000001;
        this.phi = Math.max(EPS, Math.min(Math.PI - EPS, this.phi));
        return this;
    }
}

export class Vector3Spherical { }

/** Ray in the classic origin/direction form (direction normalized). */
export class Ray {
    constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
        this.origin = origin;
        this.direction = direction;
    }
    at(t, target = new Vector3()) {
        return target.copy(this.direction).multiplyScalar(t).add(this.origin);
    }
    intersectPlane(plane, target = new Vector3()) {
        const denominator = plane.normal.dot(this.direction);
        if (denominator === 0) {
            if (plane.normal.dot(this.origin) + plane.constant === 0) return target.copy(this.origin);
            return null;
        }
        const t = -(plane.normal.dot(this.origin) + plane.constant) / denominator;
        if (t < 0) return null;
        return this.at(t, target);
    }
    intersectTriangle(a, b, c, target = new Vector3()) {
        const edge1 = new Vector3().subVectors(b, a);
        const edge2 = new Vector3().subVectors(c, a);
        const pvec = new Vector3().crossVectors(this.direction, edge2);
        const det = edge1.dot(pvec);
        if (Math.abs(det) < 1e-9) return null;
        const invDet = 1 / det;
        const tvec = new Vector3().subVectors(this.origin, a);
        const u = tvec.dot(pvec) * invDet;
        if (u < 0 || u > 1) return null;
        const qvec = new Vector3().crossVectors(tvec, edge1);
        const v = this.direction.dot(qvec) * invDet;
        if (v < 0 || u + v > 1) return null;
        const t = edge2.dot(qvec) * invDet;
        if (t < 0) return null;
        return this.at(t, target);
    }
}

export class Plane {
    constructor(normal = new Vector3(0, 1, 0), constant = 0) {
        this.normal = normal.clone ? normal.clone() : new Vector3().copy(normal);
        this.constant = constant;
    }
}

export function degToRad(d) { return d * DEG_TO_RAD; }
