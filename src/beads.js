import {BufferAttribute, BufferGeometry} from 'three';

// Number of samples around both rounded sides. Two additional vertices form
// the genuinely flat crown and underside; these are not elliptical tubes.
export const QUALITY_LEVELS = Object.freeze({low:4, medium:8, high:12, ultra:16});
const EPS=1e-5;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function direction(s){const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],len=Math.hypot(dx,dy);return [dx/len,dy/len,len];}
function compatible(a,b){
 if(a.tool!==b.tool||a.feature!==b.feature||Math.abs(a.width-b.width)>EPS||Math.abs(a.height-b.height)>EPS||distance(a.b,b.a)>EPS)return false;
 if((a.pathId!==undefined||b.pathId!==undefined)&&a.pathId!==b.pathId)return false;
 if((a.chain!==undefined||b.chain!==undefined)&&a.chain!==b.chain)return false;
 const da=direction(a),db=direction(b);return da[0]*db[0]+da[1]*db[1]>-.95;
}
function valid(s){return s&&s.a?.length===3&&s.b?.length===3&&s.a.every(Number.isFinite)&&s.b.every(Number.isFinite)&&Number.isFinite(s.end)&&Number.isFinite(s.width)&&Number.isFinite(s.height)&&Number.isInteger(s.tool)&&s.tool>=0&&s.width>0&&s.height>0&&Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1])>1e-8;}

/**
 * Build small indexed meshes, ordered by the original G-code chronology.
 * Positions are in printer coordinates, with the top of each bead at G-code Z.
 * A continuous path shares rings at turns. Chunks duplicate boundary rings with
 * identical coordinates/normals but do not add internal cap faces.
 *
 * Returns {chunks:[{geometry,tool,ends,indexEnds}],stats}. To animate, call
 * updateBeadDrawRange(chunk, cumulativeExtrusionPathLength).
 */
