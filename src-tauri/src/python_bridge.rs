use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

pub struct PythonSidecar {
    process: Mutex<Option<Child>>,
}

impl PythonSidecar {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    pub fn start(&self, app_handle: &tauri::AppHandle) {
        println!("Starting Python sidecar...");

        let mut child_result = Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No sidecar found",
        ));

        // 1. Try Bundled Executable (Production)
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let exe_path = resource_dir.join("ovelo_server.exe");
            if exe_path.exists() {
                println!("Found bundled sidecar: {:?}", exe_path);
                child_result = Command::new(exe_path).spawn();
            }
        }

        // 2. Fallback to Python Script (Development)
        if child_result.is_err() {
            let mut script_path = PathBuf::from("python/sidecar.py");
            if !script_path.exists() {
                script_path = PathBuf::from("../python/sidecar.py");
            }

            if script_path.exists() {
                println!("Found dev script: {:?}", script_path);
                child_result = Command::new("python").arg(script_path).spawn();
            }
        }

        match child_result {
            Ok(child) => {
                println!("Python sidecar started with PID: {}", child.id());
                *self.process.lock().unwrap() = Some(child);
            }
            Err(e) => {
                eprintln!("Failed to start python sidecar: {}", e);
            }
        }
    }

    pub fn stop(&self) {
        let mut process_guard = self.process.lock().unwrap();
        if let Some(mut child) = process_guard.take() {
            println!("Stopping Python sidecar...");
            let _ = child.kill();
        }
    }
}

// Helper to call Python API
pub async fn call_api(endpoint: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:5006{}", endpoint); // Config.PORT is 5006

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(json)
    } else {
        Err(format!("API Error: {}", res.status()))
    }
}

pub async fn post_api(
    endpoint: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:5006{}", endpoint);

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(json)
    } else {
        Err(format!("API Error: {}", res.status()))
    }
}

pub async fn call_api_method(
    method: &str,
    endpoint: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:5006{}", endpoint);

    let builder = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        "PUT" => client.put(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    let builder = if let Some(b) = body {
        builder.json(&b)
    } else {
        builder
    };

    let res = builder.send().await.map_err(|e| e.to_string())?;

    if res.status().is_success() {
        // Some endpoints might return empty body on success (like 204)
        if res.content_length() == Some(0) {
            return Ok(serde_json::json!({}));
        }
        // Try to parse JSON, if fails, return empty object (some APIs return text)
        match res.json::<serde_json::Value>().await {
            Ok(json) => Ok(json),
            Err(_) => Ok(serde_json::json!({})),
        }
    } else {
        Err(format!("API Error: {}", res.status()))
    }
}
