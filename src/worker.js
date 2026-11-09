import {parse,pack,simplify,transferables} from './parser.js';
self.onmessage=({data})=>{try{
 const parsed=parse(typeof data==='string'?data:new TextDecoder().decode(data));
 // Huge prints get a slightly coarser (still sub-visible) curve tolerance.
 parsed.segments=simplify(parsed.segments,parsed.segments.length>2000000?.03:.006);
 const result=pack(parsed);self.postMessage({result},transferables(result));
}catch(e){self.postMessage({error:e.message});}};
