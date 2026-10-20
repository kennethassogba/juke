import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {catalogTools,runCatalogTool} from './catalog-api.js';
import {origin as siteOrigin} from './store/catalog.ts';

export async function handleMcp(request){
 if(request.headers.has('origin')&&request.headers.get('origin')!==siteOrigin)return new Response('Invalid origin',{status:403});
 if(!['POST','GET','DELETE'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'POST, GET, DELETE'}});
 // A fresh server/transport per request keeps public lookups stateless and isolated.
 const server=new Server({name:'play',version:'1.0.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalogTools.map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}))}));
 server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  try{return {content:[{type:'text',text:JSON.stringify(await runCatalogTool(params.name,params.arguments||{}))}]};}
  catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
 });
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);
 try{
  // Bound the body even when Content-Length is absent. Pass the parsed body to the SDK.
  let parsedBody;
  if(request.method==='POST'){
   const reader=request.body?.getReader();let size=0,parts=[];
   if(!reader)return new Response('JSON body required',{status:400});
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();return new Response('Request too large',{status:413});}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   try{parsedBody=JSON.parse(new TextDecoder().decode(bytes));}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},{status:400});}
  }
  return await transport.handleRequest(request,{parsedBody});
 }finally{await server.close();}
}
