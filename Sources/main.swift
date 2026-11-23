import Cocoa
import WebKit

final class LineFramer {
    private var buffer = Data()
    func append(_ data: Data) -> [[String:Any]] {
        buffer.append(data)
        var messages = [[String:Any]]()
        while let end = buffer.firstIndex(of:10) {
            let line = buffer.prefix(upTo:end)
            buffer.removeSubrange(...end)
            if let object = try? JSONSerialization.jsonObject(with:line) as? [String:Any] { messages.append(object) }
        }
        return messages
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var process: Process?
    var input: FileHandle?
    var generation = UUID()
    let readQueue = DispatchQueue(label: "shifter.reader")
    var resources: URL { Bundle.main.resourceURL! }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Codex Shifter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem); let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        for (title,action,key) in [("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 414,height: 790), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "Codex Shifter"; window.minSize = NSSize(width: 414,height: 760)
        window.maxSize = NSSize(width: 520,height: 1000)
        window.level = .floating
        window.backgroundColor = NSColor(calibratedRed: 0.04,green: 0.05,blue: 0.06,alpha: 1)
        window.contentView = web; window.delegate = self; window.center(); window.makeKeyAndOrderFront(nil)
        window.setFrameAutosaveName("CodexShifterCompanionWindow")
        web.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
        NSApp.activate(ignoringOtherApps: true)
    }
    func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data:data,encoding:.utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.web.evaluateJavaScript("window.receiveNative(\(json))", completionHandler:nil) }
    }
    func reply(_ id: Any, result: Any) { emit(["id":id,"result":result]) }
    func fail(_ id: Any, _ message: String) { emit(["id":id,"error":["message":message]]) }
    func start(_ id: Any, restart: Bool) {
        if process?.isRunning == true && !restart { reply(id,result:["connected":true]); return }
        generation = UUID()
        let currentGeneration = generation
        process?.terminate()
        process = nil
        input = nil
        let p = Process()
        p.executableURL = URL(fileURLWithPath:"/usr/bin/python3")
        p.arguments = [resources.appendingPathComponent("bridge.py").path]
        p.currentDirectoryURL = resources
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe(); p.standardInput = stdin; p.standardOutput = stdout; p.standardError = stderr
        input = stdin.fileHandleForWriting
        let framer = LineFramer()
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            self?.readQueue.async { [weak self] in
                guard let self = self else {return}
                for obj in framer.append(data) {
                    DispatchQueue.main.async { if self.generation == currentGeneration { self.emit(obj) } }
                }
            }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in if handle.availableData.isEmpty {handle.readabilityHandler = nil} }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { if self?.generation == currentGeneration { self?.emit(["method":"native/disconnected","params":["status":proc.terminationStatus]]) } }
        }
        do { try p.run(); process = p; reply(id,result:["connected":true]) }
        catch { fail(id,error.localizedDescription) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.isFileURL,
              url.deletingLastPathComponent().standardizedFileURL == resources.standardizedFileURL,
              let body = message.body as? [String:Any] else { return }
        let method = body["method"] as? String ?? ""
        let id = body["id"] ?? 0
        let params = body["params"] as? [String:Any] ?? [:]
        switch method {
        case "native/start": start(id, restart: params["restart"] as? Bool ?? false)
        case "native/preferences": reply(id,result:UserDefaults.standard.dictionary(forKey:"preferences") ?? [:])
        case "native/save": UserDefaults.standard.set(params,forKey:"preferences"); reply(id,result:[:])
        case "native/pin": window.level = (params["pinned"] as? Bool ?? false) ? .floating : .normal; reply(id,result:[:])
        default:
            let allowed:Set<String> = ["initialize","initialized","model/list","thread/loaded/list","thread/read","thread/settings/update","native/sessions","native/connect","native/telemetry"]
            guard allowed.contains(method), process?.isRunning == true else { fail(id,"Codex is disconnected or the request is unsupported."); return }
            do { var data = try JSONSerialization.data(withJSONObject:body); data.append(10); try input?.write(contentsOf:data) } catch { fail(id,error.localizedDescription) }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        let allowed = navigationAction.request.url?.isFileURL == true && navigationAction.request.url?.deletingLastPathComponent().standardizedFileURL == resources.standardizedFileURL
        decisionHandler(allowed ? .allow : .cancel)
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        process?.terminate(); return .terminateNow
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool { true }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
