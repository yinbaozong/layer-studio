import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {unzipSync,strFromU8} from 'fflate';
import {probeEncoding,exportVideo,RESOLUTIONS} from './exporter.js';
import {buildBeadChunks,updateBeadDrawRange} from './beads.js';
import {buildBlobs,updateBlobs,visibleRetracts} from './blobs.js';
import {createBuildPlate} from './plate.js';
import {createSceneSet,SCENES} from './scenes.js';
import {createPipeline} from './render.js';
import {sample,unpack} from './parser.js';

const $=id=>document.getElementById(id),stage=$('stage');
let dirty=true,sampleIndex=0,interacting=false;
const markDirty=()=>{dirty=true;};
document.addEventListener('input',markDirty);document.addEventListener('change',markDirty);

const previewPixelRatio=Math.min(window.devicePixelRatio||1,2);
const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(previewPixelRatio);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
// Khronos PBR Neutral keeps filament colours true and rolls highlights off gently.
renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
stage.prepend(renderer.domElement);

const scene=new THREE.Scene();scene.background=new THREE.Color('#c9ccd0');
const camera=new THREE.PerspectiveCamera(32,1,.5,4000);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.495;

const hemi=new THREE.HemisphereLight('#eef3f8','#7d756c',.55);hemi.position.set(0,0,1);scene.add(hemi);
const key=new THREE.DirectionalLight('#fff4e6',2.4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);scene.add(key);scene.add(key.target);
const fill=new THREE.DirectionalLight('#c9defa',.55);scene.add(fill);
const rim=new THREE.DirectionalLight('#ffffff',1.1);scene.add(rim);

const sceneSet=createSceneSet(renderer,scene);
const plate=createBuildPlate(renderer,markDirty);scene.add(plate.group);
const model=new THREE.Group();scene.add(model);
const pipeline=createPipeline(renderer,scene,camera);

