import * as THREE from 'three';

const VISIBLE_FEATURE=/outer|overhang|external|perimeter|外墙|悬垂|模型/i;
const HIDDEN_FEATURE=/support|支撑/i;

/** Retractions that leave a visible seam blob on the outside of the print. */
export function visibleRetracts(retracts,{support=true}={}){
 return retracts.filter(r=>VISIBLE_FEATURE.test(r.feature)&&(support||!HIDDEN_FEATURE.test(r.feature)));
}

/**
 * One InstancedMesh per tool, instances ordered by extrusion time so the
 * animation only adjusts `count`. Slicers print contours counter-clockwise and
 * holes clockwise, so the right-hand normal of the last move points away from
 * the material in both cases.
 */
const fract=v=>v-Math.floor(v);

export function buildBlobs(retracts,materials,{size=1,detail=12}={}){
 const geometry=new THREE.SphereGeometry(1,detail,Math.max(4,Math.round(detail*.6)));
 const byTool=new Map();
 for(const r of retracts){if(!byTool.has(r.tool))byTool.set(r.tool,[]);byTool.get(r.tool).push(r);}
 const meshes=[],matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3(),z=new THREE.Vector3(0,0,1);
 for(const [tool,list] of byTool){
  const material=materials[tool]||materials[0];if(!material)continue;
  const mesh=new THREE.InstancedMesh(geometry,material,list.length);
  const ends=new Float64Array(list.length);
  list.forEach((r,i)=>{
   const w=r.width,h=r.height,nx=r.dir[1],ny=-r.dir[0];
   // Oozed blobs are rounded balls roughly a bead wide, centred on the outer
   // wall so about half the ball stands proud of the surface.
   const jitter=.8+.4*fract(Math.sin(r.p[0]*12.9898+r.p[1]*78.233+r.p[2]*37.719)*43758.5453);
   const radius=w*.46*size*jitter,offset=w*.5-radius*.12;
   pos.set(r.p[0]+nx*offset,r.p[1]+ny*offset,r.p[2]-h*.5);
   quat.setFromAxisAngle(z,Math.atan2(r.dir[1],r.dir[0]));
   scale.set(radius*1.12,radius,radius*.9);
   matrix.compose(pos,quat,scale);mesh.setMatrixAt(i,matrix);ends[i]=r.end;
  });
  mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=false;
  mesh.userData={ends};meshes.push(mesh);
 }
 return {meshes,geometry,count:retracts.length};
}

export function updateBlobs(blobs,limit){
 for(const mesh of blobs.meshes){const ends=mesh.userData.ends;let lo=0,hi=ends.length;while(lo<hi){const mid=(lo+hi)>>>1;if(ends[mid]<=limit)lo=mid+1;else hi=mid;}mesh.count=lo;}
}
