const POW10=Array.from({length:23},(_,i)=>10**i);
// Bambu / Marlin extrusion parsing. Auxiliary moves remain available for optional display,
// but are explicitly identified so they need not affect model bounds or animation time.
export function parse(text) {
  let x=0, y=0, z=0, e=0, absolute=true, absE=true, tool=0;
  let width=.45, height=.2, feature='模型', pathId=0, total=0, modelTotal=0;
  let flushing=false, wiping=false, tower=false;
  const segments=[], layers=new Map(), debts=new Float64Array(256), retracts=[];
  let lastSeg=null;
  const colorLine=text.match(/^;\s*filament_colou?r\s*=\s*([^\r\n]*)/im);
  const colors=colorLine ? colorLine[1].split(';').map(c=>/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(c.trim()) ? c.trim().slice(0,7) : null) : [];
  const area=text.match(/^;\s*printable_area\s*=\s*([^\r\n]+)/im);
  let bed=null;
  if(area) {
    const points=[...area[1].matchAll(/(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)/gi)].map(m=>[+m[1],+m[2]]);
    if(points.length>=3) {const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);bed={width:maxX-minX,depth:maxY-minY,minX,minY,maxX,maxY};}
  }
  // Hand-rolled scanner: a 300 MB file is ~10M lines, so per-line regexes,
  // split() and temporary objects dominate parse time.
  const has=new Uint8Array(26),val=new Float64Array(26);
  const X=23,Y=24,Z=25,E=4,I=8,J=9,R=17;
  const auxKinds=new Map();
  let lastLayerZ=NaN,lastLayerIndex=-1;
  const len=text.length;
  for(let pos=0;pos<len;) {
    let next=text.indexOf('\n',pos);if(next<0)next=len;
    let stop=next;if(stop>pos&&text.charCodeAt(stop-1)===13)stop--;
    const start=pos;pos=next+1;
    let divider=text.indexOf(';',start);if(divider<0||divider>=stop)divider=-1;
    if(divider>=0) {
      const comment=text.slice(divider+1,stop).trim();
      if(comment) {
        // Match standalone tags, never embedded templates in a slicer configuration comment.
        switch(comment) {
          case 'FLUSH_START':pathId++;flushing=true;break;
          case 'FLUSH_END':pathId++;flushing=false;break;
          case 'WIPE_START':pathId++;wiping=true;break;
          case 'WIPE_END':pathId++;wiping=false;break;
          case 'WIPE_TOWER_START':case 'TOWER_START':pathId++;tower=true;break;
          case 'WIPE_TOWER_END':case 'TOWER_END':pathId++;tower=false;break;
          case 'CHANGE_LAYER':pathId++;break;
          default: {
            const c=comment.charCodeAt(0)|32;
            if(c===108||c===119) {const w=comment.match(/^(?:LINE_WIDTH|WIDTH)\s*:\s*([\d.]+)/i);if(w&&+w[1]>0)width=+w[1];}
            if(c===108||c===104) {const h=comment.match(/^(?:LAYER_HEIGHT|HEIGHT)\s*:\s*([\d.]+)/i);if(h&&+h[1]>0)height=+h[1];}
            if(c===102||c===116) {const f=comment.match(/^(?:FEATURE|TYPE)\s*:\s*(.+)/i);if(f&&feature!==f[1].trim()){feature=f[1].trim();pathId++;}}
          }
        }
      }
    }
    const codeEnd=divider<0?stop:divider;
    let i=start;while(i<codeEnd&&text.charCodeAt(i)<=32)i++;
    if(i>=codeEnd)continue;
    const letter=text.charCodeAt(i)&~32;
    if(letter!==71&&letter!==77&&letter!==84)continue;
    // Command number: digits with an optional fraction (G29.1).
    let j=i+1,cn=0,digits=0;
    while(j<codeEnd){const d=text.charCodeAt(j)-48;if(d<0||d>9)break;cn=cn*10+d;j++;digits++;}
    if(!digits)continue;
    if(text.charCodeAt(j)===46&&j+1<codeEnd){const d=text.charCodeAt(j+1)-48;if(d>=0&&d<=9){let f=.1;j++;while(j<codeEnd){const k=text.charCodeAt(j)-48;if(k<0||k>9)break;cn+=k*f;f/=10;j++;}}}
    // Parameters: LETTER [spaces] -?(digits[.digits] | .digits). E is a word, not an exponent.
    has.fill(0);
    while(j<codeEnd) {
      const l=(text.charCodeAt(j)&~32)-65;j++;
      if(l<0||l>25)continue;
      let k=j;while(k<codeEnd&&(text.charCodeAt(k)===32||text.charCodeAt(k)===9))k++;
      let neg=false;if(text.charCodeAt(k)===45){neg=true;k++;}
      // Integer mantissa / exact power of ten rounds identically to parseFloat.
      let m=0,nd=0,fd=0;const numStart=k;
      while(k<codeEnd){const d=text.charCodeAt(k)-48;if(d<0||d>9)break;m=m*10+d;k++;nd++;}
      if(k<codeEnd&&text.charCodeAt(k)===46){k++;while(k<codeEnd){const d=text.charCodeAt(k)-48;if(d<0||d>9)break;m=m*10+d;k++;nd++;fd++;}}
      if(!nd)continue;
      const v=m<9007199254740992&&fd<23?(fd?m/POW10[fd]:m):+text.slice(numStart,k);
      has[l]=1;val[l]=neg?-v:v;j=k;
    }
    if(letter===71) {
      if(cn===90){absolute=true;continue;}
      if(cn===91){absolute=false;continue;}
      if(cn===20)throw Error('此文件使用英寸单位，请导出毫米单位 G-code（G21）。');
      if(cn===92) {
        if(has[E])e=val[E];
        if(has[X])x=val[X];
        if(has[Y])y=val[Y];
        if(has[Z])z=val[Z];
        if(has[X]||has[Y]||has[Z])pathId++;
        continue;
      }
    }
    if(letter===77){if(cn===82)absE=true;else if(cn===83)absE=false;continue;}
    if(letter===84) {
      if(cn!==255&&cn!==1000&&cn!==1100&&Number.isInteger(cn)&&cn>=0&&cn<256&&cn!==tool){tool=cn;pathId++;}
      continue;
    }
    if(cn!==0&&cn!==1&&cn!==2&&cn!==3)continue;
    const arc=cn===2||cn===3;
    const nx=!has[X]?x:(absolute?val[X]:x+val[X]);
    const ny=!has[Y]?y:(absolute?val[Y]:y+val[Y]);
    const nz=!has[Z]?z:(absolute?val[Z]:z+val[Z]);
    let de=!has[E]?0:(absE?val[E]-e:val[E]);
    if(has[E])e=absE?val[E]:e+val[E];
    let debt=debts[tool];
    // A retraction leaves a small seam blob where the last bead ended; wipe-retracts
    // span several lines, so only the first line of each retraction counts.
    if(de<0&&debt<1e-6&&lastSeg&&!lastSeg.auxiliary&&lastSeg.tool===tool&&Math.abs(lastSeg.b[2]-z)<.05&&Math.hypot(lastSeg.b[0]-x,lastSeg.b[1]-y)<3) {
      const dx=lastSeg.b[0]-lastSeg.a[0],dy=lastSeg.b[1]-lastSeg.a[1],len=Math.hypot(dx,dy)||1;
      retracts.push({p:lastSeg.b,dir:[dx/len,dy/len],tool,width:lastSeg.width,height:lastSeg.height,feature:lastSeg.feature,end:lastSeg.end});
      lastSeg=null;
    }
    if(de<0){debt-=de;pathId++;}
    else if(de>0){const recovered=Math.min(debt,de);debt-=recovered;de-=recovered;if(recovered>0)pathId++;}
    debts[tool]=debt;
    if(arc&&has[R])throw Error('此 demo 暂不支持 R 格式圆弧；请关闭切片器圆弧拟合后重新导出，或使用 I/J 圆弧。');
    const pts=[[x,y,z]];
    if(arc&&(has[I]||has[J])) {
      const cx=x+(has[I]?val[I]:0),cy=y+(has[J]?val[J]:0),r=Math.hypot(x-cx,y-cy),a=Math.atan2(y-cy,x-cx);
      let sweep=Math.atan2(ny-cy,nx-cx)-a;
      if(cn===2&&sweep>=0)sweep-=Math.PI*2;
      if(cn===3&&sweep<=0)sweep+=Math.PI*2;
      const n=Math.max(2,Math.ceil(Math.abs(sweep)*r/.5));
      for(let k=1;k<n;k++)pts.push([cx+r*Math.cos(a+sweep*k/n),cy+r*Math.sin(a+sweep*k/n),z+(nz-z)*k/n]);
      // Slicer-rounded I/J centers need not land exactly on the command's endpoint.
      pts.push([nx,ny,nz]);
    } else pts.push([nx,ny,nz]);
    let xyMove=false;for(let k=1;k<pts.length&&!xyMove;k++)xyMove=Math.hypot(pts[k][0]-x,pts[k][1]-y)>.0001;
    if(de>1e-9&&xyMove) {
      const kind=flushing?'Flush':wiping?'Wipe':tower?'Wipe tower':feature;
      let auxKind=auxKinds.get(kind);if(auxKind===undefined){auxKind=/purge|flush|wipe|prime|skirt|brim|tower|custom/i.test(kind);auxKinds.set(kind,auxKind);}
      const auxiliary=flushing||wiping||tower||auxKind;
      let layerIndex=-1;
      if(!auxiliary) {
        if(nz!==lastLayerZ){const layerKey=nz.toFixed(3);if(!layers.has(layerKey))layers.set(layerKey,layers.size);lastLayerZ=nz;lastLayerIndex=layers.get(layerKey);}
        layerIndex=lastLayerIndex;
      }
      for(let k=1;k<pts.length;k++) {
        const a=pts[k-1],b=pts[k],len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
        if(len<1e-9)continue;
        total+=len;
        if(!auxiliary)modelTotal+=len;
        lastSeg={a,b,tool,width,height,feature:kind,auxiliary,pathId,layerIndex,end:total,modelEnd:modelTotal};
        segments.push(lastSeg);
      }
    } else if(Math.hypot(nx-x,ny-y,nz-z)>.0001)pathId++;
    x=nx;y=ny;z=nz;
  }
  if(!segments.length)throw Error('没有找到有效挤出路径，请导入切片后的 G-code。');
  return {segments,retracts,colors,layers:layers.size,total,modelTotal,bed};
}
function pointChordDistance(p,a,b){
  const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],apx=p[0]-a[0],apy=p[1]-a[1],apz=p[2]-a[2];
  const len2=abx*abx+aby*aby+abz*abz,t=len2>0?Math.max(0,Math.min(1,(apx*abx+apy*aby+apz*abz)/len2)):0;
  return Math.hypot(apx-abx*t,apy-aby*t,apz-abz*t);
}
/**
 * Merge consecutive moves of one continuous bead while every dropped vertex
 * stays within `tolerance` mm of the merged chord. Slicers emit curves as many
 * tiny moves; above ~0.01 mm the difference is invisible inside a 0.4 mm bead.
 * `maxLength` bounds merged chords so path-growth animation stays smooth.
 */
