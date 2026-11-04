// Freero's desktop app (#176; docs/desktop.md): one window showing a Freero instance — the
// operator's by default, any self-hosted one by choice — with freero:// links, the system's
// menus and notifications, and updates from a signed release channel once the owner sets one up.
//
// The window shows the web app as it is served (so it is always the server's own version, and its
// offline copies and service worker work as in a browser). The only things the page may ask the
// app for are the notification plugin's commands, and only from the chosen server's origin.
mod links;

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::CapabilityBuilder,
    menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;

pub use links::{parse_instance, target_for};

/// A setting baked in at build time; CI passes unset repository variables as empty strings.
fn build_setting(value: Option<&'static str>) -> Option<&'static str> {
    value.map(str::trim).filter(|v| !v.is_empty())
}
/// The server a build opens unless told otherwise: the operator's (FREERO_INSTANCE_URL at build time).
fn default_instance_text() -> &'static str {
    build_setting(option_env!("FREERO_INSTANCE_URL")).unwrap_or("https://freero.app")
}
/// Where updates are announced (a Tauri update manifest), and the key they are signed with. Both
/// are set at build time by the owner's release workflow; without a key the app never updates itself.
fn update_endpoint() -> &'static str {
    build_setting(option_env!("FREERO_UPDATER_ENDPOINT")).unwrap_or("https://github.com/antonber/freero/releases/latest/download/latest.json")
}
fn update_pubkey() -> Option<&'static str> {
    build_setting(option_env!("FREERO_UPDATER_PUBKEY"))
}

const MAIN: &str = "main";
const SERVER_WINDOW: &str = "server";

/// The chosen server, for the whole run (changing it restarts the app).
struct Instance(Mutex<Url>);

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    instance: Option<String>,
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

/// FREERO_INSTANCE_URL when the app is started with it, else the server chosen in the app, else the build's.
fn chosen_instance<R: Runtime>(app: &AppHandle<R>) -> Url {
    let from_env = std::env::var("FREERO_INSTANCE_URL").ok();
    let saved = settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .and_then(|s| s.instance);
    [from_env, saved, Some(default_instance_text().to_string())]
        .into_iter()
        .flatten()
        .find_map(|candidate| parse_instance(&candidate))
        .unwrap_or_else(|| Url::parse("https://freero.app/").expect("a valid default"))
}

fn instance_of<R: Runtime>(app: &AppHandle<R>) -> Url {
    app.state::<Instance>().0.lock().map(|u| u.clone()).unwrap_or_else(|e| e.into_inner().clone())
}

/// Shows `url` in the main window and brings it forward.
fn show_in_main<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let js = format!("window.location.assign({})", serde_json::to_string(url.as_str()).unwrap_or_default());
        let _ = window.eval(&js);
        bring_forward(&window);
    }
}

fn bring_forward<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// A freero:// (or the server's own https) link: opened in the main window; anything else is ignored.
fn open_link<R: Runtime>(app: &AppHandle<R>, link: &str) {
    if let Some(target) = target_for(&instance_of(app), link) {
        show_in_main(app, &target);
    }
}

fn eval_in_main<R: Runtime>(app: &AppHandle<R>, js: &str) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.eval(js);
    }
}

fn notify<R: Runtime>(app: &AppHandle<R>, body: &str) {
    let _ = app.notification().builder().title("Freero").body(body).show();
}

/// The small window where people choose their server (the app's own page, ui/index.html).
fn open_server_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(SERVER_WINDOW) {
        bring_forward(&window);
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SERVER_WINDOW, WebviewUrl::App("index.html".into()))
        .title("Freero server")
        .inner_size(520.0, 380.0)
        .resizable(false)
        .build();
}

