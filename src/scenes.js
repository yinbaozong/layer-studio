import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

/**
 * Scene presets. Lights are relative to the shadow-fit radius in main.js.
 * floor: 0 seamless sweep, 1 cutting mat, 2 walnut desk, 3 sci-fi hex deck,
 *        4 neon grid, 5 brushed concrete.
 */
export const SCENES={
 studio:{label:'柔光影棚 · 无缝背景',bg:'#c9ccd0',floor:0,floorColors:['#bfc2c6','#b4b7bb','#000000'],floorRough:.9,floorMetal:0,fade:[1.1,3.2],
  env:'room',envIntensity:.3,exposure:1,hemi:['#eef3f8','#7d756c',.38],key:['#fff4e6',2.2],fill:['#c9defa',.4],rim:['#ffffff',.9],vignette:.18,bloom:null,pedestal:null},
 workbench:{label:'创客工作台 · 绿色切割垫',bg:'#6f675d',floor:1,floorColors:['#2f6a4f','#d8eadf','#9c8466'],floorRough:.72,floorMetal:0,fade:[2.2,5.5],
  env:'room',envIntensity:.36,exposure:1,hemi:['#f4f1ea','#5b5a52',.55],key:['#fff1dc',2.5],fill:['#cfe0ff',.5],rim:['#fff8ee',1.0],vignette:.22,bloom:null,pedestal:null},
 desk:{label:'胡桃木书桌 · 暖调日光',bg:'#2a2420',floor:2,floorColors:['#5b3a22','#3a2414','#7a5232'],floorRough:.48,floorMetal:0,fade:[1.4,4],
  env:'room',envIntensity:.32,exposure:1,hemi:['#ffe6c7','#3b2a1d',.45],key:['#ffd9a8',2.6],fill:['#9fb8e0',.35],rim:['#ffe7c4',1.2],vignette:.32,bloom:null,pedestal:null},
 dark:{label:'暗场展台 · 黑色基座',bg:'#0b0d10',floor:5,floorColors:['#17191c','#101214','#000000'],floorRough:.7,floorMetal:.05,fade:[.9,2.6],
  env:'room',envIntensity:.2,exposure:1,hemi:['#a9c1da','#1c1a18',.25],key:['#fff2e0',3.0],fill:['#9cc4ff',.25],rim:['#ffffff',1.9],vignette:.35,bloom:null,pedestal:{color:'#141618',glow:null}},
};

// A2 self-healing cutting mat, drawn in millimetres (600 × 450).
function makeMatTexture(){
 const W=600,H=450,px=4096/W,c=document.createElement('canvas');c.width=4096;c.height=Math.round(H*px);
 const g=c.getContext('2d');g.scale(px,px);
 const rr=(x,y,w,h,r)=>{g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();};
 rr(0,0,W,H,14);g.save();g.clip();
 const grad=g.createRadialGradient(W*.5,H*.5,20,W*.5,H*.5,W*.62);grad.addColorStop(0,'#1d6e45');grad.addColorStop(1,'#17603b');
 g.fillStyle=grad;g.fillRect(0,0,W,H);
 for(let i=0;i<9000;i++){g.fillStyle=`rgba(${Math.random()<.5?0:255},${Math.random()<.5?40:255},${Math.random()<.5?20:255},${.025+Math.random()*.03})`;g.fillRect(Math.random()*W,Math.random()*H,.6+Math.random(),.6+Math.random());}
 const ink='rgba(232,244,234,.92)';g.strokeStyle=g.fillStyle=ink;g.lineCap='butt';
 const X0=30,Y0=34,NX=54,NY=38,line=(x0,y0,x1,y1,w)=>{g.lineWidth=w;g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.stroke();};
 const Y1=Y0+NY*10,X1=X0+NX*10;
 for(let i=0;i<=NX;i++)line(X0+i*10,Y0,X0+i*10,Y1,i%5?.32:.7);
 for(let j=0;j<=NY;j++)line(X0,Y1-j*10,X1,Y1-j*10,j%5?.32:.7);
 // Angle guides from the bottom-left corner of the grid.
 for(const deg of [30,45,60]){const a=deg*Math.PI/180,len=Math.min(NX*10/Math.cos(a),NY*10/Math.sin(a));line(X0,Y1,X0+Math.cos(a)*len,Y1-Math.sin(a)*len,.35);}
 line(X0+200,Y1,X0+200+NY*10,Y0,.35);
 // Rulers: mm ticks on the top edge and cm numbers around the grid.
 for(let i=0;i<=NX*10;i++)line(X0+i,10,X0+i,10+(i%10?i%5?2:3.2:5),.22);
 line(X0,10,X1,10,.3);
 g.textAlign='center';g.textBaseline='middle';
 for(let i=0;i<=NX;i++){g.font=`${i%5?500:700} ${i%5?4.2:5}px Arial,sans-serif`;g.fillText(i,X0+i*10,Y1+7);g.fillText(i,X0+i*10,21);}
 for(let j=0;j<=NY;j++){g.font=`${j%5?500:700} ${j%5?4.2:5}px Arial,sans-serif`;g.fillText(j,X0-9,Y1-j*10);g.fillText(j,X1+9,Y1-j*10);}
 g.font='700 9px Arial,sans-serif';g.textAlign='left';g.fillText('A2',X1-112,Y0+22);g.font='600 4.6px Arial,sans-serif';g.fillText('SELF-HEALING CUTTING MAT',X1-112,Y0+32);g.fillText('60 × 45 cm',X1-112,Y0+38);
 rr(X1-120,Y0+12,108,32,2);g.lineWidth=.5;g.stroke();
 g.restore();
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=16;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;
 return tex;
}

