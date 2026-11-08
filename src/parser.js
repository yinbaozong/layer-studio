// Bambu / Marlin extrusion parsing. Auxiliary moves remain available for optional display,
// but are explicitly identified so they need not affect model bounds or animation time.
export function parse(text) {
  let x=0, y=0, z=0, e=0, absolute=true, absE=true, tool=0;
  let width=.45, height=.2, feature='模型', pathId=0, total=0, modelTotal=0;
  let flushing=false, wiping=false, tower=false;
  const segments=[], layers=new Map(), debts=new Map();
  const colorLine=text.match(/^;\s*filament_colou?r\s*=\s*([^\r\n]*)/im);
  const colors=colorLine ? colorLine[1].split(';').map(c=>/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(c.trim()) ? c.trim().slice(0,7) : null) : [];
  const area=text.match(/^;\s*printable_area\s*=\s*([^\r\n]+)/im);
  let bed=null;
  if(area) {
    const points=[...area[1].matchAll(/(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)/gi)].map(m=>[+m[1],+m[2]]);
    if(points.length>=3) {const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);bed={width:maxX-minX,depth:maxY-minY,minX,minY,maxX,maxY};}
  }
  for(const raw of text.split(/\r?\n/)) {
    const divider=raw.indexOf(';');
    const comment=divider<0?'':raw.slice(divider+1).trim();
    // Match standalone tags, never embedded templates in a slicer configuration comment.
    if(/^(?:FLUSH_START|FLUSH_END|WIPE_START|WIPE_END|WIPE_TOWER_START|WIPE_TOWER_END|TOWER_START|TOWER_END)$/.test(comment)) {
      pathId++;
      if(comment==='FLUSH_START')flushing=true;
      if(comment==='FLUSH_END')flushing=false;
      if(comment==='WIPE_START')wiping=true;
      if(comment==='WIPE_END')wiping=false;
      if(comment==='WIPE_TOWER_START'||comment==='TOWER_START')tower=true;
      if(comment==='WIPE_TOWER_END'||comment==='TOWER_END')tower=false;
    }
    if(/^CHANGE_LAYER$/.test(comment))pathId++;
    const w=comment.match(/^(?:LINE_WIDTH|WIDTH)\s*:\s*([\d.]+)/i);
    const h=comment.match(/^(?:LAYER_HEIGHT|HEIGHT)\s*:\s*([\d.]+)/i);
    const f=comment.match(/^(?:FEATURE|TYPE)\s*:\s*(.+)/i);
    if(w&&+w[1]>0)width=+w[1];
    if(h&&+h[1]>0)height=+h[1];
    if(f&&feature!==f[1].trim()){feature=f[1].trim();pathId++;}
    const line=(divider<0?raw:raw.slice(0,divider)).trim().toUpperCase();
    const command=line.match(/^([GMT]\d+(?:\.\d+)?)/)?.[1];
    if(!command)continue;
    const p={};
    // E is an extrusion parameter, not scientific notation in compact G-code.
    for(const m of line.slice(command.length).matchAll(/([A-Z])\s*(-?(?:\d+\.?\d*|\.\d+))/g))p[m[1]]=+m[2];
    if(command==='G90')absolute=true;
    if(command==='G91')absolute=false;
    if(command==='M82')absE=true;
    if(command==='M83')absE=false;
    if(command==='G20')throw Error('此文件使用英寸单位，请导出毫米单位 G-code（G21）。');
    if(command[0]==='T') {
      const n=+command.slice(1);
      if(![255,1000,1100].includes(n)&&Number.isInteger(n)&&n>=0&&n<256&&n!==tool){tool=n;pathId++;}
      continue;
    }
    if(command==='G92') {
      if(p.E!==undefined)e=p.E;
      if(p.X!==undefined)x=p.X;
      if(p.Y!==undefined)y=p.Y;
      if(p.Z!==undefined)z=p.Z;
      if(p.X!==undefined||p.Y!==undefined||p.Z!==undefined)pathId++;
      continue;
    }
    if(!['G0','G1','G2','G3'].includes(command))continue;
    const nx=p.X===undefined?x:(absolute?p.X:x+p.X);
    const ny=p.Y===undefined?y:(absolute?p.Y:y+p.Y);
    const nz=p.Z===undefined?z:(absolute?p.Z:z+p.Z);
    let de=p.E===undefined?0:(absE?p.E-e:p.E);
    if(p.E!==undefined)e=absE?p.E:e+p.E;
    let debt=debts.get(tool)||0;
    if(de<0){debt-=de;pathId++;}
    else if(de>0){const recovered=Math.min(debt,de);debt-=recovered;de-=recovered;if(recovered>0)pathId++;}
    debts.set(tool,debt);
    if((command==='G2'||command==='G3')&&p.R!==undefined)throw Error('此 demo 暂不支持 R 格式圆弧；请关闭切片器圆弧拟合后重新导出，或使用 I/J 圆弧。');
    const pts=[[x,y,z]];
    if((command==='G2'||command==='G3')&&(p.I!==undefined||p.J!==undefined)) {
      const cx=x+(p.I||0),cy=y+(p.J||0),r=Math.hypot(x-cx,y-cy),a=Math.atan2(y-cy,x-cx);
      let sweep=Math.atan2(ny-cy,nx-cx)-a;
      if(command==='G2'&&sweep>=0)sweep-=Math.PI*2;
      if(command==='G3'&&sweep<=0)sweep+=Math.PI*2;
      const n=Math.max(2,Math.ceil(Math.abs(sweep)*r/.5));
      for(let k=1;k<n;k++)pts.push([cx+r*Math.cos(a+sweep*k/n),cy+r*Math.sin(a+sweep*k/n),z+(nz-z)*k/n]);
      // Slicer-rounded I/J centers need not land exactly on the command's endpoint.
      pts.push([nx,ny,nz]);
    } else pts.push([nx,ny,nz]);
    const xyMove=pts.some(p=>Math.hypot(p[0]-x,p[1]-y)>.0001);
    if(de>1e-9&&xyMove) {
      const kind=flushing?'Flush':wiping?'Wipe':tower?'Wipe tower':feature;
      const auxiliary=flushing||wiping||tower||/purge|flush|wipe|prime|skirt|brim|tower|custom/i.test(kind);
      const layerKey=nz.toFixed(3);
      if(!auxiliary&&!layers.has(layerKey))layers.set(layerKey,layers.size);
      for(let k=1;k<pts.length;k++) {
        const a=pts[k-1],b=pts[k],len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
        if(len<1e-9)continue;
        total+=len;
        if(!auxiliary)modelTotal+=len;
        segments.push({a,b,tool,width,height,feature:kind,auxiliary,pathId,layerIndex:auxiliary?-1:layers.get(layerKey),end:total,modelEnd:modelTotal});
      }
    } else if(Math.hypot(nx-x,ny-y,nz-z)>.0001)pathId++;
    x=nx;y=ny;z=nz;
  }
  if(!segments.length)throw Error('没有找到有效挤出路径，请导入切片后的 G-code。');
  return {segments,colors,layers:layers.size,total,modelTotal,bed};
}
export function sample(){let s='; filament_colour = #ef7848;#f2dfad;#397f83\nG90\nM83\n';for(let l=1;l<=140;l++){const z=l*.2,r=22+5*Math.sin(l/140*Math.PI*3);s+=`; LAYER_HEIGHT: 0.2\nG0 Z${z}\n`;for(let wall=0;wall<3;wall++){const rr=r-wall*.45;for(let i=0;i<=100;i++){if(i%25===0)s+=`T${Math.floor(i/25)%3}\n`;s+=`${i===0?'G0':'G1'} X${(64+rr*Math.cos(i/100*Math.PI*2)).toFixed(3)} Y${(64+rr*Math.sin(i/100*Math.PI*2)).toFixed(3)}${i?' E0.08':''}\n`;}}}return s;}
