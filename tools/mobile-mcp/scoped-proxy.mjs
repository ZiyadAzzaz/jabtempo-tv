import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ALLOWED_TOOLS,validateTool } from './policy.mjs';
import { ROOT,assertForeground,audit } from './device-guard.mjs';
if(process.env.CONDA_DEFAULT_ENV!=='amazon-tv')throw new Error('Activate amazon-tv');
const downstream=new Client({name:'jabtempo-scoped-mobile-lab',version:'0.1.0'});
await downstream.connect(new StdioClientTransport({command:process.execPath,args:[resolve(ROOT,'tools/mobile-mcp/node_modules/@mobilenext/mobile-mcp/lib/index.js')],
  env:{...process.env,MOBILEMCP_DISABLE_TELEMETRY:'1',MOBILEMCP_LEGACY_ROBOT:'1',LOG_FILE:''},stderr:'ignore'}));
const server=new Server({name:'jabtempo-scoped-mobile-lab',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>{const {tools}=await downstream.listTools();return {tools:tools.filter(t=>ALLOWED_TOOLS.includes(t.name))};});
let queue=Promise.resolve();
server.setRequestHandler(CallToolRequestSchema,request=>{
  const run=async()=>{
    const {name,arguments:args={}}=request.params;
    try{
      validateTool(name,args,{root:ROOT});
      if(name==='mobile_list_available_devices')return await downstream.callTool({name,arguments:args});
      audit(args.device,name);
      if(!['mobile_launch_app','mobile_terminate_app'].includes(name))await assertForeground(args.device);
      if(name==='mobile_save_screenshot')mkdirSync(resolve(ROOT,'local_private/device_lab'),{recursive:true});
      const result=await downstream.callTool({name,arguments:args});
      if(['mobile_take_screenshot','mobile_save_screenshot','mobile_list_elements_on_screen'].includes(name))await assertForeground(args.device);
      audit(args.device,name,result.isError?'failed':'success');return result;
    }catch{if(args.device)audit(args.device,name,'refused or failed');return {isError:true,content:[{type:'text',text:'Action refused or failed. Use only the configured JabTempo device/app; check SDK and foreground scope.'}]};}
  };
  const current=queue.then(run,run);queue=current.catch(()=>{});return current;
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',async()=>{await downstream.close();process.exit(0);});
