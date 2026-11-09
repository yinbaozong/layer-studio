import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Quality, canEncodeVideo, VideoSampleSource} from 'mediabunny';
import {createVideoConfig, probeEncoding, exportVideo, RESOLUTIONS} from '../src/exporter.js';

test('SDK reproduces numeric-quality rejection and accepts the exported 720/1080 configurations',async()=>{
 await assert.rejects(canEncodeVideo('avc',{width:1920,height:1080,frameRate:30,quality:12000000}),/must be a Quality/);
 for(const height of [720,1080]){
  const config=createVideoConfig(height,'avc');
  assert.ok(config.quality instanceof Quality);
  assert.equal(config.width,height===720?1280:1920);
  assert.equal(config.height,height); assert.equal(config.frameRate,30);
  const {codec,keyFrameInterval,...probe}=config;
  await assert.doesNotReject(canEncodeVideo(codec,probe));
  const {width,height:ignoredHeight,frameRate,...sourceConfig}=config;
  assert.doesNotThrow(()=>new VideoSampleSource(sourceConfig));
 }
});
test('1440p and 4K presets have matching widths and higher bitrates',()=>{
 const q=createVideoConfig(1440,'avc'),u=createVideoConfig(2160,'vp9'),f=createVideoConfig(1080,'avc');
 assert.equal(q.width,2560);assert.equal(u.width,3840);assert.equal(u.height,2160);
 assert.ok(u.quality instanceof Quality);
 assert.throws(()=>createVideoConfig(900,'avc'),RangeError);
 assert.ok(RESOLUTIONS[2160].bitrate>RESOLUTIONS[1440].bitrate&&RESOLUTIONS[1440].bitrate>RESOLUTIONS[1080].bitrate);
 assert.equal(f.width,1920);
});
test('probes full resolution and falls back explicitly to WebM',async()=>{
 const calls=[];
 const result=await probeEncoding(1080,{canEncode:async(codec,options)=>{calls.push([codec,options]);return codec==='vp9';}});
 assert.equal(result.ext,'webm'); assert.equal(result.codec,'vp9');
 assert.deepEqual(calls.map(c=>[c[0],c[1].width,c[1].height,c[1].frameRate]),[['avc',1920,1080,30],['vp9',1920,1080,30]]);
});
function fakeSdk(events){
 class Target {constructor(stream){this.stream=stream;this.buffer=new Uint8Array([1,2,3]).buffer;}}
 class Source {constructor(canvas,config){assert.ok(config.quality instanceof Quality);this.canvas=canvas;}async add(t,d){events.push(['add',t,d]);await new Promise(r=>setTimeout(r,1));}close(){events.push(['source-close']);}}
 class Output {constructor({target}){this.target=target;}addVideoTrack(source,options){events.push(['track',options.frameRate]);}async start(){events.push(['start']);if(this.target.stream)this.writer=this.target.stream.getWriter();}async finalize(){events.push(['finalize']);if(this.writer){await this.writer.write({type:'write',position:0,data:new Uint8Array([1,2,3])});await this.writer.close();}}async cancel(){events.push(['cancel']);if(this.writer)await this.writer.close();}}
 return {Output,CanvasSource:Source,StreamTarget:Target,BufferTarget:Target,Mp4OutputFormat:class {},WebMOutputFormat:class {}};
}
test('slow frames keep deterministic 30fps timing, commit one stream close, and complete progress',async()=>{
 const events=[],progress=[];let closes=0,aborts=0;
 const stream=new WritableStream({write(chunk){assert.equal(chunk.type,'write');},close(){closes++;},abort(){aborts++;}});
 const result=await exportVideo({canvas:{width:1280,height:720},height:720,duration:1,encoding:{codec:'avc'},stream,renderFrame:async frame=>{events.push(['render',frame.index,frame.time]);},onProgress:p=>progress.push(p),yieldControl:async()=>{}},fakeSdk(events));
 assert.equal(result.frameCount,30);assert.equal(result.blob,null);assert.equal(closes,1);assert.equal(aborts,0);
 assert.deepEqual(events.filter(e=>e[0]==='add'),Array.from({length:30},(_,i)=>['add',i/30,1/30]));
 assert.equal(progress.at(-1).progress,1);
 assert.equal(events.filter(e=>e[0]==='finalize').length,1);
});
test('cancel aborts output file instead of committing a truncated video',async()=>{
 const events=[];let renders=0,closes=0,aborts=0;
 const stream=new WritableStream({close(){closes++;},abort(){aborts++;}});
 await assert.rejects(exportVideo({canvas:{width:1280,height:720},height:720,duration:1,encoding:{codec:'avc'},stream,renderFrame:()=>{renders++;},isCancelled:()=>renders>=3,yieldControl:async()=>{}},fakeSdk(events)),{name:'AbortError'});
 assert.equal(closes,0);assert.equal(aborts,1);assert.equal(events.filter(e=>e[0]==='cancel').length,1);assert.equal(events.filter(e=>e[0]==='finalize').length,0);
});
test('an encoder error aborts the supplied stream and propagates its actionable cause',async()=>{
 const events=[];let aborted=0,closed=0;
 const stream=new WritableStream({close(){closed++;},abort(){aborted++;}});
 const sdk=fakeSdk(events);sdk.CanvasSource=class{async add(){throw Error('encoder failed');}close(){}};
 await assert.rejects(exportVideo({canvas:{width:1280,height:720},height:720,duration:1,encoding:{codec:'avc'},stream,renderFrame:()=>{},yieldControl:async()=>{}},sdk),/encoder failed/);
 assert.equal(aborted,1);assert.equal(closed,0);
});
test('without filesystem support returns a correctly labelled downloadable WebM',async()=>{
 const result=await exportVideo({canvas:{width:1280,height:720},height:720,duration:1/30,encoding:{codec:'vp8'},renderFrame:()=>{},yieldControl:async()=>{}},fakeSdk([]));
 assert.equal(result.ext,'webm');assert.equal(result.blob.type,'video/webm');assert.equal(result.blob.size,3);
});