let data=null,meshes=[],blobs=null,materials=[],bounds=new THREE.Box3(),center=new THREE.Vector3(),size=new THREE.Vector3(50,50,30),keys=[],base=null,playing=false,last=performance.now(),exporting=false,cancelled=false,currentName='三色花瓶 · 示例',shadowR=60;
const notice=s=>{$('notice').textContent=s;$('notice').style.display='block';clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').style.display='none',8000);};

// ── Scenes & lighting ────────────────────────────────────────────────
$('scene').replaceChildren(...Object.entries(SCENES).map(([value,s])=>{const o=document.createElement('option');o.value=value;o.textContent=s.label;return o;}));
function setBackground(color){scene.background.set(color);sceneSet.setBackground(color);dirty=true;}
function applyScene(name,{keepBackground=false}={}){
 const s=sceneSet.apply(name);
 if(!keepBackground)$('background').value=s.bg;
 setBackground($('background').value);applyLighting();applyEffects();
}
function applyLighting(){
 const s=sceneSet.current,mode=$('lighting').value;
 hemi.color.set(s.hemi[0]);hemi.groundColor.set(s.hemi[1]);hemi.intensity=s.hemi[2];
 key.color.set(s.key[0]);key.intensity=s.key[1];fill.color.set(s.fill[0]);fill.intensity=s.fill[1];rim.color.set(s.rim[0]);rim.intensity=s.rim[1];
 if(mode==='dramatic'){key.intensity*=1.3;fill.intensity*=.2;hemi.intensity*=.4;rim.intensity*=1.35;}
 if(mode==='warm'){key.color.lerp(new THREE.Color('#ffbf78'),.55);fill.color.lerp(new THREE.Color('#ffd9b0'),.4);hemi.color.lerp(new THREE.Color('#ffd7a8'),.5);}
 if(mode==='cool'){key.color.lerp(new THREE.Color('#b9d0ff'),.6);key.intensity*=.85;rim.color.lerp(new THREE.Color('#8fb6ff'),.6);hemi.intensity*=.7;}
 dirty=true;
}
function applyEffects(){
 const s=sceneSet.current,bloom=pipeline.bloom,amount=+$('bloom').value;
 bloom.enabled=!!s.bloom&&amount>0;
 if(s.bloom){bloom.strength=s.bloom.strength*amount;bloom.radius=s.bloom.radius;bloom.threshold=s.bloom.threshold;}
 pipeline.options.vignette=s.vignette*+$('vignette').value;
 dirty=true;
}
function applySoftness(){
 const v=+$('softness').value;
 key.shadow.radius=1+v*.6;
 pipeline.options.lightRadius=v*.035*key.position.distanceTo(key.target.position);
 dirty=true;
}

// ── Filament materials ───────────────────────────────────────────────
const FINISHES={
 matte:{roughness:.82,metalness:0,clearcoat:0,clearcoatRoughness:.5,sheen:.35,specularIntensity:.32},
 satin:{roughness:.5,metalness:0,clearcoat:.12,clearcoatRoughness:.45,sheen:0,specularIntensity:.5},
 gloss:{roughness:.2,metalness:0,clearcoat:.6,clearcoatRoughness:.12,sheen:0,specularIntensity:.75},
 silk:{roughness:.3,metalness:.38,clearcoat:.25,clearcoatRoughness:.2,sheen:.6,specularIntensity:1},
 basic:{roughness:.62,metalness:0,clearcoat:.05,clearcoatRoughness:.5,sheen:.15,specularIntensity:.42},
};
function material(color){return new THREE.MeshPhysicalMaterial({color,roughness:.5,metalness:0,clearcoat:.12,clearcoatRoughness:.45,sheenRoughness:.7});}
function updateMaterials(){const f=FINISHES[$('finish').value]||FINISHES.satin;materials.forEach(m=>{Object.assign(m,f);m.sheenColor.copy(m.color).lerp(new THREE.Color('#ffffff'),.5);});syncBlobMaterials();dirty=true;}
// Retraction blobs are filament that oozed and re-melted without being laid
// into a bead, so they are slightly glossier than the layered wall around them.
let blobMaterials=[];
function syncBlobMaterials(){
 while(blobMaterials.length<materials.length)blobMaterials.push(new THREE.MeshPhysicalMaterial({sheenRoughness:.7}));
 materials.forEach((m,i)=>{const b=blobMaterials[i];b.color.copy(m.color);b.roughness=Math.max(.16,m.roughness*.6);b.metalness=m.metalness;b.clearcoat=Math.max(m.clearcoat,.35);b.clearcoatRoughness=.2;b.sheen=m.sheen;b.sheenColor.copy(m.sheenColor);b.specularIntensity=Math.max(m.specularIntensity,.6);});
}

// ── Geometry ─────────────────────────────────────────────────────────
const AUX=/purge|flush|wipe|prime|skirt|brim|tower|custom/i;
function releaseArray(){this.array=null;}
const blobMaterial=new THREE.MeshPhysicalMaterial({color:'#f4f4f0',roughness:.45,clearcoat:.2,emissive:'#ffffff',emissiveIntensity:.08});
function rebuildBlobs(){
 if(blobs){for(const m of blobs.meshes)model.remove(m);blobs.geometry.dispose();blobs=null;}
 $('retractStats').textContent='';
 if(!data||!$('retract').checked){dirty=true;return;}
 const list=visibleRetracts(data.retracts||[],{support:$('support').checked});
 const mode=$('retractColor').value;
 if(mode!=='filament')blobMaterial.color.set(mode==='red'?'#ff3b30':'#f4f4f0');
 syncBlobMaterials();
 blobs=buildBlobs(list,mode==='filament'?blobMaterials:materials.map(()=>blobMaterial),{size:+$('retractSize').value});
 for(const m of blobs.meshes)model.add(m);
 $('retractStats').textContent=list.length?`${list.length.toLocaleString()} 个外壁回抽点（共 ${(data.retracts||[]).length.toLocaleString()} 次回抽）`:'文件中没有检测到外壁回抽点。';
 evaluate(+$('timeline').value);
}
function rebuild(){
 dirty=true;if(!data)return;
 for(const m of meshes){m.geometry.dispose();model.remove(m);}meshes=[];
 const visible=data.segments.filter(s=>($('purge').checked||(!s.auxiliary&&!AUX.test(s.feature)))&&($('support').checked||!/support/i.test(s.feature)));
 const quality=$('quality').value==='auto'?(visible.length>3000000?'draft':visible.length>600000?'low':visible.length>150000?'medium':'high'):$('quality').value;
 const result=buildBeadChunks(visible,{quality,widthScale:+$('beadWidth').value,layerGap:+$('layerGap').value});
 for(const chunk of result.chunks){
  // Draw ranges never touch vertex data again, so the CPU copies (GBs on big
  // prints) are dropped as soon as WebGL owns the buffers.
  const g=chunk.geometry;g.index.onUpload(releaseArray);for(const a of Object.values(g.attributes))a.onUpload(releaseArray);
  const m=new THREE.Mesh(g,materials[chunk.tool]);m.castShadow=true;m.receiveShadow=true;m.userData=chunk;model.add(m);meshes.push(m);}
 $('meshStats').textContent=`${(result.stats.triangles/1000000).toFixed(2)}M 三角形 · ${quality}`;
 model.position.set(-center.x,-center.y,0);updateMaterials();rebuildBlobs();evaluate(+$('timeline').value);
 $('stats').textContent=`${data.layers} 层 · ${(data.segments.length/1000).toFixed(1)}k 段 · ${materials.length} 色`;
}

// ── Timeline & camera ────────────────────────────────────────────────
function snapshot(){return {position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov};}
function useView(v){camera.position.fromArray(v.position);controls.target.fromArray(v.target);camera.fov=v.fov;camera.updateProjectionMatrix();camera.lookAt(controls.target);}
function captureBase(){base=snapshot();}
function progressAt(t){const duration=+$('duration').value;return THREE.MathUtils.clamp((t*duration-.5)/(duration-2.5),0,1);}
function evaluate(t){
 if(!data)return;let p=progressAt(t),limit=data.total*p;
 if($('growth').value==='layer'&&p<1){const idx=data.segments.findIndex(s=>s.end>=limit);const target=data.segments[Math.max(0,idx)]?.b[2]||0;let k=Math.max(0,idx);while(k>0&&Math.abs(data.segments[k-1].b[2]-target)<.001)k--;limit=k?data.segments[k-1].end:0;}
 for(const m of meshes)updateBeadDrawRange(m.userData,limit);
 if(blobs)updateBlobs(blobs,limit);
 const mode=$('camera').value;
 if(mode==='keys'&&keys.length){const sorted=[...keys].sort((a,b)=>a.t-b.t);let a=sorted[0],b=sorted.at(-1);if(t<=a.t)b=a;else if(t>=b.t)a=b;else for(let i=1;i<sorted.length;i++)if(sorted[i].t>=t){a=sorted[i-1];b=sorted[i];break;}let f=b.t===a.t?0:(t-a.t)/(b.t-a.t);f=f*f*(3-2*f);const av=new THREE.Vector3().fromArray(a.position),bv=new THREE.Vector3().fromArray(b.position),at=new THREE.Vector3().fromArray(a.target),bt=new THREE.Vector3().fromArray(b.target);const as=new THREE.Spherical().setFromVector3(new THREE.Vector3(av.x-at.x,av.z-at.z,av.y-at.y)),bs=new THREE.Spherical().setFromVector3(new THREE.Vector3(bv.x-bt.x,bv.z-bt.z,bv.y-bt.y));let angle=bs.theta-as.theta;angle=Math.atan2(Math.sin(angle),Math.cos(angle));const sp=new THREE.Spherical(THREE.MathUtils.lerp(as.radius,bs.radius,f),THREE.MathUtils.lerp(as.phi,bs.phi,f),as.theta+angle*f);const v=new THREE.Vector3().setFromSpherical(sp);controls.target.copy(at.lerp(bt,f));camera.position.copy(controls.target).add(new THREE.Vector3(v.x,v.z,v.y));camera.fov=THREE.MathUtils.lerp(a.fov,b.fov,f);camera.updateProjectionMatrix();camera.lookAt(controls.target);}
 else if(base){useView(base);if(mode!=='fixed'){const offset=camera.position.clone().sub(controls.target);const angle=THREE.MathUtils.degToRad(+$('orbit').value)*t;offset.applyAxisAngle(new THREE.Vector3(0,0,1),angle);if(mode==='rise'){const end=data.segments.findIndex(s=>s.end>=limit);const height=p>=1?size.z:(data.segments[Math.max(0,end)]?.b[2]||0);controls.target.z=Math.max(2,height*.55);offset.z+=height*.12;}camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);}}
 camera.updateMatrixWorld();
 const o=pipeline.options;o.dof=$('dof').checked;o.focus.copy(controls.target);o.aperture=+$('aperture').value*.012*camera.position.distanceTo(controls.target);
 $('time').textContent=`${(t*+$('duration').value).toFixed(1)} / ${+$('duration').value}.0 s`;$('layer').textContent=`${Math.round(p*100)}%`;
 dirty=true;
}
// A tight orthographic frustum keeps shadow texel density high on the print.
function fitShadowCamera(){
 // Bounding-sphere radius: tall prints must stay inside the light frustum too.
 const r=size.length()*.52+6;shadowR=r;
 const cam=key.shadow.camera;cam.left=-r;cam.right=r;cam.top=r;cam.bottom=-r;cam.near=Math.max(1,r*.5);cam.far=r*6+200;cam.updateProjectionMatrix();
 key.target.position.set(0,0,size.z*.4);key.position.set(-r*1.15,-r*1.5,size.z+r*2.6);
 fill.position.set(r*1.4,r*.25,r*.8);rim.position.set(r*.25,r*1.7,r*1.5);
 key.shadow.normalBias=.02;key.shadow.bias=-.0001;
 pipeline.options.light=key;applySoftness();
}
function setShadowMap(px){if(key.shadow.map?.width===px)return;key.shadow.map?.dispose();key.shadow.map=null;key.shadow.mapSize.set(px,px);}
let exportPixelRatio=null;
function resize(w=stage.clientWidth,h=stage.clientHeight){
 renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
 // Keep the internal buffer near ≥900 px wide so single-sample playback stays clean.
 const ratio=exportPixelRatio??Math.min(previewPixelRatio*THREE.MathUtils.clamp(900/Math.max(1,w),1.25,2),2);
 pipeline.setSize(w,h,ratio);dirty=true;
}
new ResizeObserver(()=>{if(!exporting)resize();}).observe(stage);

