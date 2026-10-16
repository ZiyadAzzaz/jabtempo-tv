// Local iPhone setup: HTTPS product + public-certificate bootstrap. Never serves private keys.
import {createServer} from 'node:http';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,X509Certificate} from 'node:crypto';
import {startDevServer} from './dev_server.mjs';
export async function startIphoneServer(options={}) {
  if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw Error('Activate amazon-tv first.');
  const root=resolve(options.root??'.');
  if(!process.env.JABTEMPO_TLS_PFX||!process.env.JABTEMPO_HOST)throw Error('Dot-source scripts/setup_iphone_tls.ps1 -LanIP YOUR_WIFI_IPV4 first.');
  function publicFile(value,name) {
    if(!value)throw Error('Missing iPhone certificate setup.');
    const actual=realpathSync(value),inside=relative(realpathSync(resolve(root,'.cache/iphone-tls')),actual);
    if(inside.startsWith('..')||isAbsolute(inside)||!actual.endsWith(name))throw Error('Invalid public certificate file.');
    return readFileSync(actual);
  }
  const profile=publicFile(process.env.JABTEMPO_IPHONE_PROFILE,'jabtempo-iphone.mobileconfig');
  const certificate=publicFile(process.env.JABTEMPO_IPHONE_ROOT,'jabtempo-root.cer');
  if(!new X509Certificate(certificate).ca)throw Error('iPhone needs a root CA certificate.');
  const fingerprint=createHash('sha256').update(certificate).digest('hex');
  const bootstrap=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/jabtempo-iphone.mobileconfig'){res.setHeader('Content-Type','application/x-apple-aspen-config');res.end(profile);}
    else if(pathname==='/jabtempo-root.cer'){res.setHeader('Content-Type','application/pkix-cert');res.end(certificate);}
    else if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>JabTempo iPhone setup</title><h1>JabTempo iPhone connection</h1><p>This page provides the public local HTTPS certificate only. It does not start your camera.</p><p>Compare this SHA256 with the laptop terminal before installing:</p><p>${fingerprint}</p><p><a href="/jabtempo-iphone.mobileconfig">Download JabTempo certificate profile</a></p><p>Read docs/how_to_play.md for installation, trust and removal steps. The profile contains one root certificate; no VPN or management enrollment.</p></html>`);}
    else{res.writeHead(404);res.end('Not found');}
  });
  const port=options.bootstrapPort??8788;
  const relay=await startDevServer({...options,root});
  try{await new Promise((ok,fail)=>{bootstrap.once('error',fail);bootstrap.listen(port,process.env.JABTEMPO_HOST,ok);});}
  catch(error){await relay.close();throw error;}
  return {relay,bootstrap,close:async()=>{await new Promise(resolveClose=>bootstrap.close(resolveClose));await relay.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const service=await startIphoneServer();
  const host=process.env.JABTEMPO_HOST;
  console.log(`Laptop GAME: https://${host}:8787/tv-web`);
  console.log(`iPhone CAMERA (Safari): https://${host}:8787/phone`);
  console.log(`iPhone certificate setup only: http://${host}:8788/`);
  console.log('Keep this terminal open. Certificate trust and Private-network firewall access require your manual setup; no phone has been tested.');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await service.close();process.exit(0);});
}