export function buildBeadChunks(segments,options={}){
 const quality=typeof options.quality==='number'?options.quality:QUALITY_LEVELS[options.quality??'medium'];
 if(!Number.isFinite(quality)||quality<4||quality>64)throw Error('Unknown bead quality');
 const arcSteps=Math.max(2,Math.round(quality/2)),ringSize=2*(arcSteps+1);
 const widthScale=options.widthScale??1,layerGap=options.layerGap??.008;
 const maxSegments=Math.max(1,Math.floor(options.maxSegmentsPerChunk??2048)),miterLimit=options.miterLimit??2;
 if(!Number.isFinite(maxSegments)||!Number.isFinite(miterLimit)||miterLimit<1)throw Error('Invalid bead chunk or miter limit');
 if(!Number.isFinite(widthScale)||widthScale<=0||!Number.isFinite(layerGap)||layerGap<0)throw Error('Invalid bead dimensions');
 const indices=[];
 for(let i=0;i<segments.length;i++){const s=segments[i];if(options.include&&!options.include(s))continue;if(!valid(s))throw Error(`Invalid extrusion segment ${i}`);if(indices.length&&s.end<segments[indices.at(-1)].end)throw Error('Extrusion path timestamps must be ordered');indices.push(i);}
 const prev=new Int32Array(indices.length).fill(-1),next=new Int32Array(indices.length).fill(-1);
 const stats={segments:indices.length,paths:0,triangles:0,vertices:0,bytes:0,profileVertices:ringSize};
 // Connect only actual adjacent source moves, never across filtered paths.
 for(let i=1;i<indices.length;i++)if(indices[i]===indices[i-1]+1&&compatible(segments[indices[i-1]],segments[indices[i]])){prev[i]=i-1;next[i-1]=i;}
 for(let start=0;start<indices.length;){let end=start;while(next[end]>=0)end=next[end];stats.paths++;
  // Close a perimeter with the same miter at both copies of its seam ring.
  if(end-start>=2&&compatible(segments[indices[end]],segments[indices[start]])){prev[start]=end;next[end]=start;}
  start=end+1;
 }
 const profile=[];
 for(let side=0;side<2;side++)for(let j=0;j<=arcSteps;j++){const angle=-Math.PI/2+side*Math.PI+j/arcSteps*Math.PI;profile.push([Math.cos(angle),Math.sin(angle),side===0?1:-1]);}
 const chunks=[];
 for(let start=0;start<indices.length;){let end=start+1;const tool=segments[indices[start]].tool;
  while(end<indices.length&&end-start<maxSegments&&segments[indices[end]].tool===tool)end++;
  let rings=0,caps=0;for(let i=start;i<end;i++){rings+=1+(i>start&&prev[i]===i-1?0:1);if(prev[i]===-1)caps++;if(next[i]===-1)caps++;}
  const vertexCount=rings*ringSize+caps*(ringSize+1),indexCount=(end-start)*ringSize*6+caps*ringSize*3;
  const positions=new Float32Array(vertexCount*3),normals=new Float32Array(vertexCount*3),faces=new Uint32Array(indexCount);
  const ends=new Float64Array(end-start),indexEnds=new Uint32Array(end-start);
  let v=0,f=0,previousEndRing=-1;
  function addRing(point,s,other){
   const dir=direction(s);let nx=-dir[1],ny=dir[0],scale=1;
   if(other){const od=direction(other),ox=-od[1],oy=od[0],mx=nx+ox,my=ny+oy,len=Math.hypot(mx,my);if(len>EPS){nx=mx/len;ny=my/len;scale=Math.min(miterLimit,1/Math.max(.1,nx*(-dir[1])+ny*dir[0]));}}
   const width=s.width*widthScale,displayHeight=Math.max(s.height*.5,s.height-Math.min(layerGap,s.height*.25));
   const rx=Math.min(width,displayHeight)/2,ry=displayHeight/2,flat=Math.max(0,(width-displayHeight)/2),centerZ=point[2]-s.height/2;
   const first=v;
   for(const [c,sn,side]of profile){const u=side*flat+c*rx;positions[v*3]=point[0]+nx*u*scale;positions[v*3+1]=point[1]+ny*u*scale;positions[v*3+2]=centerZ+sn*ry;
    let nu=c/rx/scale,nz=sn/ry;const length=Math.hypot(nu,nz);nu/=length;nz/=length;normals[v*3]=nx*nu;normals[v*3+1]=ny*nu;normals[v*3+2]=nz;v++;
   }return first;
  }
  function addCap(ring,s,atStart){
   const dir=direction(s),sign=atStart?-1:1,first=v;let cx=0,cy=0,cz=0;
   for(let j=0;j<ringSize;j++){const old=(ring+j)*3;positions[v*3]=positions[old];positions[v*3+1]=positions[old+1];positions[v*3+2]=positions[old+2];cx+=positions[old];cy+=positions[old+1];cz+=positions[old+2];normals[v*3]=dir[0]*sign;normals[v*3+1]=dir[1]*sign;v++;}
   const middle=v;positions[v*3]=cx/ringSize;positions[v*3+1]=cy/ringSize;positions[v*3+2]=cz/ringSize;normals[v*3]=dir[0]*sign;normals[v*3+1]=dir[1]*sign;v++;
   for(let j=0;j<ringSize;j++){const k=(j+1)%ringSize;faces[f++]=middle;faces[f++]=first+(atStart?k:j);faces[f++]=first+(atStart?j:k);}
  }
  for(let i=start;i<end;i++){
   const s=segments[indices[i]],before=prev[i]<0?null:segments[indices[prev[i]]],after=next[i]<0?null:segments[indices[next[i]]];
   const a=i>start&&prev[i]===i-1?previousEndRing:addRing(s.a,s,before);
   if(prev[i]===-1)addCap(a,s,true);
   const b=addRing(s.b,s,after);previousEndRing=b;
   for(let j=0;j<ringSize;j++){const k=(j+1)%ringSize;faces[f++]=a+j;faces[f++]=a+k;faces[f++]=b+j;faces[f++]=a+k;faces[f++]=b+k;faces[f++]=b+j;}
   if(next[i]===-1)addCap(b,s,false);
   ends[i-start]=s.end;indexEnds[i-start]=f;
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('normal',new BufferAttribute(normals,3));geometry.setIndex(new BufferAttribute(faces,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  chunks.push({geometry,tool,ends,indexEnds});stats.vertices+=vertexCount;stats.triangles+=indexCount/3;stats.bytes+=positions.byteLength+normals.byteLength+faces.byteLength+ends.byteLength+indexEnds.byteLength;
  start=end;
 }
 return {chunks,stats};
}

/** Show completed extrusion segments without rebuilding or reuploading meshes. */
export function updateBeadDrawRange(chunk,pathLimit){
 let lo=0,hi=chunk.ends.length;while(lo<hi){const mid=(lo+hi)>>>1;if(chunk.ends[mid]<=pathLimit)lo=mid+1;else hi=mid;}
 const count=lo?chunk.indexEnds[lo-1]:0;chunk.geometry.setDrawRange(0,count);return count;
}
