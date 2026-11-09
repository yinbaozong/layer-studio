import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse, pack, unpack, simplify, transferables} from '../src/parser.js';
test('same layer colors, reserved tools and travel',()=>{const r=parse('; filament_colour = #ff0000;#00ff00\nG90\nM83\nG1 X0 Y0 Z0.2\nG1 X10 E1\nT1\nG1 Y10 E1\nT255\nG1 X0 E1\nG1 E-1\nG1 X5\nG1 E1');assert.equal(r.segments.length,3);assert.deepEqual(r.segments.map(s=>s.tool),[0,1,1]);assert.equal(r.layers,1);});
test('absolute E reset and Z hop do not deposit',()=>{const r=parse('M82\nG1 Z0.2\nG1 X10 E1\nG92 E0\nG1 Z1\nG1 X20\nG1 Z0.2\nG1 X30 E1');assert.equal(r.segments.length,2);assert.equal(r.layers,1);});
test('I/J full circle deposits and R arc is rejected explicitly',()=>{const r=parse('M83\nG1 X10 Y0 Z0.2\nG3 X10 Y0 I-10 J0 E1');assert.ok(r.segments.length>20);assert.throws(()=>parse('M83\nG1 Z.2\nG2 X10 Y10 R10 E1'),/R 格式/);});
test('Bambu widths, heights and higher tool ids survive',()=>{const r=parse('; LINE_WIDTH: 0.6\n; LAYER_HEIGHT: 0.3\nM83\nT12\nG1 Z.3\nG1 X10 E1');assert.equal(r.segments[0].tool,12);assert.equal(r.segments[0].height,.3);assert.equal(r.segments[0].width,.6);});

test('path continuity breaks on travel, retraction, feature and tool changes',()=>{
 const r=parse('M83\nG1 Z.2\nG1 X10 E1\nG1 X20 E1\nG1 X25\nG1 X20\nG1 X30 E1\nG1 E-1\nG1 E1\nG1 X40 E1\n; FEATURE: Inner wall\nG1 X50 E1\nT1\nG1 X60 E1');
 assert.equal(r.segments[0].pathId,r.segments[1].pathId);
 for(let i=2;i<r.segments.length;i++)assert.notEqual(r.segments[i-1].pathId,r.segments[i].pathId);
});
test('retraction recovery is tool-local',()=>{
 const r=parse('M83\nG1 Z.2\nG1 E-2\nT1\nG1 X10 E1\nT0\nG1 E2\nG1 X20 E1');assert.equal(r.segments.length,2);assert.deepEqual(r.segments.map(s=>s.tool),[1,0]);
});
test('auxiliary macros preserve geometry but do not inflate model layers',()=>{
 const r=parse('M83\n; FEATURE: Custom\nG1 Z5\nG1 X10 E1\n; FEATURE: Outer wall\nG1 Z.2\nG1 X20 E1\n; FLUSH_START\nG1 X30 E1\n; FLUSH_END\n; WIPE_TOWER_START\nG1 X40 E1\n; WIPE_TOWER_END\nG1 X50 E1');assert.equal(r.layers,1);assert.deepEqual(r.segments.map(s=>s.auxiliary),[true,false,true,true,false]);assert.equal(r.modelTotal,20);
});
test('metadata colors keep empty slots and printable area is measured',()=>{
 const r=parse('; filament_colour = #ff0000;;#0000ff\n; printable_area = 0x0,180x0,180x180,0x180\nM83\nG1 Z.2\nG1 X10 E1');assert.deepEqual(r.colors,['#ff0000',null,'#0000ff']);assert.deepEqual(r.bed,{width:180,depth:180,minX:0,minY:0,maxX:180,maxY:180});
});

test('rounded I/J endpoint meets the next line exactly',()=>{
 const r=parse('M83\nG1 X1 Y0 Z.2\nG3 X0 Y1 I-1.0001 J0 E1\nG1 X-1 Y1 E1');const a=r.segments.at(-2),b=r.segments.at(-1);assert.deepEqual(a.b,b.a);assert.equal(a.pathId,b.pathId);
});

test('a retraction records one seam blob at the end of the last bead, wipe-retracts count once',()=>{
 const r=parse('M83\n; FEATURE: Outer wall\nG1 Z.2\nG1 X10 Y0 E1\nG1 X10 Y10 E1\nG1 X9 Y9 E-.3\nG1 X8 Y8 E-.3\nG1 X20 Y20\nG1 E.6\nG1 X30 Y20 E1');
 assert.equal(r.retracts.length,1);const b=r.retracts[0];
 assert.deepEqual(b.p,[10,10,.2]);assert.deepEqual(b.dir,[0,1]);assert.equal(b.feature,'Outer wall');assert.equal(b.end,r.segments[1].end);
 assert.equal(r.segments.length,3);
});
test('travel-only retractions far from the last bead leave no blob',()=>{
 const r=parse('M83\nG1 Z.2\nG1 X10 E1\nG1 X50 Y50\nG1 E-.8');assert.equal(r.retracts.length,0);
});
test('packed transfer round-trips segments, retractions and metadata exactly',()=>{
 const r=parse('; filament_colour = #ff0000;#00ff00\nM83\n; FEATURE: Outer wall\nG1 Z.2\nG1 X10 E1\nG1 Y10 E1\nG1 E-1\nT1\nG1 X0 E2\nG1 E-1');
 const p=pack(r);assert.equal(transferables(p).length,4);
 const u=unpack(structuredClone(p));
 assert.deepEqual(u.segments,r.segments);assert.deepEqual(u.retracts,r.retracts);assert.equal(u.layers,r.layers);assert.deepEqual(u.colors,r.colors);
});
test('simplify merges collinear moves of one bead but keeps corners, paths and timing',()=>{
 const r=parse('M83\nG1 Z.2\nG1 X1 E.1\nG1 X2 E.1\nG1 X3.001 Y.001 E.1\nG1 X3 Y5 E.5\nG1 E-1\nG1 X4 Y5\nG1 E1\nG1 X5 Y5 E.1');
 const s=simplify(r.segments,.01);
 assert.equal(s.length,3);
 assert.deepEqual(s[0].b,[3.001,.001,.2]);assert.equal(s[0].end,r.segments[2].end);
 assert.equal(s.at(-1).end,r.segments.at(-1).end);assert.notEqual(s[1].pathId,s[2].pathId);
});

const realFile=new URL('../小船_PLA_42m30s.gcode',import.meta.url);
test('provided Bambu boat has 240 model layers and 180 mm bed', {skip:!existsSync(realFile)},()=>{
 const r=parse(readFileSync(realFile,'utf8'));
 assert.equal(r.layers,240);assert.equal(r.bed.width,180);assert.equal(r.bed.depth,180);
 const model=r.segments.filter(s=>!s.auxiliary);
 const bounds=model.reduce((box,s)=>{for(const p of [s.a,s.b])for(let i=0;i<3;i++){box.min[i]=Math.min(box.min[i],p[i]);box.max[i]=Math.max(box.max[i],p[i]);}return box;},{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
 assert.ok(Math.abs(bounds.max[0]-bounds.min[0]-59.6)<.1);
 assert.ok(Math.abs(bounds.max[1]-bounds.min[1]-30.6)<.1);
 assert.equal(bounds.max[2],48);
 assert.ok(r.modelTotal<r.total);
 assert.ok(r.segments.every(s=>s.a.every(Number.isFinite)&&s.b.every(Number.isFinite)));
});