function frame(){
 requestAnimationFrame(frame);const now=performance.now();
 if(!exporting){
  if(playing){let t=+$('timeline').value+(now-last)/1000/+$('duration').value;if(t>=1){t=1;playing=false;$('play').textContent='▶';}$('timeline').value=t;evaluate(t);}
  const target=+$('previewSamples').value;
  if(dirty){pipeline.renderSample(0);sampleIndex=1;pipeline.present();dirty=false;$('samples').textContent='';}
  else if(!interacting&&!playing&&sampleIndex<target){pipeline.renderSample(sampleIndex++);pipeline.present();$('samples').textContent=sampleIndex<target?`抗锯齿 ${sampleIndex}/${target}`:`✓ ${target}× 采样`;}
 }
 last=now;
}
controls.addEventListener('change',markDirty);
controls.addEventListener('start',()=>{interacting=true;playing=false;$('play').textContent='▶';});
controls.addEventListener('end',()=>{interacting=false;captureBase();});

// ── Loading ──────────────────────────────────────────────────────────
/** `source` is G-code text or its raw bytes (transferred to the worker, decoded there). */
async function loadGcode(source,name,palette=[]){
 playing=false;notice('正在解析挤出路径…');
 const t0=performance.now();
 const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 try{
  const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(unpack(data.result));worker.onerror=e=>reject(Error(e.message));if(typeof source==='string')worker.postMessage(source);else worker.postMessage(source,[source.buffer]);});
  data=result;currentName=name;$('filename').textContent=name;const t1=performance.now();
  bounds.makeEmpty();const v=new THREE.Vector3();
  for(const s of data.segments){if(s.auxiliary)continue;bounds.expandByPoint(v.fromArray(s.a));bounds.expandByPoint(v.fromArray(s.b));}
  if(bounds.isEmpty())for(const s of data.segments){bounds.expandByPoint(v.fromArray(s.a));bounds.expandByPoint(v.fromArray(s.b));}
  bounds.getCenter(center);bounds.getSize(size);fitShadowCamera();
  materials.forEach(m=>m.dispose());
  const count=data.segments.reduce((n,s)=>Math.max(n,s.tool),0)+1;
  materials=Array.from({length:count},(_,i)=>material(palette[i]||data.colors[i]||['#e88755','#e6d6b3','#398a90','#b7b2d9'][i%4]));
  $('palette').replaceChildren();
  materials.forEach((m,i)=>{const row=document.createElement('div'),input=document.createElement('input');input.type='color';input.value='#'+m.color.getHexString();input.oninput=()=>{m.color.set(input.value);m.sheenColor.copy(m.color).lerp(new THREE.Color('#ffffff'),.5);syncBlobMaterials();dirty=true;};const label=document.createElement('span');label.textContent=`耗材 ${i+1}`;row.append(input,label);$('palette').append(row);});
  const scale=Math.max(size.x,size.y,40),bedSize=data.bed?.width||256;
  const px=data.bed?(data.bed.minX+data.bed.maxX)/2-center.x:0,py=data.bed?(data.bed.minY+data.bed.maxY)/2-center.y:0;
  plate.setSize(bedSize);plate.setPosition(px,py);sceneSet.setBed(bedSize,px,py);
  const radius=Math.max(size.length()*.5,25),distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov*.5))*1.08;
  controls.target.set(0,0,size.z*.42);camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(.52,-.78,.36).normalize(),distance);
  camera.near=Math.max(.5,scale*.01);camera.far=Math.max(4000,scale*20);camera.updateProjectionMatrix();camera.lookAt(controls.target);
  captureBase();keys=[];renderKeys();$('timeline').value=1;rebuild();
  const t2=performance.now();
  notice(`已载入 ${data.layers} 层 · ${(data.retracts||[]).length.toLocaleString()} 次回抽 · 解析 ${((t1-t0)/1000).toFixed(1)} s · 建模 ${((t2-t1)/1000).toFixed(1)} s。${!palette.length&&!data.colors.length?'文件缺少配色，已使用可编辑示例颜色。':''}`);
 }catch(e){console.error(e);notice(e.message);}finally{worker.terminate();}
}
$('sample').onclick=()=>loadGcode(sample(),'三色花瓶 · 同层换色示例');$('open').onclick=()=>$('file').click();
async function loadFile(file){if(/\.3mf$/i.test(file.name)){const files=unzipSync(new Uint8Array(await file.arrayBuffer()));const paths=Object.keys(files).filter(k=>/\.gcode$/i.test(k));if(!paths.length)throw Error('这是未切片的 3MF，请先从 Bambu Studio 导出切片盘文件。');let path=paths[0];if(paths.length>1){const n=Number(prompt(paths.map((s,i)=>`${i+1}. ${s}`).join('\n')+'\n选择盘编号','1'));if(!Number.isInteger(n)||n<1||n>paths.length)return;path=paths[n-1];}let colors=[];const info=Object.keys(files).find(k=>/slice_info\.config$/.test(k));if(info){const xml=new DOMParser().parseFromString(strFromU8(files[info]),'text/xml');const id=path.match(/plate_(\d+)/)?.[1];const plateNode=[...xml.querySelectorAll('plate')].find(p=>[...p.querySelectorAll('metadata')].some(m=>m.getAttribute('key')==='index'&&m.getAttribute('value')===id));(plateNode||xml).querySelectorAll('filament').forEach(f=>{const c=f.getAttribute('color');if(c)colors[Number(f.getAttribute('id'))-1]=c;});}const config=Object.keys(files).find(k=>/project_settings\.config$/.test(k));if(config){try{const fallback=JSON.parse(strFromU8(files[config])).filament_colour||[];fallback.forEach((c,i)=>{if(!colors[i])colors[i]=c;});}catch{}}await loadGcode(files[path],file.name,colors);}else await loadGcode(new Uint8Array(await file.arrayBuffer()),file.name);}
$('file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await loadFile(file);}catch(err){notice(err.message);}e.target.value='';};

// ── Controls wiring ──────────────────────────────────────────────────
$('play').onclick=()=>{playing=!playing;if(playing&&+$('timeline').value>=1)$('timeline').value=0;$('play').textContent=playing?'Ⅱ':'▶';};
$('reset').onclick=()=>{$('timeline').value=0;evaluate(0);};
$('timeline').oninput=()=>{playing=false;$('play').textContent='▶';evaluate(+$('timeline').value);};
for(const id of ['quality','purge','support','beadWidth','layerGap'])$(id).onchange=rebuild;
for(const id of ['retract','retractSize','retractColor'])$(id).onchange=rebuildBlobs;
$('finish').onchange=updateMaterials;$('plateStyle').onchange=()=>plate.setStyle($('plateStyle').value);
$('scene').onchange=()=>applyScene($('scene').value);
$('background').oninput=()=>setBackground($('background').value);
$('bgReset').onclick=()=>{$('background').value=sceneSet.current.bg;setBackground(sceneSet.current.bg);};
$('lighting').onchange=applyLighting;$('softness').oninput=applySoftness;
$('exposure').oninput=()=>{renderer.toneMappingExposure=+$('exposure').value;dirty=true;};
for(const id of ['bloom','vignette'])$(id).oninput=applyEffects;
$('ao').onchange=()=>{pipeline.ao.enabled=$('ao').checked;dirty=true;};
for(const id of ['dof','aperture'])$(id).addEventListener('input',()=>evaluate(+$('timeline').value));
for(const id of ['camera','orbit','growth','duration'])$(id).addEventListener('input',()=>evaluate(+$('timeline').value));
// Live value read-outs next to sliders.
const readouts={beadWidth:v=>(+v).toFixed(2),retractSize:v=>(+v).toFixed(2),exposure:v=>(+v).toFixed(2),softness:v=>v,bloom:v=>(+v).toFixed(2),vignette:v=>(+v).toFixed(2),aperture:v=>(+v).toFixed(2),orbit:v=>v+'°'};
function syncReadouts(){for(const [id,fmt] of Object.entries(readouts))$(id+'Val').textContent=fmt($(id).value);}
for(const id of Object.keys(readouts))$(id).addEventListener('input',syncReadouts);

function renderKeys(){$('keys').replaceChildren();keys.sort((a,b)=>a.t-b.t).forEach((k,i)=>{const row=document.createElement('div');row.className='keyrow';const jump=document.createElement('button');jump.textContent=`${(k.t*100).toFixed(0)}% · 机位 ${i+1}`;jump.onclick=()=>{$('timeline').value=k.t;useView(k);captureBase();dirty=true;};const replace=document.createElement('button');replace.textContent='覆盖';replace.onclick=()=>{Object.assign(k,snapshot());};const del=document.createElement('button');del.textContent='×';del.onclick=()=>{keys.splice(i,1);renderKeys();};row.append(jump,replace,del);$('keys').append(row);});}
$('key').onclick=()=>{const t=+$('timeline').value;const existing=keys.find(k=>Math.abs(k.t-t)<.001);if(existing)Object.assign(existing,snapshot());else keys.push({t,...snapshot()});$('camera').value='keys';renderKeys();notice('机位已记录。移动时间轴，调整视角后可继续添加。');};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

const settings=['scene','background','plateStyle','beadWidth','layerGap','finish','quality','retract','retractSize','retractColor','purge','support','lighting','exposure','softness','bloom','vignette','ao','dof','aperture','previewSamples','camera','orbit','aaQuality','resolution','duration','growth'];
$('save').onclick=()=>download(new Blob([JSON.stringify({version:2,source:currentName,keys,base,colors:materials.map(m=>'#'+m.color.getHexString()),settings:Object.fromEntries(settings.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))},null,2)],{type:'application/json'}),'layer-studio.scene.json');
$('load').onclick=()=>$('sceneFile').click();
$('sceneFile').onchange=async e=>{try{const s=JSON.parse(await e.target.files[0].text());if(![1,2].includes(s.version)||!s.settings)throw Error('不支持的场景文件');for(const id of settings){const el=$(id),value=s.settings[id];if(value===undefined||(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===String(value))))continue;if(el.type==='checkbox')$(id).checked=!!s.settings[id];else el.value=value;}keys=s.keys||[];if(s.base)base=s.base;s.colors?.forEach((c,i)=>{materials[i]?.color.set(c);const input=$('palette').children[i]?.querySelector('input');if(input)input.value=c;});applyScene($('scene').value,{keepBackground:true});plate.setStyle($('plateStyle').value);renderer.toneMappingExposure=+$('exposure').value;applySoftness();pipeline.ao.enabled=$('ao').checked;syncReadouts();renderKeys();rebuild();prepareExport();notice('场景已恢复；请确保当前 G-code 与保存时一致。');}catch(err){notice('载入场景失败：'+err.message);}e.target.value='';};

