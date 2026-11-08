import * as THREE from 'three';

// Outline measured from the user-provided front-on plate image, in a 1600-square reference frame.
export function plateGeometry(size=256){
 const scale=size/1022,shape=new THREE.Shape();
 const xy=(x,y)=>[(x-800)*scale,(800-y)*scale];
 const move=(x,y)=>shape.moveTo(...xy(x,y));const line=(x,y)=>shape.lineTo(...xy(x,y));const quad=(cx,cy,x,y)=>shape.quadraticCurveTo(...xy(cx,cy),...xy(x,y));
 move(320,284);line(669,284);line(697,255);line(900,255);line(929,284);line(1278,284);quad(1311,284,1311,317);line(1311,1316);quad(1311,1347,1280,1347);line(626,1347);line(581,1306);line(320,1306);quad(289,1306,289,1275);line(289,316);quad(289,284,320,284);
 const slot=new THREE.Path();const pts=[[714,278],[884,278],[884,284],[714,284]];pts.forEach(([x,y],i)=>i?slot.lineTo(...xy(x,y)):slot.moveTo(...xy(x,y)));slot.closePath();shape.holes.push(slot);
 const geo=new THREE.ExtrudeGeometry(shape,{depth:.65,bevelEnabled:false,curveSegments:12});geo.translate(0,0,-.7);
 const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)/scale+800)/1600,(pos.getY(i)/scale+800)/1600);uv.needsUpdate=true;
 return geo;
}

// Deterministic PRNG so every reload shows the same powder-coat grain.
function mulberry32(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeValueNoise(seed){
 const rand=mulberry32(seed),grid=new Float32Array(257*257);
 for(let i=0;i<grid.length;i++)grid[i]=rand();
 const at=(ix,iy)=>grid[((iy&255)*256)+(ix&255)];
 const smooth=t=>t*t*(3-2*t);
 return(x,y)=>{
  const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
  const a=at(ix,iy),b=at(ix+1,iy),c=at(ix,iy+1),d=at(ix+1,iy+1);
  return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
 };
}
function fbm(noise,x,y,octaves=4){let sum=0,amp=.55,freq=1,norm=0;for(let i=0;i<octaves;i++){sum+=noise(x*freq,y*freq)*amp;norm+=amp;amp*=.5;freq*=2.07;}return sum/norm;}

function hexToRgb(hex){const n=parseInt(hex.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}

/**
 * Procedural powder-coated PEI surface: broad mottling + fine grain + sparse pits.
 * Produces a colour map, a bump map and a roughness map with proper mipmaps,
 * replacing the blurry stretched product photo that caused grazing-angle moiré.
 */
function makePeiTextures(renderer,baseHex,variant){
 const size=512,noise=makeValueNoise(variant==='smooth'?7123:4242),rand=mulberry32(variant==='smooth'?99:12345);
 const colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=size;
 const bumpCanvas=document.createElement('canvas');bumpCanvas.width=bumpCanvas.height=size;
 const cctx=colorCanvas.getContext('2d'),bctx=bumpCanvas.getContext('2d');
 const cImg=cctx.createImageData(size,size),bImg=bctx.createImageData(size,size);
 const [br,bg,bb]=hexToRgb(baseHex);
 const grainStrength=variant==='smooth'?4:10,mottle=variant==='smooth'?3:9,pitChance=variant==='smooth'?.0003:.0022;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4;
  const broad=(fbm(noise,x/size*7,y/size*7)-.5)*2*mottle;
  const fine=(rand()-.5)*2*grainStrength;
  const pit=rand()<pitChance?-(10+rand()*18):0;
  const shade=broad+fine+pit;
  cImg.data[i]=THREE.MathUtils.clamp(br+shade,0,255);
  cImg.data[i+1]=THREE.MathUtils.clamp(bg+shade,0,255);
  cImg.data[i+2]=THREE.MathUtils.clamp(bb+shade,0,255);
  cImg.data[i+3]=255;
  // Relief stays broader and smoother than the colour speckle: subtle grain
  // to the eye, but a clearly tactile, non-flat surface under grazing light.
  const relief=(fbm(noise,x/size*13,y/size*13)-.5)*34+(rand()-.5)*10+(pit*1.1);
  const bump=THREE.MathUtils.clamp(128+relief+broad*1.2,0,255);
  bImg.data[i]=bImg.data[i+1]=bImg.data[i+2]=bump;bImg.data[i+3]=255;
 }
 cctx.putImageData(cImg,0,0);bctx.putImageData(bImg,0,0);
 const maxAniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const repeat=variant==='smooth'?2:3;
 const map=new THREE.CanvasTexture(colorCanvas);map.colorSpace=THREE.SRGBColorSpace;
 const bump=new THREE.CanvasTexture(bumpCanvas);
 for(const tex of [map,bump]){tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(repeat,repeat);tex.anisotropy=maxAniso;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;tex.needsUpdate=true;}
 return {map,bump};
}

function makeFloorTexture(renderer){
 const size=256,rand=mulberry32(555),canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d'),img=ctx.createImageData(size,size);
 for(let i=0;i<img.data.length;i+=4){const n=58+(rand()-.5)*14;img.data[i]=img.data[i+1]=img.data[i+2]=n;img.data[i+3]=255;}
 ctx.putImageData(img,0,0);
 const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(10,10);tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());tex.minFilter=THREE.LinearMipmapLinearFilter;tex.needsUpdate=true;return tex;
}

// Powder-coated PEI is a dielectric surface: low metalness and high roughness
// keep the grain readable instead of mirroring the studio environment.
const STYLE_PRESETS={
 gold:{base:'#b8894c',roughness:.74,metalness:.12,bumpScale:.075},
 dark:{base:'#2c3035',roughness:.76,metalness:.1,bumpScale:.065},
 smooth:{base:'#16191d',roughness:.3,metalness:.08,bumpScale:.016},
};

export function createBuildPlate(renderer,onChange){
 const group=new THREE.Group();
 const floorTex=makeFloorTexture(renderer);
 const top=new THREE.MeshStandardMaterial({color:'#b28b47',roughness:.74,metalness:.12,envMapIntensity:.4});
 const edge=new THREE.MeshStandardMaterial({color:'#403b32',roughness:.55,metalness:.45,envMapIntensity:.55});
 const plate=new THREE.Mesh(plateGeometry(),[top,edge]);plate.receiveShadow=true;group.add(plate);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.92,metalness:.05,envMapIntensity:.45,bumpMap:floorTex,bumpScale:.012}));floor.position.z=-.73;floor.receiveShadow=true;group.add(floor);
 let style='gold';
 function apply(){
  plate.visible=style!=='shadow';
  if(style==='shadow'){onChange();return;}
  const preset=STYLE_PRESETS[style]||STYLE_PRESETS.gold;
  const {map,bump}=makePeiTextures(renderer,preset.base,style);
  for(const old of [top.map,top.bumpMap,top.roughnessMap])if(old)old.dispose();
  top.color.set('#ffffff');top.map=map;top.bumpMap=bump;top.roughnessMap=bump;
  top.roughness=preset.roughness;top.metalness=preset.metalness;top.bumpScale=preset.bumpScale;top.envMapIntensity=.4;top.needsUpdate=true;
  onChange();
 }
 apply();
 return {group,setStyle(next){style=next;apply();},setSize(size){plate.geometry.dispose();plate.geometry=plateGeometry(size);onChange();},setPosition(x,y){plate.position.set(x,y,0);},setFloor(color){floor.material.color.set(color);}};
}
