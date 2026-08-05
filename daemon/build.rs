fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        // uiAccess="true" lets the daemon remap inside elevated windows (Task Manager,
        // UAC prompts), but Windows refuses to launch a uiAccess binary unless it is
        // Authenticode-signed *and* installed in a secure location — an unsigned build
        // fails with "The requested operation requires elevation". So it is opt-in:
        // set KEYMAPPER_UIACCESS=1 when building a signed release.
        println!("cargo:rerun-if-env-changed=KEYMAPPER_UIACCESS");
        let ui_access = std::env::var("KEYMAPPER_UIACCESS").as_deref() == Ok("1");

        let mut res = winres::WindowsResource::new();
        res.set_manifest(&format!(
            r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="{ui_access}" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#
        ));
        res.compile().unwrap();
    }
}
