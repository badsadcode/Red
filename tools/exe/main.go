// Oregon Lakehouse — Windows launcher.
//
// One self-contained .exe: the whole game (HTML, JS, three.js, models, textures,
// sectors) is embedded. On launch it serves the game on 127.0.0.1 and opens it in an
// Edge app window (falls back to the default browser). The page pings /ping every
// couple of seconds; when the pings stop (window closed) the launcher exits.
//
// Build: tools/build_exe.sh  (stages the files into tools/exe/game, then cross-compiles)
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed all:game
var gameFS embed.FS

var lastPing atomic.Int64

// A fixed port keeps the browser's localStorage (your save) stable between launches.
var ports = []int{47913, 47914, 47915, 47916, 47917}

func main() {
	mime.AddExtensionType(".glb", "model/gltf-binary")
	mime.AddExtensionType(".js", "text/javascript")
	sub, err := fs.Sub(gameFS, "game")
	if err != nil {
		fail(err)
	}
	mux := http.NewServeMux()
	files := http.FileServer(http.FS(sub))
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.WriteHeader(204)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	var ln net.Listener
	for _, p := range ports {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			break
		}
	}
	if ln == nil {
		fail(fmt.Errorf("no free port (is the game already running?): %v", err))
	}
	url := "http://" + ln.Addr().String() + "/index.html"
	go func() { _ = http.Serve(ln, mux) }()

	openWindow(url)

	// Exit when the game window has been closed for a while.
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		lp := lastPing.Load()
		if lp == 0 {
			if time.Since(start) > 3*time.Minute { // never connected
				os.Exit(0)
			}
			continue
		}
		if time.Now().Unix()-lp > 12 {
			os.Exit(0)
		}
	}
}

func openWindow(url string) {
	if runtime.GOOS != "windows" {
		fmt.Println("Oregon Lakehouse is running at", url)
		_ = exec.Command("xdg-open", url).Start()
		return
	}
	// Edge app mode: a clean window without tabs or an address bar.
	edges := []string{
		os.Getenv("ProgramFiles(x86)") + `\Microsoft\Edge\Application\msedge.exe`,
		os.Getenv("ProgramFiles") + `\Microsoft\Edge\Application\msedge.exe`,
		os.Getenv("LocalAppData") + `\Microsoft\Edge\Application\msedge.exe`,
	}
	for _, e := range edges {
		if _, err := os.Stat(e); err == nil {
			profile := os.Getenv("LocalAppData") + `\OregonLakehouse\browser`
			cmd := exec.Command(e, "--app="+url, "--user-data-dir="+profile,
				"--window-size=1280,800", "--autoplay-policy=no-user-gesture-required",
				"--no-first-run", "--no-default-browser-check")
			if cmd.Start() == nil {
				return
			}
		}
	}
	// Fallback: whatever browser is the default.
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func fail(err error) {
	msg := "Oregon Lakehouse could not start:\n\n" + err.Error()
	if runtime.GOOS == "windows" {
		// a message box via PowerShell, since this is a GUI-subsystem exe with no console
		ps := `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('` +
			strings.ReplaceAll(msg, "'", "''") + `', 'Oregon Lakehouse')`
		_ = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps).Run()
	} else {
		fmt.Fprintln(os.Stderr, msg)
	}
	os.Exit(1)
}
