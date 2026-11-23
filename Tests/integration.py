"""Live smoke test: uses existing Codex authentication and two small model turns."""
import json,os,selectors,subprocess,sys,time,tempfile
from pathlib import Path
cli=os.environ.get('CODEX_SHIFTER_CLI',str(Path.home()/'.local/bin/codex'))
p=subprocess.Popen([cli,'app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
s=selectors.DefaultSelector();s.register(p.stdout,selectors.EVENT_READ);buf=b'';seq=0;events=[]
def send(obj):p.stdin.write((json.dumps(obj)+'\n').encode());p.stdin.flush()
def recv(deadline):
 global buf
 while time.time()<deadline:
  if b'\n' in buf:
   line,buf=buf.split(b'\n',1)
   if line:return json.loads(line)
  elif s.select(min(1,max(0,deadline-time.time()))):
   data=os.read(p.stdout.fileno(),65536)
   if not data:raise RuntimeError('Codex exited')
   buf+=data
 raise TimeoutError('Codex response timeout')
def handle(msg):
 if 'method' in msg and 'id' in msg:
  send({'id':msg['id'],'error':{'code':-32601,'message':'Smoke test does not use tools'}})
 else:events.append(msg)
def request(method,params):
 global seq
 seq+=1;rid=seq;send({'id':rid,'method':method,'params':params});deadline=time.time()+60
 while True:
  msg=recv(deadline)
  if msg.get('id')==rid and 'method' not in msg:
   if 'error' in msg:raise RuntimeError(msg['error'])
   return msg['result']
  handle(msg)
try:
 request('initialize',{'clientInfo':{'name':'codex_shifter_smoke','version':'1.0.0'}});send({'method':'initialized'})
 models=request('model/list',{})['data'];models=[m for m in models if not m['hidden']]
 assert len(models)>1
 with tempfile.TemporaryDirectory(prefix='codex-shifter-smoke-') as cwd:
  r=request('thread/start',{'cwd':cwd,'model':models[0]['model'],'sandbox':'read-only','approvalPolicy':'on-request','approvalsReviewer':'user','ephemeral':True})
  tid=r['thread']['id']
  for i,m in enumerate(models[:2]):
   events.clear();marker=f'SHIFTER_OK_{i+1}'
   turn=request('turn/start',{'threadId':tid,'model':m['model'],'effort':m['defaultReasoningEffort'],'input':[{'type':'text','text':f'Reply with exactly {marker}. Do not use tools.'}]})['turn']
   deadline=time.time()+150
   while not any(e.get('method')=='turn/completed' and e.get('params',{}).get('turn',{}).get('id')==turn['id'] for e in events):handle(recv(deadline))
   completed=next(e['params']['turn'] for e in events if e.get('method')=='turn/completed' and e['params']['turn']['id']==turn['id'])
   assert completed['status']=='completed',completed.get('error')
   text=''.join(e.get('params',{}).get('delta','') for e in events if e.get('method')=='item/agentMessage/delta')
   assert marker in text,(marker,text)
   print('PASS turn',i+1,m['model'],m['defaultReasoningEffort'],text,flush=True)
  print('PASS two live model turns on one thread',flush=True)
finally:
 p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill();p.wait()
