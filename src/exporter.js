import {
  Quality, canEncodeVideo, Output, Mp4OutputFormat, WebMOutputFormat,
  CanvasSource, StreamTarget, BufferTarget,
} from 'mediabunny';

const sdkDefaults={Output,Mp4OutputFormat,WebMOutputFormat,CanvasSource,StreamTarget,BufferTarget};

/** One configuration is shared by capability probing and actual encoding. */
export function createVideoConfig(height=1080,codec='avc') {
  if(![720,1080].includes(Number(height))) throw new RangeError('请选择 720p 或 1080p。');
  if(!['avc','vp9','vp8'].includes(codec)) throw new RangeError('不支持的视频编码格式。');
  height=Number(height);
  return {
    codec,width:height===1080?1920:1280,height,frameRate:30,
    quality:new Quality({bitrate:height===1080?12000000:7000000}),
    keyFrameInterval:2,latencyMode:'quality',hardwareAcceleration:'no-preference',
  };
}

/** Probe before enabling the export button, so a click may immediately open a save picker. */
export async function probeEncoding(height=1080,{canEncode=canEncodeVideo}={}) {
  for(const codec of ['avc','vp9','vp8']) {
    const config=createVideoConfig(height,codec);
    const {codec:unused,keyFrameInterval,...options}=config;
    if(await canEncode(codec,options)) return {
      codec,ext:codec==='avc'?'mp4':'webm',mime:codec==='avc'?'video/mp4':'video/webm',config,
    };
  }
  throw new Error('当前浏览器无法编码所选分辨率。请使用新版 Chrome / Edge，或尝试 720p。');
}

const abortError=()=>new DOMException('已取消导出，未保存不完整视频。','AbortError');
const defaultYield=()=>new Promise(resolve=>setTimeout(resolve,0));

/**
 * Offline deterministic export. Caller sets canvas to output size and restores its view in finally.
 * renderFrame receives {index,time,progress,totalFrames}; time is seconds, progress is 0..1.
 * This function owns a supplied writable stream: commits once on success, aborts on failure.
 * Without a stream it returns a downloadable Blob. It never calls a file picker itself.
 */
export async function exportVideo({
  canvas,renderFrame,height=1080,duration=20,encoding,stream,
  onProgress=()=>{},isCancelled=()=>false,yieldControl=defaultYield,
},sdk=sdkDefaults) {
  if(typeof renderFrame!=='function') throw new TypeError('renderFrame 必须是函数。');
  if(!Number.isFinite(duration)||duration<=0||duration>120) throw new RangeError('视频时长必须在 0 到 120 秒之间。');
  let output,source,fileWriter,committed=false;
  try {
    // Keep the underlying file uncommitted until the SDK successfully finishes its container.
    // Mediabunny closes targets on cancellation too, so passing the file directly would commit a partial file.
    if(stream) fileWriter=stream.getWriter();
    if(isCancelled()) throw abortError();
    encoding??=await probeEncoding(height);
    const config=createVideoConfig(height,encoding.codec);
    if(canvas.width!==config.width||canvas.height!==config.height) throw new Error(`渲染画布尺寸必须是 ${config.width} × ${config.height}。`);
    const {width,height:outputHeight,frameRate,codec,...sourceConfig}=config;
    const frameCount=Math.round(duration*frameRate);
    if(frameCount<1) throw new RangeError('视频至少需要一帧。');
    const mp4=codec==='avc',ext=mp4?'mp4':'webm',mime=mp4?'video/mp4':'video/webm';
    const target=fileWriter
      ?new sdk.StreamTarget(new WritableStream({write:chunk=>fileWriter.write(chunk)}))
      :new sdk.BufferTarget();
    output=new sdk.Output({format:mp4?new sdk.Mp4OutputFormat({fastStart:false}):new sdk.WebMOutputFormat(),target});
    source=new sdk.CanvasSource(canvas,{codec,...sourceConfig});
    output.addVideoTrack(source,{frameRate});
    await output.start();
    for(let index=0;index<frameCount;index++) {
      if(isCancelled()) throw abortError();
      const time=index/frameRate;
      await renderFrame({index,time,progress:time/duration,totalFrames:frameCount});
      if(isCancelled()) throw abortError();
      await source.add(time,1/frameRate);
      onProgress({completed:index+1,total:frameCount,progress:(index+1)/frameCount,time});
      // Yield every frame so cancel and paint keep responding even with a fast hardware encoder.
      await yieldControl();
    }
    if(isCancelled()) throw abortError();
    source.close();
    await output.finalize();
    if(fileWriter){await fileWriter.close();committed=true;}
    return {blob:fileWriter?null:new Blob([target.buffer],{type:mime}),codec,ext,mime,width,height:outputHeight,frameRate,frameCount,duration:frameCount/frameRate};
  } catch(error) {
    try{await output?.cancel();}catch{}
    if(fileWriter&&!committed){try{await fileWriter.abort(error);}catch{}}
    throw error;
  } finally {
    try{fileWriter?.releaseLock();}catch{}
  }
}