// ── Export ───────────────────────────────────────────────────────────
$('cancel').onclick=()=>cancelled=true;
const AA_SAMPLES={standard:4,high:12,ultra:24,cinema:48};
let exportEncoding=null,probeId=0,lastVideoUrl=null;
async function prepareExport(){
 const id=++probeId;exportEncoding=null;$('export').disabled=true;$('exportStatus').textContent='正在检查视频编码器…';
 try{const result=await probeEncoding(+$('resolution').value);if(id!==probeId)return;exportEncoding=result;$('exportStatus').textContent=`${result.ext.toUpperCase()} · ${result.codec.toUpperCase()} · ${result.config.width}×${result.config.height} · 30 FPS · 已就绪`;$('export').disabled=false;}
 catch(error){if(id===probeId)$('exportStatus').textContent=error.message;}
}
$('resolution').onchange=prepareExport;
$('export').onclick=async()=>{
 if(exporting||!data||!exportEncoding)return;
 const encoding=exportEncoding,height=+$('resolution').value,width=RESOLUTIONS[height].width;
 const duration=Math.max(4,Math.min(120,+$('duration').value||20));$('duration').value=duration;
 const samples=AA_SAMPLES[$('aaQuality').value]||12;
 const old=+$('timeline').value,oldView=snapshot();let stream,handedOff=false;
 try{
  // The save picker must be the first awaited action from the user's click.
  if($('destination').value==='disk'){
   if(!window.showSaveFilePicker)throw Error('此浏览器不支持直接写盘，请选择“生成后下载”。');
   const handle=await showSaveFilePicker({suggestedName:`layer-studio-${height}p.${encoding.ext}`,types:[{description:'视频',accept:{[encoding.mime]:[`.${encoding.ext}`]}}]});
   stream=await handle.createWritable();
  }
  exporting=true;playing=false;cancelled=false;$('play').textContent='▶';controls.enabled=false;
  $('progress').hidden=false;$('progressText').textContent='准备逐帧渲染…';$('progressEta').textContent='';
  document.querySelectorAll('aside input,aside select,aside button,header button,footer button,footer input').forEach(e=>e.disabled=true);
  // Offline mode: canvas at exact output size; quality comes from per-frame
  // jittered accumulation instead of oversized buffers, so 4K fits in VRAM.
  renderer.setPixelRatio(1);exportPixelRatio=1;setShadowMap(4096);
  resize(width,height);handedOff=true;
  const started=performance.now();
  const result=await exportVideo({canvas:renderer.domElement,height,duration,encoding,stream,
   renderFrame:({progress,index})=>{evaluate(progress);pipeline.renderFrame(samples,index);},
   onProgress:({completed,total,progress})=>{
    $('progressText').textContent=`正在渲染 ${completed} / ${total} 帧 · ${width}×${height} · ${samples}× 采样`;$('progress').querySelector('progress').value=progress;
    const eta=(performance.now()-started)/completed*(total-completed)/1000;$('progressEta').textContent=`预计剩余 ${eta>=60?Math.floor(eta/60)+' 分 ':''}${Math.round(eta%60)} 秒`;
   },
   isCancelled:()=>cancelled});
  if(result.blob){
   if(lastVideoUrl)URL.revokeObjectURL(lastVideoUrl);lastVideoUrl=URL.createObjectURL(result.blob);
   const link=$('videoDownload');link.href=lastVideoUrl;link.download=`layer-studio-${height}p.${result.ext}`;link.textContent=`下载 ${result.ext.toUpperCase()} · ${(result.blob.size/1048576).toFixed(1)} MB`;
   $('resultVideo').src=lastVideoUrl;$('exportResult').hidden=false;link.click();
  }
  notice(`已完成 ${result.width} × ${result.height} / 30fps，共 ${result.frameCount} 帧。`);
 }catch(error){
  if(stream&&!handedOff)try{await stream.abort();}catch{}
  if(error.name!=='AbortError'){console.error('Video export failed',error);notice('导出失败：'+error.message);$('exportStatus').textContent='导出失败：'+error.message;}
  else notice('已取消导出。');
 }finally{
  exporting=false;controls.enabled=true;$('progress').hidden=true;
  document.querySelectorAll('aside input,aside select,aside button,header button,footer button,footer input').forEach(e=>e.disabled=false);
  setShadowMap(2048);renderer.setPixelRatio(previewPixelRatio);exportPixelRatio=null;
  $('export').disabled=!exportEncoding;resize();evaluate(old);useView(oldView);dirty=true;
 }
};

// Debug hook for automated visual verification (no UI dependency).
window.__layerStudio={camera,controls,pipeline,renderer,setScene(name){$('scene').value=name;applyScene(name);},async loadUrl(url){const blob=await (await fetch(url)).blob();await loadFile(new File([blob],decodeURIComponent(url.split('/').pop())));},setView(pos,target){camera.position.set(...pos);controls.target.set(...target);camera.lookAt(controls.target);controls.update();captureBase();dirty=true;}};

applyScene('studio');syncReadouts();prepareExport();resize();frame();loadGcode(sample(),currentName);
