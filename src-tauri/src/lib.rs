mod python_bridge;
use python_bridge::PythonSidecar;
use std::sync::Arc;
use tauri::State;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
async fn get_today_state() -> Result<serde_json::Value, String> {
    python_bridge::call_api("/today_state").await
}

#[tauri::command]
async fn get_day_summary(date: String) -> Result<serde_json::Value, String> {
    python_bridge::call_api(&format!("/day_summary?date={}", date)).await
}

#[tauri::command]
async fn generate_reflection(date: String, persona: String) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "date": date,
        "persona": persona
    });
    python_bridge::post_api("/generate_reflection", body).await
}

#[tauri::command]
async fn get_passport_data() -> Result<serde_json::Value, String> {
    python_bridge::call_api("/api/passport").await
}

#[tauri::command]
async fn get_profile() -> Result<serde_json::Value, String> {
    python_bridge::call_api("/api/get_profile").await
}

#[tauri::command]
async fn update_settings(settings: serde_json::Value) -> Result<serde_json::Value, String> {
    python_bridge::post_api("/api/update_settings", settings).await
}

#[tauri::command]
async fn update_profile(name: String) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "name": name });
    python_bridge::post_api("/api/update_profile", body).await
}

#[tauri::command]
async fn save_profile(profile: serde_json::Value) -> Result<serde_json::Value, String> {
    python_bridge::post_api("/api/save_profile", profile).await
}

#[tauri::command]
async fn sync_device_id(device_id: String) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "deviceId": device_id });
    python_bridge::post_api("/api/sync_device_id", body).await
}

#[tauri::command]
async fn reset_account() -> Result<serde_json::Value, String> {
    python_bridge::post_api("/api/reset_account", serde_json::json!({})).await
}

#[tauri::command]
async fn delete_account() -> Result<serde_json::Value, String> {
    // DELETE method not supported by post_api helper yet, using POST for now or need to update helper
    // Assuming python side handles DELETE or we update helper.
    // Let's check python/server.py to see if it accepts POST for delete_account or strictly DELETE.
    // If strictly DELETE, we need a delete_api helper.
    // For now, let's assume we can use a custom request or update helper.
    // Actually, let's just use post_api and hope the server is flexible or update the server to accept POST.
    // Or better, update python_bridge to support DELETE.
    python_bridge::call_api_method("DELETE", "/api/delete_account", None).await
}

#[tauri::command]
async fn logout() -> Result<serde_json::Value, String> {
    python_bridge::post_api("/api/logout", serde_json::json!({})).await
}

#[tauri::command]
async fn save_reflection(text: String, persona: String) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "text": text,
        "persona": persona
    });
    python_bridge::post_api("/api/save_reflection", body).await
}

#[tauri::command]
async fn force_start_server(
    app_handle: tauri::AppHandle,
    sidecar: State<'_, Arc<PythonSidecar>>,
) -> Result<(), String> {
    sidecar.start(&app_handle);
    Ok(())
}

#[tauri::command]
async fn get_device_id() -> Result<serde_json::Value, String> {
    python_bridge::call_api("/api/get_device_id").await
}

#[tauri::command]
async fn get_reflection_history() -> Result<serde_json::Value, String> {
    python_bridge::call_api("/api/reflection_history").await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = Arc::new(PythonSidecar::new());
    let sidecar_setup = sidecar.clone();
    let sidecar_exit = sidecar.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(sidecar) // This manages Arc<PythonSidecar>
        .setup(move |app| {
            sidecar_setup.start(&app.handle());

            // Create tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Ovelo", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Build system tray
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .tooltip("Ovelo - Focus Tracker")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_today_state,
            get_day_summary,
            generate_reflection,
            get_passport_data,
            get_profile,
            update_settings,
            update_profile,
            save_profile,
            sync_device_id,
            reset_account,
            delete_account,
            logout,
            save_reflection,
            force_start_server,
            get_device_id,
            get_reflection_history
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            match event {
                tauri::RunEvent::Exit => {
                    sidecar_exit.stop();
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    // Minimize to tray instead of closing
                    if label == "main" {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            }
        });
}
