"""Local Unix-socket WebSocket transport for Codex's documented --remote interface."""
import base64, hashlib, json, os, socket, struct, threading

class LocalWebSocket:
    def __init__(self, path):
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.settimeout(15)
        self.socket.connect(path)
        self.lock = threading.Lock()
        key = base64.b64encode(os.urandom(16)).decode()
        request = ('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                   'Sec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.socket.sendall(request.encode())
        header = bytearray()
        while not header.endswith(b'\r\n\r\n'):
            header.extend(self.exact(1))
            if len(header)>32768: raise ValueError('Invalid WebSocket handshake')
        expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        lines=header.decode().split('\r\n')
        fields=dict(line.split(':',1) for line in lines[1:] if ':' in line)
        fields={k.lower():v.strip() for k,v in fields.items()}
        if ' 101 ' not in lines[0] or fields.get('sec-websocket-accept')!=expected:
            self.close();raise ValueError('Codex WebSocket handshake failed')
        self.socket.settimeout(None)
    def exact(self,n):
        data=bytearray()
        while len(data)<n:
            part=self.socket.recv(n-len(data))
            if not part: raise EOFError('Codex disconnected')
            data.extend(part)
        return bytes(data)
    def frame(self,data,opcode=1):
        mask=os.urandom(4);n=len(data)
        header=bytes([0x80|opcode,0x80|(n if n<126 else 126 if n<65536 else 127)])
        if n>=126:header+=struct.pack('!H' if n<65536 else '!Q',n)
        with self.lock:self.socket.sendall(header+mask+bytes(c^mask[i%4] for i,c in enumerate(data)))
    def send(self,obj):self.frame(json.dumps(obj,separators=(',',':')).encode())
    def receive(self):
        chunks=bytearray();message_type=None
        while True:
            first,second=self.exact(2);opcode=first&15;n=second&127
            if first&0x70:raise ValueError('Unsupported WebSocket extension')
            if n==126:n=struct.unpack('!H',self.exact(2))[0]
            elif n==127:n=struct.unpack('!Q',self.exact(8))[0]
            if n+len(chunks)>32*1024*1024:raise ValueError('Codex message exceeds 32 MiB')
            mask=self.exact(4) if second&128 else None
            data=self.exact(n)
            if mask:data=bytes(c^mask[i%4] for i,c in enumerate(data))
            if opcode==8:raise EOFError('Codex closed the connection')
            if opcode==9:self.frame(data,10);continue
            if opcode==10:continue
            if opcode in (1,2):
                if message_type is not None:raise ValueError('Invalid fragment sequence')
                message_type=opcode
            elif opcode!=0 or message_type is None:raise ValueError('Invalid WebSocket frame')
            chunks.extend(data)
            if first&128:
                if message_type!=1:raise ValueError('Expected JSON text')
                return json.loads(chunks)
    def close(self):
        try:self.socket.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        self.socket.close()
