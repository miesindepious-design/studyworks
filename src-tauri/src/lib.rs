use tauri_plugin_updater::UpdaterExt;

/// Open a URL in the system browser — used for Google OAuth so the redirect
/// lands in a real browser that can handle cookies and https:// correctly.
#[tauri::command]
async fn open_in_browser(url: String, _app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Check for and install updates.
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes   = update.body.clone().unwrap_or_default();
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            Ok(format!(
                r#"{{"status":"updated","version":"{}","notes":"{}"}}"#,
                version,
                notes.replace('"', "'")
            ))
        }
        Ok(None) => Ok(r#"{"status":"up_to_date"}"#.to_string()),
        Err(e)   => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            check_for_updates,
            open_in_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
