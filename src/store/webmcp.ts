import {games,publicGame,searchGames} from './catalog.ts';
type Tool={name:string;description:string;inputSchema:Record<string,unknown>;annotations:{readOnlyHint:boolean};execute:(input:Record<string,unknown>)=>Promise<unknown>};
type Context={registerTool:(tool:Tool,options?:{signal:AbortSignal})=>void|Promise<void>;unregisterTool?:(name:string)=>void};
export function registerCatalogTools(onSearch:(query:string)=>void,doc:Document=document,nav:Navigator=navigator){
 const modern=(doc as Document&{modelContext?:Context}).modelContext;
 const context=modern||(nav as Navigator&{modelContext?:Context}).modelContext;
 if(!context)return()=>{};
 const controller=new AbortController(),names:string[]=[];
 const tools:Tool[]=[
  {name:'search_games',description:'Search Play games by name, genre, model or offline availability. Updates the visible search results.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:120}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},execute:async({query})=>{if(typeof query!=='string'||query.length>120)throw new Error('Use a query of at most 120 characters.');onSearch(query);return {content:[{type:'text',text:JSON.stringify({games:searchGames(query).map(publicGame)})}]};}},
  {name:'get_game',description:'Read a game’s controls, modes, install URL and model configuration. Does not start a match or make model calls.',inputSchema:{type:'object',properties:{slug:{type:'string',enum:games.map(g=>g.slug)}},required:['slug'],additionalProperties:false},annotations:{readOnlyHint:true},execute:async({slug})=>{const game=games.find(g=>g.slug===slug);if(!game)throw new Error('Unknown game.');return {content:[{type:'text',text:JSON.stringify(publicGame(game))}]};}}
 ];
 for(const tool of tools){try{const result=context.registerTool(tool,modern?{signal:controller.signal}:undefined);names.push(tool.name);Promise.resolve(result).catch(()=>{});}catch{}}
 return()=>{controller.abort();if(!modern)for(const name of names)context.unregisterTool?.(name);};
}
