use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentProcess;

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

                #[cfg(target_os = "windows")]
                {
                    unsafe {
                        use std::os::windows::io::AsRawHandle;
                        if let Some(handle) = child.as_raw_handle() {
                            // Create a Job Object
                            let job = CreateJobObjectW(None, None).unwrap();

                            // Configure it to kill processes on close
                            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                            info.BasicLimitInformation.LimitFlags =
                                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                            let _ = SetInformationJobObject(
                                job,
                                JobObjectExtendedLimitInformation,
                                &info as *const _ as *const _,
                                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                            );

                            // Assign the child process to the job
                            let process_handle =
                                windows::Win32::Foundation::HANDLE(handle as isize);
                            let _ = AssignProcessToJobObject(job, process_handle);

                            // We need to keep the job handle alive for the lifetime of the sidecar struct
                            // But since we don't have a field for it and we want it to live until the main process dies,
                            // we can leak it (it will be closed when main process dies anyway)
                            // OR better: store it in the struct. For now, let's leak it to ensure it persists.
                            // If we close the job handle, the job might be destroyed if no processes are in it yet?
                            // Actually, if we close the handle, the job is destroyed primarily if it has no open handles.
                            // So we MUST keep `job` open.
                            Box::leak(Box::new(job));
                        }
                    }
                }

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
