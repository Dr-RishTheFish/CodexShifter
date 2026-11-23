const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const Core=require('../Resources/core.js');
function harness(){
 const elements=new Map();const make=()=>({textContent:'',value:'',style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},append(){},replaceChildren(){},querySelector(){return make()},setAttribute(){},add(){},remove(){}});
 const get=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id)};const sent=[];
 const context={console,ShifterCore:Core,CarSounds:class{shift(){}},Option:function(){},setTimeout:()=>1,clearTimeout(){},setInterval(){},getComputedStyle:()=>({left:'0px'}),document:{getElementById:get,querySelectorAll:()=>[],addEventListener(){},createElement:make,createElementNS:make},webkit:{messageHandlers:{native:{postMessage:m=>sent.push(m)}}}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../Resources/app.js','utf8'),context);
 const models=[{model:'fast',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'deep',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}];context.testModels=models;vm.runInContext("shifter=new ShifterCore.Shifter(testModels);thread='cli-thread';session='terminal';connected=true",context);return{sent,run:code=>vm.runInContext(code,context)}
}
test('neutral and reverse positions survive polling of same default model',()=>{const h=harness();h.run("shifter.shift('R');selectActual({model:'fast',reasoningEffort:'low'})");assert.equal(h.run('shifter.gear'),'R')});
test('external CLI model changes update the selected gear',()=>{const h=harness();h.run("selectActual({model:'deep',reasoningEffort:'high'})");assert.equal(h.run('shifter.gear'),'2');assert.equal(h.run('shifter.selection.effort'),'high')});
test('shifting updates only terminal model and effort and never sends chat input',async()=>{const h=harness();h.run("shifter.shift('2')");const promise=h.run('applySelection()');const req=h.sent.find(m=>m.method==='thread/settings/update');assert.ok(req);assert.deepEqual(JSON.parse(JSON.stringify(req.params)),{threadId:'cli-thread',model:'deep',effort:'high'});h.run(`receiveNative({id:${req.id},result:{}})`);await promise;assert.equal(h.sent.some(m=>m.method==='turn/start'),false)});
test('terminal disconnect clears target identity',()=>{const h=harness();h.run("receiveNative({method:'native/disconnected'})");assert.equal(h.run('thread'),null);assert.equal(h.run('session'),null);assert.equal(h.run('connected'),false)});

test('a new CLI thread takes over automatic targeting while the old thread stays loaded', async () => {
 const h = harness();
 h.run(`
   const liveThreads = [
     { id: 'cli-thread', createdAt: 1, model: 'fast', reasoningEffort: 'low' },
     { id: 'new-thread', createdAt: 2, model: 'fast', reasoningEffort: 'low' },
   ];
   rpc = async (method, params) => {
     switch (method) {
       case 'native/sessions': return [{ id: 'terminal', cwd: '/test', started: 1 }];
       case 'thread/loaded/list': return { data: liveThreads.map(t => t.id) };
       case 'thread/read': return { thread: liveThreads.find(t => t.id === params.threadId) };
       case 'native/telemetry': return {};
       case 'thread/settings/update': window.shiftTarget = params.threadId; return {};
     }
   };
 `);
 await h.run('poll()');
 await h.run("shifter.shift('2'); applySelection()");
 assert.equal(h.run('window.shiftTarget'), 'new-thread');
 await h.run("$('threads').onchange({ target: { value: 'cli-thread' } })");
 await h.run('poll()');
 await h.run("shifter.shift('2'); applySelection()");
 assert.equal(h.run('window.shiftTarget'), 'cli-thread');
});
