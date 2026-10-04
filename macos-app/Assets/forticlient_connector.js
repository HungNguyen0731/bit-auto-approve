const fs = require('fs');
const { execSync } = require('child_process');

const nodePath = "/Applications/FortiClient.app/Contents/Resources/app.asar.unpacked/assets/js/guimessenger_jyp.node";

function runConnector(action = "connect") {
  // 1. Dismiss any error dialog in FortiClient and trigger Connect
  try {
    const triggerScript = `
      tell application "System Events"
        if exists process "FortiClient" then
          tell process "FortiClient"
            try
              -- Click OK on error dialog if present
              click (first button of window 1 whose name is "OK" or name is "Đồng ý" or description is "OK")
              delay 0.3
            end try
            try
              click (first button of window 1 whose name is "Connect" or name is "Kết nối" or description is "Connect")
            on error
              try
                key code 36
              end try
            end try
          end tell
        end if
      end tell
    `;
    execSync(`osascript -e '${triggerScript.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
  } catch (_) {}

  // 2. Interact with native FortiClient addon headlessly
  if (fs.existsSync(nodePath)) {
    try {
      const m = require(nodePath);
      const listRaw = m.GetVPNConnectionList();
      const list = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw;
      const vpn = (list && list[0]) ? list[0] : { connection_name: "VPN DEV", type: "ipsec" };
      const payload = JSON.stringify({
        connection_name: vpn.connection_name || "VPN DEV",
        connection_type: vpn.type || "ipsec",
        username: "hungnv@msm.com.vn",
        password: "",
        save_password: 1
      });

      if (action === "disconnect" || action === "reset") {
        try { m.DisconnectTunnel(payload); } catch (_) {}
        if (action === "disconnect") {
          console.log("Disconnected tunnel cleanly.");
          return;
        }
      }

      if (action === "connect" || action === "reset") {
        try { if (typeof m.SetGuiHandle === 'function') m.SetGuiHandle(); } catch (_) {}
        m.ConnectTunnel(payload);
        console.log("Called ConnectTunnel headlessly for:", vpn.connection_name);
      }
    } catch (e) {
      console.log("Native addon note:", e.message);
    }
  }

  // 3. Background UI click on Connect button without activating window
  if (action === "connect" || action === "reset") {
    try {
      const clickScript = `
        tell application "System Events"
          if exists process "FortiClient" then
            tell process "FortiClient"
              try
                click (first button of window 1 whose name is "Connect" or description is "Connect")
              end try
            end tell
          end if
        end tell
      `;
      execSync(`osascript -e '${clickScript.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
    } catch (_) {}
  }
}

const action = process.argv[2] || "connect";
runConnector(action);
