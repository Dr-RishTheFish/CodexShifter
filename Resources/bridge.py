import json,os,sys,threading
from pathlib import Path
from transport import LocalWebSocket
ROOT=Path.home()/'Library/Application Support/CodexShifter/sessions'
lock=threading.Lock();connection=None;generation=0;paths={}
def emit(message):
    with lock:print(json.dumps(message,separators=(',',':')),flush=True)
def sessions():
    result=[]
    for path in ROOT.glob('*.json'):
        try:
            data=json.loads(path.read_text());os.kill(data['pid'],0);os.kill(data['serverPid'],0)
            if Path(data['socket']).is_socket():result.append(data)
        except (OSError,ValueError,KeyError,TypeError):continue
    return sorted(result,key=lambda x:x['started'],reverse=True)
def reader(ws,token):
    try:
        while token==generation:
            msg=ws.receive()
            if token!=generation:return
            thread=msg.get('result',{}).get('thread') if isinstance(msg.get('result'),dict) else None
            if thread and thread.get('path'):paths[thread['id']]=thread['path']
            # Companion never takes over server requests or approval dialogs.
            if not ('id' in msg and 'method' in msg):emit(msg)
    except (OSError,EOFError,ValueError) as e:
        if token==generation:emit({'method':'native/disconnected','params':{'message':str(e)}})
def usage(thread_id):
    path=paths.get(thread_id)
    if not path:return {}
    try:
        with open(path,'rb') as f:
            f.seek(0,2);size=f.tell();start=max(0,size-262144);f.seek(start);data=f.read()
        lines=data.splitlines()
        if start:lines=lines[1:]
        for line in reversed(lines):
            try:item=json.loads(line)
            except (ValueError,UnicodeDecodeError):continue
            p=item.get('payload',{})
            if item.get('type')=='event_msg' and p.get('type')=='token_count' and p.get('info'):
                info=p['info']
                def convert(d):return {'inputTokens':d.get('input_tokens',0),'outputTokens':d.get('output_tokens',0),'cachedInputTokens':d.get('cached_input_tokens',0),'totalTokens':d.get('total_tokens',0)}
                return {'total':convert(info.get('total_token_usage',{})),'last':convert(info.get('last_token_usage',{})),'modelContextWindow':info.get('model_context_window')}
    except OSError:pass
    return {}
def main():
    global connection,generation,paths
    try:
        for line in sys.stdin:
            request=json.loads(line);rid=request.get('id');method=request.get('method');params=request.get('params',{})
            try:
                if method=='native/sessions':emit({'id':rid,'result':sessions()})
                elif method=='native/connect':
                    session=next((s for s in sessions() if s['id']==params.get('sessionId')),None)
                    if not session:raise ValueError('Terminal session has ended')
                    generation+=1
                    if connection:connection.close()
                    paths={};connection=LocalWebSocket(session['socket'])
                    threading.Thread(target=reader,args=(connection,generation),daemon=True).start()
                    emit({'id':rid,'result':{'connected':True}})
                elif method=='native/telemetry':emit({'id':rid,'result':usage(params.get('threadId'))})
                elif method in ('initialize','initialized','model/list','thread/loaded/list','thread/read','thread/settings/update'):
                    if not connection:raise ValueError('Launch codex-shifter in your terminal first')
                    if method=='thread/settings/update' and (set(params)-{'threadId','model','effort'}):raise ValueError('Only model and effort can be changed')
                    connection.send(request)
                else:raise ValueError('Unsupported companion request')
            except Exception as e:emit({'id':rid,'error':{'message':str(e)}})
    finally:
        generation+=1
        if connection:connection.close()
if __name__=='__main__':main()
