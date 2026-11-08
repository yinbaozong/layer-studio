import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {unzipSync,strFromU8} from 'fflate';
import {probeEncoding, exportVideo} from './exporter.js';
import {buildBeadChunks,updateBeadDrawRange} from './beads.js';
import {createBuildPlate} from './plate.js';
import {sample} from './parser.js';
let dirty=true;
const $=id=>document.getElementById(id), stage=$('stage');
document.addEventListener('input',()=>dirty=true);document.addEventListener('change',()=>dirty=true);document.addEventListener('click',()=>dirty=true);
const previewPixelRatio=Math.min(window.devicePixelRatio||1,2);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(previewPixelRatio);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;stage.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#0b0d10');scene.environmentIntensity=.32;const camera=new THREE.PerspectiveCamera(36,1,.1,3000);camera.up.set(0,0,1);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.49;
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
const ambient=new THREE.HemisphereLight('#b8d4ed','#4b4037',.75);scene.add(ambient);
const key=new THREE.DirectionalLight('#fff3df',2.0);key.position.set(-60,-80,150);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-160;key.shadow.camera.right=160;key.shadow.camera.top=160;key.shadow.camera.bottom=-160;key.shadow.camera.near=20;key.shadow.camera.far=600;key.shadow.normalBias=.025;key.shadow.bias=-.00012;scene.add(key);scene.add(key.target);
const fill=new THREE.DirectionalLight('#b2daff',.7);fill.position.set(80,20,60);scene.add(fill);const rim=new THREE.DirectionalLight('#fff5e6',1.05);rim.position.set(10,100,100);scene.add(rim);
const plate=createBuildPlate(renderer,()=>dirty=true);scene.add(plate.group);
const model=new THREE.Group();scene.add(model);
// Supersampling instead of multisampled render targets: the composer renders at
// a higher internal resolution and the final pass downscales to the canvas,
// which removes bead-layer moiré everywhere (multisampled float RTs rendered
// blank on some ANGLE/D3D11 drivers).
const PREVIEW_SUPERSAMPLE=1.25;
const composer=new EffectComposer(renderer);composer.setPixelRatio(Math.min(previewPixelRatio*PREVIEW_SUPERSAMPLE,2));composer.addPass(new RenderPass(scene,camera));
// GTAO has built-in Poisson denoise and stays stable on fine layer geometry,
// unlike SSAO which produced wavy interference banding at grazing angles.
const ao=new GTAOPass(scene,camera,1,1);ao.updateGtaoMaterial({radius:.25,distanceExponent:1.5,thickness:1,scale:1,samples:16});ao.blendIntensity=.35;ao.pdRings=3;composer.addPass(ao);
const bokeh=new BokehPass(scene,camera,{focus:100,aperture:.00004,maxblur:.005});bokeh.enabled=false;composer.addPass(bokeh);composer.addPass(new OutputPass());
let data=null,meshes=[],materials=[],bounds=new THREE.Box3(),center=new THREE.Vector3(),size=new THREE.Vector3(50,50,30),keys=[],base=null,playing=false,last=performance.now(),exporting=false,cancelled=false,currentName='三色花瓶 · 示例';
const notice=(s)=>{$('notice').textContent=s;$('notice').style.display='block';clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').style.display='none',8000);};
function material(color){return new THREE.MeshPhysicalMaterial({color,roughness:.4,metalness:0,clearcoat:.18,clearcoatRoughness:.42});}
function updateMaterials(){const config={matte:[.85,0,0],satin:[.46,.12,0],gloss:[.18,.65,0],silk:[.3,.35,.22]}[$('finish').value];materials.forEach(m=>{m.roughness=config[0];m.clearcoat=config[1];m.metalness=config[2];});}
function rebuild(){
 dirty=true;
 if(!data)return;for(const m of meshes){m.geometry.dispose();model.remove(m);}meshes=[];
 const visible=data.segments.filter(s=>($('purge').checked||(!s.auxiliary&&!/purge|flush|wipe|prime|skirt|brim|tower|custom/i.test(s.feature)))&&($('support').checked||!/support/i.test(s.feature)));
 const quality=$('quality').value==='auto'?(visible.length>300000?'low':'medium'):$('quality').value;
 const result=buildBeadChunks(visible,{quality,widthScale:+$('beadWidth').value,layerGap:+$('layerGap').value});
 for(const chunk of result.chunks){const m=new THREE.Mesh(chunk.geometry,materials[chunk.tool]);m.castShadow=true;m.receiveShadow=true;m.userData=chunk;model.add(m);meshes.push(m);}
 $('meshStats').textContent=`${(result.stats.triangles/1000000).toFixed(2)}M 三角形 · ${quality}`;
 model.position.set(-center.x,-center.y,0);updateMaterials();evaluate(+$('timeline').value);$('stats').textContent=`${data.layers} 层 · ${(data.segments.length/1000).toFixed(1)}k 段 · ${materials.length} 色`;
}
function snapshot(){return {position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov};}
function useView(v){camera.position.fromArray(v.position);controls.target.fromArray(v.target);camera.fov=v.fov;camera.updateProjectionMatrix();camera.lookAt(controls.target);}
function captureBase(){base=snapshot();}
function progressAt(t){const duration=+$('duration').value;return THREE.MathUtils.clamp((t*duration-.5)/(duration-2.5),0,1);}
function evaluate(t){if(!data)return;let p=progressAt(t),limit=data.total*p;if($('growth').value==='layer'&&p<1){const idx=data.segments.findIndex(s=>s.end>=limit);const target=data.segments[Math.max(0,idx)]?.b[2]||0;let k=Math.max(0,idx);while(k>0&&Math.abs(data.segments[k-1].b[2]-target)<.001)k--;limit=k?data.segments[k-1].end:0;}
 for(const m of meshes)updateBeadDrawRange(m.userData,limit);
 const mode=$('camera').value;if(mode==='keys'&&keys.length){const sorted=[...keys].sort((a,b)=>a.t-b.t);let a=sorted[0],b=sorted.at(-1);if(t<=a.t)b=a;else if(t>=b.t)a=b;else for(let i=1;i<sorted.length;i++)if(sorted[i].t>=t){a=sorted[i-1];b=sorted[i];break;}let f=b.t===a.t?0:(t-a.t)/(b.t-a.t);f=f*f*(3-2*f);const av=new THREE.Vector3().fromArray(a.position),bv=new THREE.Vector3().fromArray(b.position),at=new THREE.Vector3().fromArray(a.target),bt=new THREE.Vector3().fromArray(b.target);const as=new THREE.Spherical().setFromVector3(new THREE.Vector3(av.x-at.x,av.z-at.z,av.y-at.y)),bs=new THREE.Spherical().setFromVector3(new THREE.Vector3(bv.x-bt.x,bv.z-bt.z,bv.y-bt.y));let angle=bs.theta-as.theta;angle=Math.atan2(Math.sin(angle),Math.cos(angle));const sp=new THREE.Spherical(THREE.MathUtils.lerp(as.radius,bs.radius,f),THREE.MathUtils.lerp(as.phi,bs.phi,f),as.theta+angle*f);const v=new THREE.Vector3().setFromSpherical(sp);controls.target.copy(at.lerp(bt,f));camera.position.copy(controls.target).add(new THREE.Vector3(v.x,v.z,v.y));camera.fov=THREE.MathUtils.lerp(a.fov,b.fov,f);camera.updateProjectionMatrix();camera.lookAt(controls.target);
 }else if(base){useView(base);if(mode!=='fixed'){const offset=camera.position.clone().sub(controls.target);const angle=THREE.MathUtils.degToRad(+$('orbit').value)*t;offset.applyAxisAngle(new THREE.Vector3(0,0,1),angle);if(mode==='rise'){let end=data.segments.findIndex(s=>s.end>=limit);const height=p>=1?size.z:(data.segments[Math.max(0,end)]?.b[2]||0);controls.target.z=Math.max(2,height*.55);offset.z+=height*.12;}camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);}}
 $('time').textContent=`${(t*+$('duration').value).toFixed(1)} / ${+$('duration').value}.0 s`;$('layer').textContent=`${Math.round(p*100)}%`;bokeh.uniforms.focus.value=camera.position.distanceTo(controls.target);
}
// A tight orthographic frustum keeps shadow texel density high; the old fixed
// ±160 mm box wasted most of the 2048 px map on empty bed and caused acne/moiré.
function fitShadowCamera(){
 const r=Math.max(size.x,size.y)*.62+6;
 const cam=key.shadow.camera;
 cam.left=-r;cam.right=r;cam.top=r;cam.bottom=-r;cam.near=20;cam.far=r*5+150;cam.updateProjectionMatrix();
 key.target.position.set(0,0,size.z*.4);
 key.position.set(-r*1.15,-r*1.5,size.z+r*2.6);
 key.shadow.normalBias=.025;key.shadow.bias=-.00012;
}
function setShadowMap(px){if(key.shadow.map?.width===px)return;key.shadow.map?.dispose();key.shadow.map=null;key.shadow.mapSize.set(px,px);}
function resize(w=stage.clientWidth,h=stage.clientHeight){
 dirty=true;renderer.setSize(w,h,false);
 // Keep internal resolution near ~900 px minimum so dense bead layers never
 // alias on small windows; cost stays bounded on large screens.
 if(!exporting){const factor=THREE.MathUtils.clamp(900/Math.max(1,w),1,2);composer.setPixelRatio(Math.min(previewPixelRatio*factor,2));}
 composer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
}
new ResizeObserver(()=>{if(!exporting)resize();}).observe(stage);
function frame(){requestAnimationFrame(frame);const now=performance.now();if(!exporting){if(playing){dirty=true;let t=+$('timeline').value+(now-last)/1000/+$('duration').value;if(t>=1){t=1;playing=false;$('play').textContent='▶';}$('timeline').value=t;evaluate(t);}if(dirty||playing){composer.render();dirty=false;}}last=now;}frame();
controls.addEventListener('change',()=>dirty=true);
controls.addEventListener('start',()=>{playing=false;$('play').textContent='▶';});controls.addEventListener('end',captureBase);
async function loadGcode(text,name,palette=[]){playing=false;notice('正在解析挤出路径…');const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});try{const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.onerror=e=>reject(Error(e.message));worker.postMessage(text);});data=result;currentName=name;$('filename').textContent=name;bounds.makeEmpty();data.segments.forEach(s=>{bounds.expandByPoint(new THREE.Vector3(...s.a));bounds.expandByPoint(new THREE.Vector3(...s.b));});bounds.getCenter(center);bounds.getSize(size);fitShadowCamera();materials.forEach(m=>m.dispose());const count=data.segments.reduce((n,s)=>Math.max(n,s.tool),0)+1;materials=Array.from({length:count},(_,i)=>material(palette[i]||data.colors[i]||['#e88755','#e6d6b3','#398a90','#b7b2d9'][i%4]));$('palette').replaceChildren();materials.forEach((m,i)=>{const row=document.createElement('div'),input=document.createElement('input');input.type='color';input.value='#'+m.color.getHexString();input.oninput=()=>m.color.set(input.value);const label=document.createElement('span');label.textContent=`耗材 ${i+1}`;row.append(input,label);$('palette').append(row);});const scale=Math.max(size.x,size.y,40);const bedSize=data.bed?.width||256;plate.setSize(bedSize);plate.setPosition(data.bed?(data.bed.minX+data.bed.maxX)/2-center.x:0,data.bed?(data.bed.minY+data.bed.maxY)/2-center.y:0);camera.position.set(scale*1.1,-scale*1.65,size.z+scale*.85);controls.target.set(0,0,size.z*.4);camera.far=Math.max(3000,scale*15);camera.updateProjectionMatrix();camera.lookAt(controls.target);captureBase();keys=[];renderKeys();$('timeline').value=1;rebuild();notice(`已载入 ${data.layers} 层。${!palette.length&&!data.colors.length?'文件缺少配色，已使用可编辑示例颜色。':''}`);}catch(e){notice(e.message);}finally{worker.terminate();}}
$('sample').onclick=()=>loadGcode(sample(),'三色花瓶 · 同层换色示例');$('open').onclick=()=>$('file').click();
$('file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(/\.3mf$/i.test(file.name)){const files=unzipSync(new Uint8Array(await file.arrayBuffer()));const paths=Object.keys(files).filter(k=>/\.gcode$/i.test(k));if(!paths.length)throw Error('这是未切片的 3MF，请先从 Bambu Studio 导出切片盘文件。');let path=paths[0];if(paths.length>1){const n=Number(prompt(paths.map((s,i)=>`${i+1}. ${s}`).join('\n')+'\n选择盘编号','1'));if(!Number.isInteger(n)||n<1||n>paths.length)return;path=paths[n-1];}let colors=[];const info=Object.keys(files).find(k=>/slice_info\.config$/.test(k));if(info){const xml=new DOMParser().parseFromString(strFromU8(files[info]),'text/xml');const id=path.match(/plate_(\d+)/)?.[1];const plate=[...xml.querySelectorAll('plate')].find(p=>[...p.querySelectorAll('metadata')].some(m=>m.getAttribute('key')==='index'&&m.getAttribute('value')===id));(plate||xml).querySelectorAll('filament').forEach(f=>{const c=f.getAttribute('color');if(c)colors[Number(f.getAttribute('id'))-1]=c;});}const config=Object.keys(files).find(k=>/project_settings\.config$/.test(k));if(config){try{const fallback=JSON.parse(strFromU8(files[config])).filament_colour||[];fallback.forEach((c,i)=>{if(!colors[i])colors[i]=c;});}catch{}}await loadGcode(strFromU8(files[path]),file.name,colors);}else await loadGcode(await file.text(),file.name);}catch(err){notice(err.message);}e.target.value='';};
$('play').onclick=()=>{playing=!playing;if(playing&&+$('timeline').value>=1)$('timeline').value=0;$('play').textContent=playing?'Ⅱ':'▶';};$('reset').onclick=()=>{$('timeline').value=0;evaluate(0);};$('timeline').oninput=()=>{playing=false;$('play').textContent='▶';evaluate(+$('timeline').value);};
for(const id of ['quality','purge','support','beadWidth','layerGap'])$(id).onchange=rebuild;$('finish').onchange=updateMaterials;$('background').oninput=()=>{scene.background.set($('background').value);$('bgPreset').value='custom';};
$('bgPreset').onchange=()=>{const v=$('bgPreset').value;if(v!=='custom'){$('background').value=v;scene.background.set(v);}};$('exposure').oninput=()=>{renderer.toneMappingExposure=+$('exposure').value;$('exposureVal').textContent=$('exposure').value;};$('exposure').oninput();$('softness').oninput=()=>key.shadow.radius=+$('softness').value;$('ao').onchange=()=>ao.enabled=$('ao').checked;$('dof').onchange=()=>bokeh.enabled=$('dof').checked;$('lighting').onchange=()=>{const mode=$('lighting').value;key.intensity=mode==='dramatic'?3.0:2.0;fill.intensity=mode==='dramatic'?.2:.7;ambient.intensity=mode==='dramatic'?.4:.75;key.color.set(mode==='warm'?'#ffd3a1':'#fff3df');};for(const id of ['camera','orbit','growth','duration'])$(id).onchange=()=>evaluate(+$('timeline').value);
function renderKeys(){$('keys').replaceChildren();keys.sort((a,b)=>a.t-b.t).forEach((k,i)=>{const row=document.createElement('div');row.className='keyrow';const jump=document.createElement('button');jump.textContent=`${(k.t*100).toFixed(0)}% · 机位 ${i+1}`;jump.onclick=()=>{$('timeline').value=k.t;useView(k);captureBase();};const replace=document.createElement('button');replace.textContent='覆盖';replace.onclick=()=>{Object.assign(k,snapshot());};const del=document.createElement('button');del.textContent='×';del.onclick=()=>{keys.splice(i,1);renderKeys();};row.append(jump,replace,del);$('keys').append(row);});}
$('key').onclick=()=>{const t=+$('timeline').value;const existing=keys.find(k=>Math.abs(k.t-t)<.001);if(existing)Object.assign(existing,snapshot());else keys.push({t,...snapshot()});$('camera').value='keys';renderKeys();notice('机位已记录。移动时间轴，调整视角后可继续添加。');};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('plateStyle').onchange=()=>plate.setStyle($('plateStyle').value);
const settings=['plateStyle','beadWidth','layerGap','finish','quality','purge','support','lighting','exposure','softness','ao','dof','background','bgPreset','camera','orbit','aaQuality','resolution','duration','growth'];
$('save').onclick=()=>download(new Blob([JSON.stringify({version:1,source:currentName,keys,base,colors:materials.map(m=>'#'+m.color.getHexString()),settings:Object.fromEntries(settings.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))},null,2)],{type:'application/json'}),'layer-studio.scene.json');$('load').onclick=()=>$('sceneFile').click();$('sceneFile').onchange=async e=>{try{const s=JSON.parse(await e.target.files[0].text());if(s.version!==1||!s.settings)throw Error('不支持的场景文件');for(const id of settings)if(s.settings[id]!==undefined){if($(id).type==='checkbox')$(id).checked=!!s.settings[id];else $(id).value=s.settings[id];}keys=s.keys||[];if(s.base)base=s.base;s.colors?.forEach((c,i)=>{materials[i]?.color.set(c);const input=$('palette').children[i]?.querySelector('input');if(input)input.value=c;});for(const id of ['plateStyle','finish','background','bgPreset','exposure','softness','ao','dof','lighting'])$(id).dispatchEvent(new Event($(id).oninput?'input':'change'));renderKeys();rebuild();notice('场景已恢复；请确保当前 G-code 与保存时一致。');}catch(err){notice('载入场景失败：'+err.message);}e.target.value='';};
$('cancel').onclick=()=>cancelled=true;
let exportEncoding=null,probeId=0,lastVideoUrl=null;
async function prepareExport(){
 const id=++probeId;exportEncoding=null;$('export').disabled=true;
 $('exportStatus').textContent='正在检查视频编码器…';
 try{const result=await probeEncoding(+$('resolution').value);if(id!==probeId)return;exportEncoding=result;$('exportStatus').textContent=`${result.ext.toUpperCase()} · 30 FPS · 已就绪`;$('export').disabled=false;}
 catch(error){if(id===probeId)$('exportStatus').textContent=error.message;}
}
$('resolution').onchange=prepareExport;
$('export').onclick=async()=>{
 if(exporting||!data||!exportEncoding)return;
 const encoding=exportEncoding,height=+$('resolution').value,width=height===1080?1920:1280;
 const duration=Math.max(4,Math.min(120,+$('duration').value||20));$('duration').value=duration;
 const old=+$('timeline').value,oldView=snapshot();let stream,handedOff=false;
 try{
  // The save picker must be the first awaited action from the user's click.
  if($('destination').value==='disk'){
   if(!window.showSaveFilePicker)throw Error('此浏览器不支持直接写盘，请选择“生成后下载”。');
   const handle=await showSaveFilePicker({suggestedName:`layer-studio-${height}p.${encoding.ext}`,types:[{description:'视频',accept:{[encoding.mime]:[`.${encoding.ext}`]}}]});
   stream=await handle.createWritable();
  }
  exporting=true;playing=false;cancelled=false;$('play').textContent='▶';controls.enabled=false;
  $('progress').hidden=false;$('progressText').textContent='准备逐帧渲染…';
  document.querySelectorAll('aside input,aside select,header button,footer button,footer input').forEach(e=>e.disabled=true);
  // Offline quality mode: exact-output canvas, supersampled internal buffers,
  // and a 4K shadow map. Rendering is slower but free of moiré/soft shadows.
  const supersample={standard:1,high:1.5,ultra:2}[$('aaQuality').value]||1.5;
  renderer.setPixelRatio(1);composer.setPixelRatio(supersample);setShadowMap(4096);
  resize(width,height);handedOff=true;dirty=true;
  const result=await exportVideo({canvas:renderer.domElement,height,duration,encoding,stream,
   renderFrame:({progress})=>{evaluate(progress);composer.render();},
   onProgress:({completed,total,progress})=>{$('progressText').textContent=`正在渲染 ${completed} / ${total} 帧 · ${height}p / 30 fps`;$('progress').querySelector('progress').value=progress;},
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
  document.querySelectorAll('aside input,aside select,header button,footer button,footer input').forEach(e=>e.disabled=false);
  setShadowMap(2048);renderer.setPixelRatio(previewPixelRatio);composer.setPixelRatio(Math.min(previewPixelRatio*PREVIEW_SUPERSAMPLE,2));
  $('export').disabled=!exportEncoding;resize();evaluate(old);useView(oldView);dirty=true;
 }
};
prepareExport();

// Debug hook for automated visual verification (no UI dependency).
window.__layerStudio={camera,controls,ao,setView(pos,target){camera.position.set(...pos);controls.target.set(...target);camera.lookAt(controls.target);controls.update();dirty=true;}};

resize();loadGcode(sample(),currentName);