export function simplify(segments,tolerance=.01,{maxLength=6,maxPoints=48}={}) {
  if(!(tolerance>0)||segments.length<2)return segments;
  const out=[],inner=[];let run=null;
  for(const s of segments) {
    if(run&&run.pathId===s.pathId&&run.tool===s.tool&&run.feature===s.feature&&run.auxiliary===s.auxiliary&&run.layerIndex===s.layerIndex&&run.width===s.width&&run.height===s.height
      &&Math.abs(run.b[0]-s.a[0])<1e-9&&Math.abs(run.b[1]-s.a[1])<1e-9&&Math.abs(run.b[2]-s.a[2])<1e-9
      &&inner.length<maxPoints&&Math.hypot(s.b[0]-run.a[0],s.b[1]-run.a[1])<=maxLength) {
      inner.push(s.a);
      let ok=true;for(let i=0;i<inner.length&&ok;i++)ok=pointChordDistance(inner[i],run.a,s.b)<=tolerance;
      if(ok){run.b=s.b;run.end=s.end;run.modelEnd=s.modelEnd;continue;}
      inner.pop();
    }
    if(run)out.push(run);
    // Reuse the parsed object as the run head; extending it only rewrites b/end.
    run=s;inner.length=0;
  }
  if(run)out.push(run);
  return out;
}

