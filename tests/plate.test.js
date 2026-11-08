import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plateGeometry} from '../src/plate.js';
test('reference plate outline uses 180/256mm dimensions and remains below print surface',()=>{for(const size of [180,256]){const g=plateGeometry(size);g.computeBoundingBox();assert.ok(Math.abs(g.boundingBox.max.x-g.boundingBox.min.x-size)<.01);assert.ok(g.boundingBox.max.z<0);const uv=g.getAttribute('uv');for(const n of uv.array)assert.ok(n>=0&&n<=1);g.dispose();}});