const FLOOR_COMMON=/* glsl */`
varying vec2 vFloorPos;
uniform int uFloorType;uniform vec3 uFloorC1;uniform vec3 uFloorC2;uniform vec3 uFloorC3;uniform vec3 uFloorBg;uniform vec2 uFloorFade;uniform vec3 uFloorEm;uniform vec3 uFloorEm2;uniform float uFloorScale;uniform vec2 uFloorCenter;uniform sampler2D uFloorMap;
float fHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float fNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(fHash(i),fHash(i+vec2(1,0)),u.x),mix(fHash(i+vec2(0,1)),fHash(i+vec2(1,1)),u.x),u.y);}
float fFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*fNoise(p);p=p*2.03+17.1;a*=.5;}return s;}
// Anti-aliased grid line; lines thinner than a pixel fade to their mean coverage.
float fLine(float c,float spacing,float width){
 float fw=max(fwidth(c),1e-5),d=abs(fract(c/spacing+.5)-.5)*spacing;
 float l=1.-smoothstep(width*.5-fw,width*.5+fw,d);
 return mix(l,min(1.,width/spacing),smoothstep(.25,.6,fw/max(width,1e-4)));
}
float fHex(vec2 p,float s,float w){
 p/=s;vec2 r=vec2(1.,1.7320508),h=r*.5;vec2 a=mod(p,r)-h,b=mod(p-h,r)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;
 vec2 q=abs(g);float e=.5-max(dot(q,normalize(vec2(1.,1.7320508))),q.x);
 float fw=max(fwidth(p.x),1e-5);float l=1.-smoothstep(w/s-fw,w/s+fw,e);
 return mix(l,w/s*3.,smoothstep(.15,.45,fw*s/w*.25));
}
`;

