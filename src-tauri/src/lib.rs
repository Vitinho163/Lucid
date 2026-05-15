use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

struct OverlayState {
    pub pass_through: bool,
}

struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[tauri::command]
fn set_ghost_mode(enable: bool, state: tauri::State<'_, Arc<Mutex<OverlayState>>>, window: tauri::Window, app_handle: tauri::AppHandle) {
    let mut lock = state.lock().unwrap();
    lock.pass_through = enable;
    window.set_ignore_cursor_events(enable).unwrap();
    
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let shortcut_enter = Shortcut::new(Some(Modifiers::SHIFT), Code::Enter);
        if enable {
            let _ = app_handle.global_shortcut().register(shortcut_enter);
        } else {
            let _ = app_handle.global_shortcut().unregister(shortcut_enter);
        }
    }
    
    app_handle.emit("overlay-mode-changed", enable).unwrap();
}

#[tauri::command]
fn send_to_sidecar(payload: String, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().as_mut() {
        let msg = format!("{}\n", payload);
        let _ = child.write(msg.as_bytes()).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sidecar not running".to_string())
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_ghost_mode, send_to_sidecar, exit_app])
        .manage(Arc::new(Mutex::new(OverlayState { pass_through: false })))
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            window.set_ignore_cursor_events(false).unwrap();

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let shortcut_z = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyZ);
                let shortcut_enter = Shortcut::new(Some(Modifiers::SHIFT), Code::Enter);
                
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut_pressed, event| {
                            if event.state() == ShortcutState::Pressed {
                                if shortcut_pressed == &shortcut_z {
                                    let window = app.get_webview_window("main").unwrap();
                                    let state = app.state::<Arc<Mutex<OverlayState>>>();
                                    let mut lock = state.lock().unwrap();

                                    lock.pass_through = false;
                                    window
                                        .set_ignore_cursor_events(false)
                                        .expect("failed to toggle cursor events");

                                    // Disable ghost mode
                                    app.emit("overlay-mode-changed", false).unwrap();
                                    
                                    // Also unregister the Shift+Enter shortcut since ghost mode is off
                                    let _ = app.global_shortcut().unregister(shortcut_enter);
                                } else if shortcut_pressed == &shortcut_enter {
                                    // Triggered Shift+Enter while in Ghost Mode
                                    let window = app.get_webview_window("main").unwrap();
                                    window.set_focus().unwrap(); // Bring window to front so input works
                                    app.emit("overlay-focus-input", ()).unwrap();
                                }
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(shortcut_z)?;
            }

            let app_data_dir = app.path().app_data_dir().unwrap();
            std::fs::create_dir_all(&app_data_dir).unwrap();

            use tauri_plugin_shell::ShellExt;
            let sidecar_cmd = app.shell().sidecar("whatsapp-sidecar").unwrap()
                .arg(app_data_dir.to_str().unwrap());
            
            let (mut rx, child) = sidecar_cmd.spawn().unwrap();
            
            app.manage(SidecarState(Mutex::new(Some(child))));
            
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        let text = String::from_utf8_lossy(&line);
                        println!("SIDECAR LOG: {}", text);
                        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(msg_type) = msg["type"].as_str() {
                                match msg_type {
                                    "qr" => {
                                        app_handle.emit("whatsapp-qr", msg["data"].as_str().unwrap_or("")).unwrap();
                                    }
                                    "ready" => {
                                        app_handle.emit("whatsapp-ready", "").unwrap();
                                    }
                                    "disconnected" => {
                                        app_handle.emit("whatsapp-disconnected", msg["data"].as_str().unwrap_or("")).unwrap();
                                    }
                                    "chats" => {
                                        app_handle.emit("whatsapp-chats", &msg["data"]).unwrap();
                                    }
                                    "messages" => {
                                        app_handle.emit("whatsapp-messages", &msg).unwrap();
                                    }
                                    "message_sent" => {
                                        app_handle.emit("whatsapp-message-sent", &msg["data"]).unwrap();
                                    }
                                    "incoming_message" => {
                                        app_handle.emit("whatsapp-incoming-message", &msg["data"]).unwrap();
                                    }
                                    "message_ack" => {
                                        app_handle.emit("whatsapp-message-ack", &msg["data"]).unwrap();
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<SidecarState>();
                let mut child_guard = state.0.lock().unwrap();
                if let Some(child) = child_guard.take() {
                    let _ = child.kill();
                }
            }
        });
}
