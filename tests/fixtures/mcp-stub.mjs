// A minimal MCP server over stdio for adapter tests: real protocol frames, no package, no network.
// env STUB_SERVER_NAME renames the reported server; tools mirror what the real packages expose in shape.
import process from 'node:process';
const name=process.env.STUB_SERVER_NAME??'stub';
let buffer='';
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
const tools=[
 {name:'echo',description:'Echo the given text back.',inputSchema:{type:'object',properties:{text:{type:'string',description:'Text to echo'}},required:['text'],additionalProperties:false}},
 {name:'fail',description:'Always reports failure.',inputSchema:{type:'object',properties:{reason:{type:'string'}},required:['reason']}},
 {name:'browser_navigate',description:'Open a page in the stand-in browser.',inputSchema:{type:'object',properties:{url:{type:'string',description:'The page address'}},required:['url'],additionalProperties:false}},
 {name:'browser_fill_form',description:'Fill the form fields of the open page.',inputSchema:{type:'object',properties:{fields:{type:'object',description:'Field names to values'}},required:['fields'],additionalProperties:false}},
];
const handle=(message)=>{
 const {id,method,params}=message;
 if(method==='initialize')return send({jsonrpc:'2.0',id,result:{protocolVersion:params.protocolVersion,serverInfo:{name,version:'1.0.0'}}});
 if(id===undefined||method.startsWith('notifications/'))return;
 if(method==='tools/list')return send({jsonrpc:'2.0',id,result:{tools}});
 if(method==='tools/call'){
  const tool=params.name,arguments_=params.arguments??{};
  if(tool==='echo')return send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'echo: '+arguments_.text}]}});
  if(tool==='fail')return send({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:'stub failed: '+arguments_.reason}]}});
  if(tool==='browser_navigate')return send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'Opened '+arguments_.url+' in the stand-in browser.'}]}});
  if(tool==='browser_fill_form')return send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'Filled the form: '+Object.keys(arguments_.fields).join(', ')}]}});
  return send({jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool '+tool}});
 }
 send({jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown method '+method}});
};
const dispatch=line=>{try{handle(JSON.parse(line));}catch{}};
for await (const chunk of process.stdin){
 buffer+=chunk.toString('utf8');
 let at;
 while((at=buffer.indexOf('\n'))>=0){dispatch(buffer.slice(0,at));buffer=buffer.slice(at+1);}
}
