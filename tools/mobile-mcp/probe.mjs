import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { ROOT } from './device-guard.mjs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw new Error('Activate amazon-tv');
const client=new Client({name:'jabtempo-mobile-stdio-probe',version:'0.1.0'});
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(ROOT,'tools/mobile-mcp/scoped-proxy.mjs')],env:{...process.env},stderr:'ignore'}));
  const {tools}=await client.listTools();
  const version=JSON.parse(readFileSync(resolve(ROOT,'tools/mobile-mcp/node_modules/@mobilenext/mobile-mcp/package.json'),'utf8')).version;
  const report={utc:new Date().toISOString(),status:'PASS',setup:'local stdio initialize + tools/list only',package:'@mobilenext/mobile-mcp',version,license:'Apache-2.0',tools:tools.map(t=>({name:t.name,inputSchema:t.inputSchema})),deviceActionsExecuted:false,phonePaired:false,telemetryDisabled:true,cloudToolsExposed:false,scope:'Local handshake does not verify current chat connection or device operation'};
  mkdirSync(resolve(ROOT,'results'),{recursive:true});writeFileSync(resolve(ROOT,'results/mobile_mcp_check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,version,tools:report.tools.map(t=>t.name),deviceActionsExecuted:false}));
}finally{await client.close();}
