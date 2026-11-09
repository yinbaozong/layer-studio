import * as THREE from 'three';

// Outline measured from the user-provided front-on plate image, in a 1600-square reference frame.
export function plateGeometry(size=256){
 const scale=size/1022,shape=new THREE.Shape();
 const xy=(x,y)=>[(x-800)*scale,(800-y)*scale];
 const move=(x,y)=>shape.moveTo(...xy(x,y));const line=(x,y)=>shape.lineTo(...xy(x,y));const quad=(cx,cy,x,y)=>shape.quadraticCurveTo(...xy(cx,cy),...xy(x,y));
 move(320,284);line(669,284);line(697,255);line(900,255);line(929,284);line(1278,284);quad(1311,284,1311,317);line(1311,1316);quad(1311,1347,1280,1347);line(626,1347);line(581,1306);line(320,1306);quad(289,1306,289,1275);line(289,316);quad(289,284,320,284);
 const slot=new THREE.Path();const pts=[[714,278],[884,278],[884,284],[714,284]];pts.forEach(([x,y],i)=>i?slot.lineTo(...xy(x,y)):slot.moveTo(...xy(x,y)));slot.closePath();shape.holes.push(slot);
 const geo=new THREE.ExtrudeGeometry(shape,{depth:.65,bevelEnabled:true,bevelThickness:.12,bevelSize:.25,bevelOffset:-.25,bevelSegments:2,curveSegments:12});geo.translate(0,0,-.82);
 const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');for(let i=0;i<pos.count;i++)uv.setXY(i,THREE.MathUtils.clamp((pos.getX(i)/scale+800)/1600,0,1),THREE.MathUtils.clamp((pos.getY(i)/scale+800)/1600,0,1));uv.needsUpdate=true;
 return geo;
}

/**
 * Silk-screened artwork in the same 1600-square frame as the outline
 * (canvas y grows downward exactly like the reference image).
 */
function makeDecalTexture(renderer){
 const S=2048,k=S/1600,canvas=document.createElement('canvas');canvas.width=canvas.height=S;
 const g=canvas.getContext('2d');g.scale(k,k);g.fillStyle=g.strokeStyle='#fff';g.lineJoin='round';
 // Centre mark: two split panels.
 g.lineWidth=2.6;
 const panel=(x0,x1,y0,y1,splitA,splitB)=>{g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y0);g.lineTo(x1,splitB);g.lineTo(x0,splitA);g.closePath();g.stroke();g.beginPath();g.moveTo(x0,splitA+26);g.lineTo(x1,splitB+26);g.lineTo(x1,y1);g.lineTo(x0,y1);g.closePath();g.stroke();};
 panel(662,788,621,978,830,790);panel(812,938,621,978,700,745);
 const tex=new THREE.CanvasTexture(canvas);tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;
 return tex;
}

// GLSL: granular powder-coat relief, evaluated analytically per pixel and
// band-limited by the pixel footprint. Octaves too fine for the current pixel
// fade out and are converted into extra microfacet roughness, so the plate
// keeps its matte sparkle at a distance without any moiré.
const PEI_COMMON=/* glsl */`
varying vec2 vPeiPos;varying vec2 vPeiUv;varying vec3 vPeiTx;varying vec3 vPeiTy;varying float vPeiTop;
uniform sampler2D uPeiDecal;uniform vec3 uPeiDecalColor;uniform float uPeiBump;uniform float uPeiFreq;uniform float uPeiDecalAlpha;uniform float uPeiSpeckle;
vec2 peiHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
vec3 peiGranules(vec2 x){
 vec2 i=floor(x),f=fract(x);vec3 acc=vec3(0.);
 for(int yy=-1;yy<=1;yy++)for(int xx=-1;xx<=1;xx++){
  vec2 c=vec2(float(xx),float(yy)),h=peiHash(i+c),d=c+.15+h*.7-f;
  float r=.5+.38*fract(h.x*31.7+h.y*7.1),q=1.-dot(d,d)/(r*r);
  if(q>0.){float a=.55+.45*h.y;acc.x+=a*q*q;acc.yz+=a*4.*q*d/(r*r);}
 }
 return acc;
}
float peiValue(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);float a=peiHash(i).x,b=peiHash(i+vec2(1,0)).x,c=peiHash(i+vec2(0,1)).x,d=peiHash(i+vec2(1,1)).x;return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
`;

