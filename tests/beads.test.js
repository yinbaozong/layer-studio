import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBeadChunks, updateBeadDrawRange, QUALITY_LEVELS} from '../src/beads.js';
function seg(a,b,end,overrides={}){return {a,b,end,width:.45,height:.2,tool:0,feature:'Outer wall',...overrides};}
const straight=[seg([0,0,.2],[10,0,.2],10),seg([10,0,.2],[20,0,.2],20)];
test('continuous chains share one cross-section ring per junction',()=>{
 const a=buildBeadChunks(straight,{quality:'medium',layerGap:0});
 const b=buildBeadChunks(straight.map((s,i)=>({...s,pathId:i})),{quality:'medium',layerGap:0});
 assert.equal(a.chunks.length,1);assert.equal(a.stats.paths,1);assert.equal(b.stats.paths,2);
 assert.ok(a.stats.vertices<b.stats.vertices);assert.equal(a.chunks[0].ends.length,2);
 const g=a.chunks[0].geometry;g.computeBoundingBox();assert.ok(Math.abs(g.boundingBox.max.y-.225)<1e-6);assert.ok(Math.abs(g.boundingBox.max.z-.2)<1e-6);assert.ok(Math.abs(g.boundingBox.min.z)<1e-6);
});
test('stadium has a flat crown, finite unit normals and outward triangle winding',()=>{
 const {geometry:g}=buildBeadChunks(straight,{quality:'high',layerGap:0}).chunks[0];
 const p=g.attributes.position.array,n=g.attributes.normal.array,idx=g.index.array;
 let flatTop=0;for(let i=0;i<p.length;i+=3){assert.ok(Number.isFinite(p[i]+p[i+1]+p[i+2]));assert.ok(Math.abs(Math.hypot(n[i],n[i+1],n[i+2])-1)<1e-5);if(Math.abs(p[i+2]-.2)<1e-6&&Math.abs(n[i+2]-1)<1e-6)flatTop++;}assert.ok(flatTop>=4);
 for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3;const ab=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],ac=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];assert.ok(cross[0]*n[a]+cross[1]*n[a+1]+cross[2]*n[a+2]>=-1e-8);}
});
test('closed end caps produce watertight full geometry',()=>{
 const g=buildBeadChunks(straight,{quality:'low'}).chunks[0].geometry,p=g.attributes.position.array,idx=g.index.array,edges=new Map();
 const key=v=>[p[v*3],p[v*3+1],p[v*3+2]].map(x=>x.toFixed(5)).join(',');
 for(let i=0;i<idx.length;i+=3)for(const [a,b]of [[idx[i],idx[i+1]],[idx[i+1],idx[i+2]],[idx[i+2],idx[i]]]){const e=[key(a),key(b)].sort().join('|');edges.set(e,(edges.get(e)||0)+1);}
 assert.ok([...edges.values()].every(n=>n===2));
});
test('same-layer tool changes preserve independent material chunks and draw order',()=>{
 const chunks=buildBeadChunks([straight[0],{...straight[1],tool:1},seg([20,0,.2],[30,0,.2],30)],{quality:'low'}).chunks;
 assert.deepEqual(chunks.map(c=>c.tool),[0,1,0]);
 for(const c of chunks)updateBeadDrawRange(c,15);
 assert.equal(chunks[0].geometry.drawRange.count,chunks[0].geometry.index.count);assert.equal(chunks[1].geometry.drawRange.count,0);assert.equal(chunks[2].geometry.drawRange.count,0);
});
test('chunk budgets and sharp turn handling keep geometry finite',()=>{
 const paths=[seg([0,0,.2],[10,0,.2],10),seg([10,0,.2],[.001,.001,.2],20),seg([.001,.001,.2],[10,10,.2],35)];
 const result=buildBeadChunks(paths,{quality:'ultra',maxSegmentsPerChunk:1});assert.equal(result.chunks.length,3);
 for(const c of result.chunks){assert.ok([...c.geometry.attributes.position.array].every(Number.isFinite));assert.equal(c.ends.length,1);}
 assert.ok(QUALITY_LEVELS.ultra>QUALITY_LEVELS.low);
});
test('filtering a segment breaks connectivity without changing path timestamps',()=>{
 const segments=[...straight,seg([20,0,.2],[30,0,.2],30)];const r=buildBeadChunks(segments,{include:s=>s.end!==20});assert.equal(r.stats.segments,2);assert.equal(r.stats.paths,2);assert.deepEqual(Array.from(r.chunks[0].ends),[10,30]);
 const c=r.chunks[0];updateBeadDrawRange(c,10);assert.equal(c.geometry.drawRange.count,c.indexEnds[0]);updateBeadDrawRange(c,Infinity);assert.equal(c.geometry.drawRange.count,c.geometry.index.count);
});
test('closed square perimeter uses a shared miter at its seam without end caps',()=>{
 const lines=[seg([0,0,.2],[10,0,.2],10),seg([10,0,.2],[10,10,.2],20),seg([10,10,.2],[0,10,.2],30),seg([0,10,.2],[0,0,.2],40)];
 const r=buildBeadChunks(lines,{quality:'medium',layerGap:0}),g=r.chunks[0].geometry,p=g.attributes.position.array,ring=r.stats.profileVertices;
 assert.equal(r.stats.vertices,5*ring);assert.equal(r.stats.triangles,4*ring*2);
 for(let j=0;j<ring*3;j++)assert.equal(p[j],p[4*ring*3+j]);
});
test('draft profile uses four vertices and still covers most of the bead width',()=>{
 const r=buildBeadChunks(straight,{quality:'draft',layerGap:0}),p=r.chunks[0].geometry.attributes.position.array;
 assert.equal(r.stats.profileVertices,4);
 let maxY=0;for(let i=1;i<p.length;i+=3)maxY=Math.max(maxY,Math.abs(p[i]));
 assert.ok(maxY>.45*.4&&maxY<=.225+1e-6);assert.ok([...p].every(Number.isFinite));
});
test('rejects nonfinite dimensions before GPU buffer allocation',()=>{
 assert.throws(()=>buildBeadChunks([{...straight[0],width:Infinity}]),/Invalid extrusion/);
});