/// The app's own pages are served by Tauri itself (never by a server).
fn is_app_page(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

#[tauri::command]
fn current_instance(app: AppHandle) -> String {
    instance_of(&app).to_string()
}

#[tauri::command]
fn default_instance() -> String {
    default_instance_text().to_string()
}

/// Saves the server people chose and restarts on it. Only the app's own page may ask: a page a
/// server sent must never point the app at another server.
#[tauri::command]
fn set_instance(app: AppHandle, webview: tauri::Webview, url: String) -> Result<String, String> {
    let from = webview.url().map_err(|e| e.to_string())?;
    if !is_app_page(&from) {
        return Err("not allowed".into());
    }
    let instance = parse_instance(&url).ok_or_else(|| "Enter the https address of your Freero server, like https://freero.example.com".to_string())?;
    let path = settings_path(&app).ok_or_else(|| "No place to keep the setting on this computer".to_string())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let settings = Settings { instance: Some(instance.to_string()) };
    fs::write(&path, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    app.restart();
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Freero"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .license(Some("MIT"))
        .website(Some("https://freero.app"))
        .build();
    let app_menu = SubmenuBuilder::new(app, "Freero")
        .item(&PredefinedMenuItem::about(app, Some("About Freero"), Some(about))?)
        .separator()
        .item(&MenuItemBuilder::with_id("settings", "Settings…").accelerator("CmdOrCtrl+,").build(app)?)
        .item(&MenuItemBuilder::with_id("server", "Change server…").build(app)?)
        .item(&MenuItemBuilder::with_id("updates", "Check for updates…").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("dashboard", "Dashboard").accelerator("CmdOrCtrl+Shift+H").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("back", "Back").accelerator("CmdOrCtrl+[").build(app)?)
        .item(&MenuItemBuilder::with_id("forward", "Forward").accelerator("CmdOrCtrl+]").build(app)?)
        .item(&MenuItemBuilder::with_id("reload", "Reload").accelerator("CmdOrCtrl+R").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let instance = instance_of(app);
    match id {
        "dashboard" => {
            if let Ok(url) = instance.join("app") {
                show_in_main(app, &url);
            }
        }
        "settings" => {
            if let Ok(url) = instance.join("settings") {
                show_in_main(app, &url);
            }
        }
        "server" => open_server_window(app),
        "updates" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move { check_for_update(handle, true).await });
        }
        "back" => eval_in_main(app, "history.back()"),
        "forward" => eval_in_main(app, "history.forward()"),
        "reload" => eval_in_main(app, "location.reload()"),
        _ => {}
    }
}

/// Looks for a signed update on the release channel and installs it (then restarts). Without a
/// signing key in this build there is no channel: the app says so when asked, and stays as it is.
async fn check_for_update<R: Runtime>(app: AppHandle<R>, asked: bool) {
    use tauri_plugin_updater::UpdaterExt;
    let Some(pubkey) = update_pubkey() else {
        if asked {
            notify(&app, "This build doesn’t update itself. Download the latest version from your Freero server’s operator.");
        }
        return;
    };
    let Ok(endpoint) = Url::parse(update_endpoint()) else { return };
    let updater = match app.updater_builder().pubkey(pubkey).endpoints(vec![endpoint]).and_then(|b| b.build()) {
        Ok(updater) => updater,
        Err(_) => return,
    };
    match updater.check().await {
        Ok(Some(update)) => {
            if !asked {
                notify(&app, &format!("Freero {} is available. Choose Freero › Check for updates… to install it.", update.version));
                return;
            }
            if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                app.restart();
            } else {
                notify(&app, "The update couldn’t be installed. Try again later.");
            }
        }
        Ok(None) => {
            if asked {
                notify(&app, "You have the latest version of Freero.");
            }
        }
        Err(_) => {
            if asked {
                notify(&app, "Couldn’t check for updates. Try again when you’re online.");
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (a freero:// link on Windows and Linux) hands its link to this one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN) {
                bring_forward(&window);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![current_instance, default_instance, set_instance])
        .menu(|app| build_menu(app))
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            let instance = chosen_instance(&handle);
            app.manage(Instance(Mutex::new(instance.clone())));

            // The chosen server's pages may use the system's notifications — nothing else.
            let origin = instance.origin().ascii_serialization();
            app.add_capability(
                CapabilityBuilder::new("instance")
                    .remote(format!("{origin}/*"))
                    .window(MAIN)
                    .permission("notification:default"),
            )?;

            // Opened by a freero:// link: start there.
            let first = app
                .deep_link()
                .get_current()
                .ok()
                .flatten()
                .and_then(|urls| urls.iter().find_map(|u| target_for(&instance, u.as_str())));
            let start = first.unwrap_or_else(|| instance.join("app").unwrap_or_else(|_| instance.clone()));
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(start))
                .title("Freero")
                .inner_size(1280.0, 820.0)
                .min_inner_size(720.0, 480.0)
                .build()?;

            // Windows and Linux register freero:// at install time; this covers a portable run.
            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let links = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_link(&links, url.as_str());
                }
            });

            tauri::async_runtime::spawn(async move { check_for_update(handle, false).await });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Freero");
}
