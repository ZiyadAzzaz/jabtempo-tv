const worker=new Worker('/assets/pose-worker.js');
const result=document.getElementById('result');
const timeout=setTimeout(()=>{result.textContent='FAIL: local model initialization timed out';worker.terminate();},30000);
worker.onmessage=({data})=>{if(data.type==='ready'||data.type==='error'){clearTimeout(timeout);result.textContent=data.type==='ready'?'PASS: local worker, WASM and pose model initialized; camera and microphone off':'FAIL: '+data.message;worker.terminate();}};
worker.onerror=event=>{clearTimeout(timeout);result.textContent='FAIL: worker error '+event.message;worker.terminate();};
worker.postMessage({type:'init'});