function floorMaterial(){
 const mat=new THREE.MeshPhysicalMaterial({color:'#ffffff',roughness:.9,metalness:0});
 const uniforms={uFloorType:{value:0},uFloorC1:{value:new THREE.Color()},uFloorC2:{value:new THREE.Color()},uFloorC3:{value:new THREE.Color()},uFloorBg:{value:new THREE.Color()},uFloorFade:{value:new THREE.Vector2(300,900)},uFloorEm:{value:new THREE.Color(0,0,0)},uFloorEm2:{value:new THREE.Color(0,0,0)},uFloorScale:{value:256},uFloorCenter:{value:new THREE.Vector2()},uFloorMap:{value:makeMatTexture()}};
 mat.userData.uniforms=uniforms;
 mat.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFloorPos;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFloorPos=(modelMatrix*vec4(position,1.)).xy;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+FLOOR_COMMON)
   .replace('#include <map_fragment>',`#include <map_fragment>
 vec2 fp=vFloorPos-uFloorCenter;float fr=length(fp);vec3 fEm=vec3(0.);float fRough=0.;
 if(uFloorType==0){diffuseColor.rgb=mix(uFloorC1,uFloorC2,fFbm(fp*.004))*(.985+.03*fNoise(fp*.7));}
 else if(uFloorType==1){
  vec2 mUv=(fp-vec2(uFloorScale*.12,uFloorScale*.1))/vec2(uFloorScale*2.34,uFloorScale*1.755)+.5;
  vec4 mt=texture2D(uFloorMap,clamp(mUv,0.,1.));float inside=mt.a*step(0.,mUv.x)*step(mUv.x,1.)*step(0.,mUv.y)*step(mUv.y,1.);
  float gr=fract(fFbm(vec2(fp.x*.004,fp.y*.05))*7.);
  vec3 desk=uFloorC3*(.86+.2*smoothstep(.2,.8,gr))*(.95+.1*fFbm(fp*.02));
  diffuseColor.rgb=mix(desk,mt.rgb/max(mt.a,1e-3),inside);fRough=(1.-inside)*-.3;
 }
 else if(uFloorType==2){
  float plank=floor((fp.x+5000.)/140.);vec2 wp=vec2(fp.x,fp.y+fHash(vec2(plank,3.))*900.);
  float ring=fFbm(vec2(wp.x*.02+plank*3.1,wp.y*.0025))*9.+wp.x*.03;float grain=fract(ring);
  grain=smoothstep(.0,.55,grain)*smoothstep(1.,.6,grain);
  vec3 wood=mix(uFloorC2,uFloorC1,grain)*(.85+.3*fNoise(vec2(wp.x*.8,wp.y*.02)));wood=mix(wood,uFloorC3,fFbm(wp*.006)*.35);
  float seam=fLine(fp.x+5000.,140.,.8);diffuseColor.rgb=wood*(1.-seam*.65);fRough=grain*.08+seam*.3;
 }
 else if(uFloorType==3){
  float hex=fHex(fp,34.,.9),fine=max(fLine(fp.x,8.5,.18),fLine(fp.y,8.5,.18));
  float near=exp(-fr/(uFloorScale*1.25));float ring=0.;
  for(int i=1;i<=3;i++){float rr=uFloorScale*(.72+.22*float(i));float fw=max(fwidth(fr),1e-4);ring+=(1.-smoothstep(.6-fw,.6+fw,abs(fr-rr)))*(1.-float(i)*.22);}
  diffuseColor.rgb=mix(uFloorC1,uFloorC2,fNoise(floor(fp/34.)*1.7))*(1.-hex*.4)+fine*.01;
  fEm=uFloorEm*(hex*(.05+1.9*near)+ring*2.2+fine*.06*near);fRough=hex*.2;
 }
 else if(uFloorType==4){
  float gx=fLine(fp.x,40.,.9),gy=fLine(fp.y,40.,.9),sub=max(fLine(fp.x,10.,.25),fLine(fp.y,10.,.25));
  float near=exp(-fr/(uFloorScale*1.6));
  diffuseColor.rgb=uFloorC1;fEm=(uFloorEm*gx+uFloorEm2*gy)*(.25+2.4*near)+(uFloorEm+uFloorEm2)*sub*.05*near;
 }
 else{float n=fFbm(fp*.012),c=fFbm(fp*.09);diffuseColor.rgb=mix(uFloorC2,uFloorC1,n)*(.88+.24*c)*(.97+.06*fNoise(fp*1.3));fRough=(c-.5)*.1;}
`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+fRough,.04,1.);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=fEm;')
   .replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.rgb=mix(gl_FragColor.rgb,uFloorBg,smoothstep(uFloorFade.x,uFloorFade.y,fr));');
 };
 mat.customProgramCacheKey=()=>'floor-v2';
 return mat;
}

function lightPanel(scene,color,intensity,w,h,pos,look){
 const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(intensity),side:THREE.DoubleSide}));
 m.position.set(...pos);m.lookAt(...look);scene.add(m);
}
function customEnv(kind){
 const s=new THREE.Scene();
 const room=new THREE.Mesh(new THREE.BoxGeometry(20,20,20),new THREE.MeshBasicMaterial({color:kind==='neon'?'#08060e':'#05080d',side:THREE.BackSide}));s.add(room);
 if(kind==='neon'){
  lightPanel(s,'#ff3df2',9,3,12,[-8,2,0],[0,0,0]);lightPanel(s,'#2de2ff',9,3,12,[8,-2,0],[0,0,0]);
  lightPanel(s,'#ffffff',4,8,1,[0,9,3],[0,0,0]);lightPanel(s,'#7a3dff',3,12,2,[0,-9,5],[0,0,0]);
 }else{
  lightPanel(s,'#bfe8ff',7,10,1.5,[0,9.5,0],[0,0,0]);lightPanel(s,'#2fd0ff',6,1.2,12,[-9,0,-2],[0,0,0]);
  lightPanel(s,'#ff9a3d',5,1.2,10,[9,0,-1],[0,0,0]);lightPanel(s,'#ffffff',2.5,6,6,[0,0,9.5],[0,0,0]);
 }
 return s;
}

