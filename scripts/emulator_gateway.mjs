import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';

// Emulator-only transport adapter. The owner phone continues using the existing HTTPS relay.
// Frames and application timestamps pass through unchanged; only the socket transport changes.
export async function startEmulatorGateway({target,caFile,port=8789}={}) {
  const upstreamUrl=new URL(target);
  if(upstreamUrl.protocol!=='wss:'||upstreamUrl.pathname!=='/bridge'||upstreamUrl.username||upstreamUrl.password||upstreamUrl.search||upstreamUrl.hash)throw new Error('Target must be a credential-free wss://host:port/bridge URL.');
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Port must be 0..65535.');
  // keytool exports DER. X509Certificate accepts either DER or PEM and emits PEM for Node TLS.
  const ca=new X509Certificate(readFileSync(caFile)).toString();
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.url==='/connection'&&req.method==='GET'){
      const phoneUrl=new URL('/phone',upstreamUrl);phoneUrl.protocol='https:';
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({phoneUrl:phoneUrl.href}));return;
    }
    if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true,"loopbackOnly":true,"upstreamTLSVerificationRequired":true,"upstreamHealthChecked":false}');}
    else {res.writeHead(404);res.end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const pairs=new Set();
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/bridge'||socket.remoteAddress!=='127.0.0.1'||pairs.size>=16){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',downstream=>{
    const upstream=new WebSocket(upstreamUrl,{ca,rejectUnauthorized:true,handshakeTimeout:10000,maxPayload:16384,perMessageDeflate:false});
    const pair={downstream,upstream};pairs.add(pair);
    let queued=[],queuedBytes=0,ending=false;
    const end=(code=1011,reason='Relay connection ended')=>{
      if(ending)return;ending=true;queued=[];queuedBytes=0;pairs.delete(pair);
      for(const socket of [downstream,upstream]){
        if(socket.readyState===WebSocket.OPEN)socket.close(code,reason);
        else if(socket.readyState===WebSocket.CONNECTING)socket.terminate();
      }
      const timer=setTimeout(()=>{downstream.terminate();upstream.terminate();},1000);timer.unref();
    };
    const forward=(socket,data,binary)=>{
      if(socket.readyState!==WebSocket.OPEN||socket.bufferedAmount+data.length>65536){end(1013,'Relay backpressure limit');return;}
      socket.send(data,{binary},error=>{if(error)end();});
    };
    upstream.on('open',()=>{
      for(const message of queued){if(ending)break;forward(upstream,message.data,message.binary);}
      queued=[];queuedBytes=0;
    });
    downstream.on('message',(data,binary)=>{
      if(ending)return;
      if(upstream.readyState===WebSocket.CONNECTING){
        if(queued.length>=32||queuedBytes+data.length>65536){end(1013,'Relay queue limit');return;}
        queued.push({data,binary});queuedBytes+=data.length;
      }else forward(upstream,data,binary);
    });
    upstream.on('message',(data,binary)=>{if(!ending)forward(downstream,data,binary);});
    downstream.on('error',()=>end());upstream.on('error',()=>end(1011,'Trusted HTTPS relay unavailable'));
    downstream.on('close',()=>end(1000));upstream.on('close',code=>end(code===1000?1000:1011));
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
  return {server,url:`ws://127.0.0.1:${server.address().port}/bridge`,close:async()=>{
    for(const {downstream,upstream}of pairs){downstream.terminate();upstream.terminate();}
    await new Promise(accept=>wss.close(accept));await new Promise(accept=>server.close(accept));
  }};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),values={};
  for(let i=0;i<args.length;i+=2){if(!['--target','--ca','--port'].includes(args[i])||!args[i+1])throw new Error('Usage: node scripts/emulator_gateway.mjs [--target wss://LAN-IP:8787/bridge] [--ca public-root.cer] [--port 8789]');values[args[i]]=args[i+1];}
  const target=values['--target']??process.env.JABTEMPO_PUBLIC_RELAY_URL,caFile=values['--ca']??process.env.JABTEMPO_IPHONE_ROOT;
  if(!target||!caFile)throw new Error('Dot-source scripts/setup_iphone_tls.ps1 first, or supply --target and --ca.');
  const gateway=await startEmulatorGateway({target,caFile,port:Number(values['--port']??8789)});
  console.log(`Emulator relay: ${gateway.url} (Android emulator uses ws://10.0.2.2:${gateway.server.address().port}/bridge). Upstream certificate validation enabled; phone HTTPS server is unchanged.`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await gateway.close();process.exit(0);});
}