// Millions of segment objects exhaust structured clone; ship them as transferable typed arrays.
export function pack(result) {
  const {segments}=result,n=segments.length,num=new Float64Array(n*10),int=new Int32Array(n*5),features=[],featureIds=new Map();
  for(let i=0;i<n;i++) {
    const s=segments[i],o=i*10,q=i*5;
    num[o]=s.a[0];num[o+1]=s.a[1];num[o+2]=s.a[2];num[o+3]=s.b[0];num[o+4]=s.b[1];num[o+5]=s.b[2];
    num[o+6]=s.width;num[o+7]=s.height;num[o+8]=s.end;num[o+9]=s.modelEnd;
    let f=featureIds.get(s.feature);
    if(f===undefined){f=features.length;features.push(s.feature);featureIds.set(s.feature,f);}
    int[q]=s.tool;int[q+1]=s.pathId;int[q+2]=s.layerIndex;int[q+3]=f;int[q+4]=s.auxiliary?1:0;
  }
  const retracts=result.retracts||[],rn=retracts.length,rnum=new Float64Array(rn*8),rint=new Int32Array(rn*2);
  for(let i=0;i<rn;i++) {
    const r=retracts[i],o=i*8;
    rnum[o]=r.p[0];rnum[o+1]=r.p[1];rnum[o+2]=r.p[2];rnum[o+3]=r.dir[0];rnum[o+4]=r.dir[1];rnum[o+5]=r.width;rnum[o+6]=r.height;rnum[o+7]=r.end;
    let f=featureIds.get(r.feature);
    if(f===undefined){f=features.length;features.push(r.feature);featureIds.set(r.feature,f);}
    rint[i*2]=r.tool;rint[i*2+1]=f;
  }
  return {packed:{num,int,rnum,rint,features},colors:result.colors,layers:result.layers,total:result.total,modelTotal:result.modelTotal,bed:result.bed};
}
export function transferables(data){const p=data.packed;return [p.num.buffer,p.int.buffer,p.rnum.buffer,p.rint.buffer];}
export function unpack(data) {
  const {num,int,rnum,rint,features}=data.packed,n=int.length/5,segments=new Array(n);
  let last=null;
  for(let i=0;i<n;i++) {
    const o=i*10,q=i*5;
    const a=last&&last[0]===num[o]&&last[1]===num[o+1]&&last[2]===num[o+2]?last:[num[o],num[o+1],num[o+2]];
    const b=[num[o+3],num[o+4],num[o+5]];last=b;
    segments[i]={a,b,tool:int[q],width:num[o+6],height:num[o+7],feature:features[int[q+3]],auxiliary:int[q+4]===1,pathId:int[q+1],layerIndex:int[q+2],end:num[o+8],modelEnd:num[o+9]};
  }
  const rn=rint.length/2,retracts=new Array(rn);
  for(let i=0;i<rn;i++){const o=i*8;retracts[i]={p:[rnum[o],rnum[o+1],rnum[o+2]],dir:[rnum[o+3],rnum[o+4]],tool:rint[i*2],width:rnum[o+5],height:rnum[o+6],feature:features[rint[i*2+1]],end:rnum[o+7]};}
  const {packed,...rest}=data;
  return {...rest,segments,retracts};
}
export function sample(){let s='; filament_colour = #ef7848;#f2dfad;#397f83\nG90\nM83\n';for(let l=1;l<=140;l++){const z=l*.2,r=22+5*Math.sin(l/140*Math.PI*3);s+=`; LAYER_HEIGHT: 0.2\nG0 Z${z}\n`;for(let wall=0;wall<3;wall++){const rr=r-wall*.45;for(let i=0;i<=100;i++){if(i%25===0&&i<100)s+=`T${Math.floor(i/25)%3}\n`;s+=`${i===0?'G0':'G1'} X${(64+rr*Math.cos(i/100*Math.PI*2)).toFixed(3)} Y${(64+rr*Math.sin(i/100*Math.PI*2)).toFixed(3)}${i?' E0.08':''}\n`;if(i===0)s+='G1 E0.6\n';}s+='G1 E-0.6\n';}}return s;}