export function createSceneSet(renderer,scene){
 const pmrem=new THREE.PMREMGenerator(renderer),envCache={};
 const env=kind=>envCache[kind]??=pmrem.fromScene(kind==='room'?new RoomEnvironment():customEnv(kind),.04).texture;
 const group=new THREE.Group();scene.add(group);
 const floorMat=floorMaterial();
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(6000,6000),floorMat);floor.position.z=-.83;floor.receiveShadow=true;group.add(floor);
 // Pedestal: plinth under the plate with an optional emissive light ring.
 const pedestal=new THREE.Group();group.add(pedestal);
 const plinthMat=new THREE.MeshPhysicalMaterial({color:'#141618',roughness:.38,metalness:.55,clearcoat:.4,clearcoatRoughness:.3});
 const glowMat=new THREE.MeshBasicMaterial({color:'#38d6ff'}),glowMat2=new THREE.MeshBasicMaterial({color:'#38d6ff'});
 let plinth,glowTop,glowBottom;
 const PLINTH=22;
 function hexPrism(top,bottom,height,material,z,open=false){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(top,bottom,height,6,1,open),material);
  m.rotation.set(Math.PI/2,Math.PI/6,0);m.position.z=z;pedestal.add(m);return m;
 }
 function buildPedestal(radius){
  pedestal.traverse(o=>o.geometry?.dispose());pedestal.clear();
  plinth=hexPrism(radius,radius*1.04,PLINTH,plinthMat,-.84-PLINTH/2);plinth.castShadow=plinth.receiveShadow=true;
  glowTop=hexPrism(radius*1.0075,radius*1.008,1.1,glowMat,-3.4,true);
  glowBottom=hexPrism(radius*1.039,radius*1.0405,1.6,glowMat2,-.84-PLINTH+1.4,true);
 }
 let current=SCENES.studio,bedSize=256,center=new THREE.Vector2();
 function apply(name){
  current=SCENES[name]||SCENES.studio;const u=floorMat.userData.uniforms;
  u.uFloorType.value=current.floor;u.uFloorC1.value.set(current.floorColors[0]);u.uFloorC2.value.set(current.floorColors[1]);u.uFloorC3.value.set(current.floorColors[2]);
  u.uFloorEm.value.set(current.emissive||'#000000');u.uFloorEm2.value.set(current.emissive2||current.emissive||'#000000');
  floorMat.roughness=current.floorRough;floorMat.metalness=current.floorMetal;floorMat.clearcoat=current.floor===2?.35:current.floor===4?.6:0;floorMat.clearcoatRoughness=.25;
  scene.environment=env(current.env);scene.environmentIntensity=current.envIntensity;
  pedestal.visible=!!current.pedestal;
  if(current.pedestal){plinthMat.color.set(current.pedestal.color);const glow=current.pedestal.glow;glowTop.visible=glowBottom.visible=!!glow;if(glow){glowMat.color.set(glow).multiplyScalar(4);glowMat2.color.set(glow).multiplyScalar(2.2);}}
  layout();
  return current;
 }
 function layout(){
  const u=floorMat.userData.uniforms;u.uFloorScale.value=bedSize;u.uFloorCenter.value.copy(center);
  u.uFloorFade.value.set(bedSize*current.fade[0],bedSize*current.fade[1]);
  floor.position.x=center.x;floor.position.y=center.y;
  pedestal.position.set(center.x,center.y,0);
  floor.position.z=current.pedestal?-.85-PLINTH:-.83;
 }
 buildPedestal(256*.82);
 return {
  group,floor,apply,
  setBackground(color){floorMat.userData.uniforms.uFloorBg.value.set(color);},
  setBed(size,x,y){if(size!==bedSize){bedSize=size;buildPedestal(size*.82);apply(Object.keys(SCENES).find(k=>SCENES[k]===current));}center.set(x,y);layout();},
  get current(){return current;},
 };
}
