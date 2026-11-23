import base64,hashlib,json,os,socket,struct,sys,threading,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'Resources'))
from transport import LocalWebSocket
import bridge
class TransportTests(unittest.TestCase):
 def pair(self):
  a,b=socket.socketpair();self.addCleanup(a.close);self.addCleanup(b.close)
  ws=LocalWebSocket.__new__(LocalWebSocket);ws.socket=a;ws.lock=threading.Lock();return ws,b
 def test_client_frames_are_masked_for_all_length_encodings(self):
  for size in (5,200,70000):
   ws,peer=self.pair();payload={'text':'x'*size};sender=threading.Thread(target=ws.send,args=(payload,));sender.start()
   def exact(n):
    b=b''
    while len(b)<n:b+=peer.recv(n-len(b))
    return b
   first,second=exact(2);self.assertEqual(first,129);self.assertTrue(second&128);n=second&127
   if n==126:n=struct.unpack('!H',exact(2))[0]
   elif n==127:n=struct.unpack('!Q',exact(8))[0]
   mask=exact(4);data=exact(n);self.assertEqual(json.loads(bytes(c^mask[i%4] for i,c in enumerate(data))),payload);sender.join()
 def test_fragmented_json_survives_interleaved_ping(self):
  ws,peer=self.pair();peer.sendall(b'\x01\x05{"a":'+b'\x89\x01x'+b'\x80\x021}')
  self.assertEqual(ws.receive(),{'a':1});self.assertEqual(peer.recv(2)[0],0x8a)
 def test_closed_socket_fails_instead_of_spinning(self):
  ws,peer=self.pair();peer.close()
  with self.assertRaises(EOFError):ws.receive()
 def test_rollout_usage_reads_last_reported_tokens(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'rollout.jsonl';p.write_text(json.dumps({'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'total_tokens':100,'output_tokens':20},'last_token_usage':{'input_tokens':70,'output_tokens':20},'model_context_window':1000}}})+'\n')
   bridge.paths={'test':str(p)};self.assertEqual(bridge.usage('test')['total']['totalTokens'],100);self.assertEqual(bridge.usage('unknown'),{})
if __name__=='__main__':unittest.main()
