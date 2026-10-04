const fs = require('fs');

const nodePath = "/Applications/FortiClient.app/Contents/Resources/app.asar.unpacked/assets/js/guimessenger_jyp.node";

function runConnector(action = "connect") {
  console.log(`[FortiConnector] Action: ${action}`);

  if (!fs.existsSync(nodePath)) {
    console.error("[FortiConnector] Node addon not found at", nodePath);
    return;
  }

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
      try { if (typeof m.CancelTunnel === 'function') m.CancelTunnel(); } catch (_) {}
      if (action === "disconnect") {
        console.log("[FortiConnector] Disconnected cleanly.");
        return;
      }
    }

    if (action === "connect" || action === "reset") {
      try { if (typeof m.SetGuiHandle === 'function') m.SetGuiHandle(); } catch (_) {}
      const res = m.ConnectTunnel(payload);
      console.log(`[FortiConnector] ConnectTunnel sent for ${vpn.connection_name || 'VPN'}:`, res);
    }
  } catch (err) {
    console.error("[FortiConnector] Native addon error:", err.message);
  }

  // Also dismiss any stuck modal error dialog in FortiClient in background
  try {
    const { exec } = require('child_process');
    const dismissScript = `
      tell application "System Events"
        if exists process "FortiClient" then
          tell process "FortiClient"
            try
              click (first button of window 1 whose name is "OK" or name is "Đồng ý" or description is "OK")
            end try
            try
              click (first button of window 1 whose name is "Connect" or name is "Kết nối" or description is "Connect")
            end try
          end tell
        end if
      end tell
    `;
    exec(`osascript -e '${dismissScript.replace(/'/g, "'\\''")}'`, { timeout: 1500 }, () => {});
  } catch (_) {}
}

const action = process.argv[2] || "connect";
runConnector(action);