function peiMaterial(decal){
 const mat=new THREE.MeshPhysicalMaterial({color:'#c39a55',roughness:.62,metalness:.22,envMapIntensity:.55,specularIntensity:.6});
 const uniforms={uPeiDecal:{value:decal},uPeiDecalColor:{value:new THREE.Color('#e4e1da')},uPeiBump:{value:.028},uPeiFreq:{value:4.2},uPeiDecalAlpha:{value:.82},uPeiSpeckle:{value:.16}};
 mat.userData.uniforms=uniforms;
 mat.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPeiPos;varying vec2 vPeiUv;varying vec3 vPeiTx;varying vec3 vPeiTy;varying float vPeiTop;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvPeiPos=position.xy;vPeiUv=uv;vPeiTop=step(.5,normal.z);vPeiTx=normalize((modelViewMatrix*vec4(1.,0.,0.,0.)).xyz);vPeiTy=normalize((modelViewMatrix*vec4(0.,1.,0.,0.)).xyz);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+PEI_COMMON)
   .replace('#include <map_fragment>',`#include <map_fragment>
 vec2 peiGrad=vec2(0.);float peiLost=0.,peiH=0.;
 float peiFp=max(length(dFdx(vPeiPos)),length(dFdy(vPeiPos)));
 {float f=uPeiFreq,amp=1.,norm=0.;
  for(int o=0;o<3;o++){
   float vis=1.-smoothstep(.16,.42,peiFp*f);
   vec3 g=peiGranules(vPeiPos*f+vec2(float(o)*17.3,float(o)*5.9));
   peiGrad+=g.yz*f*amp*vis;peiH+=(g.x-.45)*amp*vis;peiLost+=amp*(1.-vis);norm+=amp;
   f*=2.35;amp*=.55;
  }
  peiLost/=norm;}
 float peiMottle=peiValue(vPeiPos*.06)*.6+peiValue(vPeiPos*.21)*.4;
 vec4 peiDec=texture2D(uPeiDecal,vPeiUv);float peiInk=peiDec.a*uPeiDecalAlpha*vPeiTop;
 diffuseColor.rgb*=1.+(peiMottle-.5)*.07+peiH*uPeiSpeckle*.5;
 diffuseColor.rgb=mix(diffuseColor.rgb,uPeiDecalColor,peiInk);`)
   .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
 roughnessFactor=clamp(roughnessFactor+peiLost*.14-peiInk*.12,.05,1.);`)
   .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\n metalnessFactor*=1.-peiInk;')
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
 if(vPeiTop>.5){float b=uPeiBump*(1.-peiInk*.7);normal=normalize(normal-b*(peiGrad.x*vPeiTx+peiGrad.y*vPeiTy));}`);
 };
 mat.customProgramCacheKey=()=>'pei-v2';
 return mat;
}

// Bambu-style plate finishes. "freq" is granules per mm, "bump" the relief depth.
const STYLE_PRESETS={
 gold:{base:'#a9864c',roughness:.62,metalness:.18,bump:.03,freq:4.2,speckle:.22,decal:'#d9d5cb',decalAlpha:.72},
 dark:{base:'#2d3136',roughness:.66,metalness:.12,bump:.03,freq:4.6,speckle:.35,decal:'#a9afb6',decalAlpha:.7},
 smooth:{base:'#1b1e22',roughness:.24,metalness:.05,bump:.0018,freq:1.2,speckle:.05,decal:'#c9cdd2',decalAlpha:.7},
 cool:{base:'#3d4a55',roughness:.38,metalness:.1,bump:.004,freq:2.2,speckle:.05,decal:'#d8dee4',decalAlpha:.75},
};

export function createBuildPlate(renderer,onChange){
 const group=new THREE.Group();
 const top=peiMaterial(makeDecalTexture(renderer));
 const edge=new THREE.MeshStandardMaterial({color:'#2b2a28',roughness:.42,metalness:.6,envMapIntensity:.7});
 const plate=new THREE.Mesh(plateGeometry(),[top,edge]);plate.receiveShadow=true;plate.castShadow=true;group.add(plate);
 let style='gold';
 function apply(){
  plate.visible=style!=='shadow';
  const p=STYLE_PRESETS[style]||STYLE_PRESETS.gold,u=top.userData.uniforms;
  top.color.set(p.base);top.roughness=p.roughness;top.metalness=p.metalness;
  u.uPeiBump.value=p.bump;u.uPeiFreq.value=p.freq;u.uPeiSpeckle.value=p.speckle;u.uPeiDecalColor.value.set(p.decal);u.uPeiDecalAlpha.value=p.decalAlpha;
  onChange();
 }
 apply();
 return {group,plate,setStyle(next){style=next;apply();},setSize(size){plate.geometry.dispose();plate.geometry=plateGeometry(size);onChange();},setPosition(x,y){plate.position.set(x,y,0);}};
}
