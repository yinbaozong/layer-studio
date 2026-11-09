import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

function halton(i,b){let f=1,r=0;while(i>0){f/=b;r+=f*(i%b);i=Math.floor(i/b);}return r;}
const SEQUENCE=Array.from({length:256},(_,i)=>{
 const k=i+1;
 // Pixel jitter spans ±1 px with Gaussian weights (σ≈0.42 px): a slightly
 // wider-than-box reconstruction filter that removes layer-line moiré.
 const jx=(halton(k,2)-.5)*2,jy=(halton(k,3)-.5)*2;
 const weight=Math.exp(-(jx*jx+jy*jy)/(2*.42*.42));
 const lr=Math.sqrt(halton(k,5)),la=halton(k,7)*Math.PI*2;
 const dr=Math.sqrt(halton(k,11)),da=halton(k,13)*Math.PI*2;
 return {jx,jy,weight,light:[lr*Math.cos(la),lr*Math.sin(la)],lens:[dr*Math.cos(da),dr*Math.sin(da)]};
});

const accumulateMaterial=new THREE.RawShaderMaterial({
 uniforms:{tPrev:{value:null},tNew:{value:null},uAlpha:{value:1}},
 vertexShader:`precision highp float;attribute vec3 position;attribute vec2 uv;varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
 fragmentShader:`precision highp float;uniform sampler2D tPrev;uniform sampler2D tNew;uniform float uAlpha;varying vec2 vUv;void main(){gl_FragColor=mix(texture2D(tPrev,vUv),texture2D(tNew,vUv),uAlpha);}`,
 depthTest:false,depthWrite:false,
});

const presentMaterial=new THREE.RawShaderMaterial({
 uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1},uVignette:{value:.2},uAspect:{value:1.6},uSeed:{value:0}},
 vertexShader:`precision highp float;attribute vec3 position;attribute vec2 uv;varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
 fragmentShader:`precision highp float;
 uniform sampler2D tDiffuse;uniform float uVignette;uniform float uAspect;uniform float uSeed;varying vec2 vUv;
 #include <tonemapping_pars_fragment>
 #include <colorspace_pars_fragment>
 float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
 void main(){
  vec4 c=texture2D(tDiffuse,vUv);
  #if defined(AGX_TONE_MAPPING)
   c.rgb=AgXToneMapping(c.rgb);
  #elif defined(NEUTRAL_TONE_MAPPING)
   c.rgb=NeutralToneMapping(c.rgb);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
   c.rgb=ACESFilmicToneMapping(c.rgb);
  #endif
  c=sRGBTransferOETF(c);
  vec2 d=(vUv-.5)*vec2(uAspect,1.);c.rgb*=1.-uVignette*smoothstep(.12,.95,dot(d,d)*1.35);
  // Triangular dither keeps dark gradients from banding in H.264.
  c.rgb+=(h(gl_FragCoord.xy+uSeed)+h(gl_FragCoord.yx*1.37+uSeed)-1.)/255.;
  gl_FragColor=vec4(c.rgb,1.);
 }`,
 depthTest:false,depthWrite:false,
});

