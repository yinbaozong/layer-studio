import {parse} from './parser.js';
self.onmessage=({data})=>{try{self.postMessage({result:parse(data)});}catch(e){self.postMessage({error:e.message});}};
