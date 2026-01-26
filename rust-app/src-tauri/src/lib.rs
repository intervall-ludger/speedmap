use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, State};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Measurement {
    pub id: String,
    pub grid_x: i32,
    pub grid_y: i32,
    pub download: f64,
    pub upload: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub floorplan_data: Option<String>,
    pub image_width: f64,
    pub image_height: f64,
    pub scale_point1_x: f64,
    pub scale_point1_y: f64,
    pub scale_point2_x: f64,
    pub scale_point2_y: f64,
    pub wall_length_meters: f64,
    pub meters_per_pixel: f64,
    pub scale_set: bool,
    pub grid_offset_x: f64,
    pub grid_offset_y: f64,
    pub grid_cell_size: f64,
    pub grid_cols: i32,
    pub grid_rows: i32,
    pub measurements: Vec<Measurement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTestResult {
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub run: i32,
    pub total_runs: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedTestProgress {
    pub phase: String,
    pub progress: f64,
    pub current_speed: f64,
    pub run: i32,
}

pub struct AppState {
    pub client: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap(),
        }
    }
}

#[tauri::command]
async fn run_speedtest(
    state: State<'_, Arc<Mutex<AppState>>>,
    window: tauri::Window,
    runs: Option<i32>,
) -> Result<SpeedTestResult, String> {
    let state = state.lock().await;
    let client = &state.client;

    let total_runs = runs.unwrap_or(1).max(1).min(5);
    let mut download_speeds = Vec::new();
    let mut upload_speeds = Vec::new();

    for run in 0..total_runs {
        // Download test
        let _ = window.emit("speedtest_progress", SpeedTestProgress {
            phase: "download".to_string(),
            progress: 0.0,
            current_speed: 0.0,
            run,
        });

        let download_speed = run_download_test(client, &window, run).await?;
        download_speeds.push(download_speed);

        // Upload test
        let _ = window.emit("speedtest_progress", SpeedTestProgress {
            phase: "upload".to_string(),
            progress: 0.0,
            current_speed: 0.0,
            run,
        });

        let upload_speed = run_upload_test(client, &window, run).await?;
        upload_speeds.push(upload_speed);

        let _ = window.emit("speedtest_run_complete", SpeedTestResult {
            download_mbps: download_speed,
            upload_mbps: upload_speed,
            run,
            total_runs,
        });
    }

    let avg_download = trimmed_mean(&download_speeds);
    let avg_upload = trimmed_mean(&upload_speeds);

    Ok(SpeedTestResult {
        download_mbps: avg_download,
        upload_mbps: avg_upload,
        run: total_runs,
        total_runs,
    })
}

async fn run_download_test(
    client: &reqwest::Client,
    window: &tauri::Window,
    run: i32,
) -> Result<f64, String> {
    let test_duration = Duration::from_secs(5);
    let start = Instant::now();
    let mut total_bytes: u64 = 0;

    while start.elapsed() < test_duration {
        let url = format!(
            "https://speed.cloudflare.com/__down?bytes={}",
            10 * 1024 * 1024
        );

        match client.get(&url).send().await {
            Ok(response) => {
                if let Ok(bytes) = response.bytes().await {
                    total_bytes += bytes.len() as u64;
                }
            }
            Err(_) => continue,
        }

        let elapsed = start.elapsed().as_secs_f64();
        let mbps = if elapsed > 0.3 {
            (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0
        } else {
            0.0
        };

        let _ = window.emit("speedtest_progress", SpeedTestProgress {
            phase: "download".to_string(),
            progress: (elapsed / test_duration.as_secs_f64()).min(1.0),
            current_speed: mbps,
            run,
        });
    }

    let elapsed = start.elapsed().as_secs_f64();
    Ok((total_bytes as f64 * 8.0) / elapsed / 1_000_000.0)
}

async fn run_upload_test(
    client: &reqwest::Client,
    window: &tauri::Window,
    run: i32,
) -> Result<f64, String> {
    let test_duration = Duration::from_secs(5);
    let start = Instant::now();
    let mut total_bytes: u64 = 0;
    let chunk_size = 1024 * 1024; // 1MB
    let data = vec![0u8; chunk_size];

    while start.elapsed() < test_duration {
        match client
            .post("https://speed.cloudflare.com/__up")
            .body(data.clone())
            .send()
            .await
        {
            Ok(_) => {
                total_bytes += chunk_size as u64;
            }
            Err(_) => continue,
        }

        let elapsed = start.elapsed().as_secs_f64();
        let mbps = if elapsed > 0.3 {
            (total_bytes as f64 * 8.0) / elapsed / 1_000_000.0
        } else {
            0.0
        };

        let _ = window.emit("speedtest_progress", SpeedTestProgress {
            phase: "upload".to_string(),
            progress: (elapsed / test_duration.as_secs_f64()).min(1.0),
            current_speed: mbps,
            run,
        });
    }

    let elapsed = start.elapsed().as_secs_f64();
    Ok((total_bytes as f64 * 8.0) / elapsed / 1_000_000.0)
}

fn trimmed_mean(values: &[f64]) -> f64 {
    if values.len() < 3 {
        return if values.is_empty() {
            0.0
        } else {
            values.iter().sum::<f64>() / values.len() as f64
        };
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let trimmed: Vec<f64> = sorted[1..sorted.len() - 1].to_vec();
    trimmed.iter().sum::<f64>() / trimmed.len() as f64
}

// IDW interpolation
#[tauri::command]
fn interpolate_speed(measurements: Vec<Measurement>, col: i32, row: i32) -> f64 {
    if let Some(m) = measurements.iter().find(|m| m.grid_x == col && m.grid_y == row) {
        return m.download;
    }

    if measurements.is_empty() {
        return 0.0;
    }

    let power = 2.0;
    let mut weighted_sum = 0.0;
    let mut total_weight = 0.0;

    for m in &measurements {
        let dx = (col - m.grid_x) as f64;
        let dy = (row - m.grid_y) as f64;
        let distance = (dx * dx + dy * dy).sqrt();

        if distance < 0.001 {
            return m.download;
        }

        let weight = 1.0 / distance.powf(power);
        weighted_sum += weight * m.download;
        total_weight += weight;
    }

    if total_weight > 0.0 {
        weighted_sum / total_weight
    } else {
        0.0
    }
}

#[tauri::command]
fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(target_os = "ios")]
fn configure_ios_webview(app: &tauri::App) {
    use tauri::Manager;
    let window = app.get_webview_window("main").unwrap();
    let _ = window.with_webview(|webview| {
        unsafe {
            use objc2::runtime::AnyObject;
            use objc2::{msg_send, msg_send_id};
            use objc2::rc::Retained;

            let wk: *const AnyObject = webview.inner().cast();
            let scroll_view: Retained<AnyObject> = msg_send_id![&*wk, scrollView];
            let _: () = msg_send![&*scroll_view, setContentInsetAdjustmentBehavior: 0_isize];
            let _: () = msg_send![&*scroll_view, setBounces: false];
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Arc::new(Mutex::new(AppState::new())))
        .invoke_handler(tauri::generate_handler![
            run_speedtest,
            interpolate_speed,
            generate_uuid,
        ])
        .setup(|app| {
            #[cfg(target_os = "ios")]
            configure_ios_webview(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