export function createPipeline(renderer,scene,camera){
 const composer=new EffectComposer(renderer);composer.renderToScreen=false;
 composer.addPass(new RenderPass(scene,camera));
 // GTAO has built-in Poisson denoise and stays stable on fine layer geometry.
 const ao=new GTAOPass(scene,camera,1,1);ao.updateGtaoMaterial({radius:.35,distanceExponent:1.5,thickness:1.2,scale:1,samples:16});ao.blendIntensity=.5;ao.pdRings=3;composer.addPass(ao);
 const bloom=new UnrealBloomPass(new THREE.Vector2(256,256),.5,.5,.9);bloom.enabled=false;composer.addPass(bloom);
 const rtOptions={type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
 const accum=[new THREE.WebGLRenderTarget(1,1,rtOptions),new THREE.WebGLRenderTarget(1,1,rtOptions)];
 const accQuad=new FullScreenQuad(accumulateMaterial),outQuad=new FullScreenQuad(presentMaterial);
 let current=0,weightSum=0,cssW=1,cssH=1,toneKey=null;
 const savedPos=new THREE.Vector3(),savedQuat=new THREE.Quaternion(),right=new THREE.Vector3(),up=new THREE.Vector3(),lightBase=new THREE.Vector3(),lightU=new THREE.Vector3(),lightV=new THREE.Vector3();
 const options={dof:false,aperture:0,focus:new THREE.Vector3(),light:null,lightRadius:0,vignette:.2};

 function setSize(w,h,pixelRatio){
  cssW=w;cssH=h;composer.setPixelRatio(pixelRatio);composer.setSize(w,h);
  const iw=Math.max(1,Math.round(w*pixelRatio)),ih=Math.max(1,Math.round(h*pixelRatio));
  for(const t of accum)t.setSize(iw,ih);
  weightSum=0;
 }
 /** Render one jittered sample and fold it into the running weighted mean. */
 function renderSample(index){
  const s=index===0?{jx:0,jy:0,weight:1,light:[0,0],lens:[0,0]}:SEQUENCE[(index-1)%SEQUENCE.length];
  if(index===0)weightSum=0;
  savedPos.copy(camera.position);savedQuat.copy(camera.quaternion);
  if(options.dof&&options.aperture>0&&index>0){
   camera.matrixWorld.extractBasis(right,up,new THREE.Vector3());
   camera.position.addScaledVector(right,s.lens[0]*options.aperture).addScaledVector(up,s.lens[1]*options.aperture);
   camera.lookAt(options.focus);
  }
  camera.setViewOffset(cssW,cssH,s.jx,s.jy,cssW,cssH);
  const light=options.light;
  if(light&&options.lightRadius>0&&index>0){
   lightBase.copy(light.position);
   const dir=lightBase.clone().sub(light.target.position).normalize();
   lightU.set(-dir.y,dir.x,0).normalize();if(lightU.lengthSq()<1e-6)lightU.set(1,0,0);lightV.crossVectors(dir,lightU).normalize();
   light.position.addScaledVector(lightU,s.light[0]*options.lightRadius).addScaledVector(lightV,s.light[1]*options.lightRadius);
  }
  composer.render();
  if(light&&options.lightRadius>0&&index>0)light.position.copy(lightBase);
  camera.clearViewOffset();camera.position.copy(savedPos);camera.quaternion.copy(savedQuat);camera.updateMatrixWorld();
  const alpha=s.weight/(weightSum+s.weight);weightSum+=s.weight;
  accumulateMaterial.uniforms.tPrev.value=accum[current].texture;accumulateMaterial.uniforms.tNew.value=composer.readBuffer.texture;accumulateMaterial.uniforms.uAlpha.value=alpha;
  const next=1-current;renderer.setRenderTarget(accum[next]);accQuad.render(renderer);renderer.setRenderTarget(null);current=next;
 }
 function present(seed=0){
  if(toneKey!==renderer.toneMapping){
   toneKey=renderer.toneMapping;presentMaterial.defines={};
   if(toneKey===THREE.AgXToneMapping)presentMaterial.defines.AGX_TONE_MAPPING='';
   else if(toneKey===THREE.NeutralToneMapping)presentMaterial.defines.NEUTRAL_TONE_MAPPING='';
   else if(toneKey===THREE.ACESFilmicToneMapping)presentMaterial.defines.ACES_FILMIC_TONE_MAPPING='';
   presentMaterial.needsUpdate=true;
  }
  const u=presentMaterial.uniforms;u.tDiffuse.value=accum[current].texture;u.toneMappingExposure.value=renderer.toneMappingExposure;u.uVignette.value=options.vignette;u.uAspect.value=cssW/cssH;u.uSeed.value=seed%997;
  renderer.setRenderTarget(null);outQuad.render(renderer);
 }
 return {composer,ao,bloom,options,setSize,renderSample,present,
  /** Full-quality still: `samples` jittered passes, then display. */
  renderFrame(samples,seed){for(let i=0;i<samples;i++)renderSample(i);present(seed);}};
}
