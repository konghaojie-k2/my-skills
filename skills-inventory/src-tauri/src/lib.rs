#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub skills: Vec<Skill>,
    pub total: usize,
    pub sources: Vec<SourceCount>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SourceCount {
    pub source: String,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanPath {
    pub path: String,
    pub source: String,
}

fn get_home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn get_app_data_dir() -> PathBuf {
    let app_data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    app_data.join("skills-inventory")
}

fn get_config_path() -> PathBuf {
    get_app_data_dir().join("config.json")
}

/// Load saved custom paths from config file
#[tauri::command]
fn load_custom_paths() -> Vec<ScanPath> {
    let config_path = get_config_path();
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(paths) = config.get("customPaths").and_then(|p| p.as_array()) {
                    return paths
                        .iter()
                        .filter_map(|p| {
                            Some(ScanPath {
                                path: p.get("path")?.as_str()?.to_string(),
                                source: p.get("source").and_then(|s| s.as_str()).unwrap_or("自定义").to_string(),
                            })
                        })
                        .collect();
                }
            }
        }
    }
    Vec::new()
}

/// Save custom paths to config file
#[tauri::command]
fn save_custom_paths(paths: Vec<ScanPath>) -> Result<(), String> {
    eprintln!("[DEBUG] save_custom_paths called with: {:?}", paths);
    let app_data_dir = get_app_data_dir();

    // Create directory if not exists
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }

    let config_path = get_config_path();

    // Load existing config
    let mut config = if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
        } else {
            serde_json::json!({})
        }
    } else {
        serde_json::json!({})
    };

    // Update custom paths
    let paths_array: Vec<serde_json::Value> = paths
        .iter()
        .map(|p| {
            serde_json::json!({
                "path": p.path,
                "source": p.source
            })
        })
        .collect();

    config["customPaths"] = serde_json::Value::Array(paths_array);

    // Save config
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| e.to_string())?;

    eprintln!("[DEBUG] Config saved successfully to: {:?}", config_path);
    Ok(())
}

/// Only scan directories that contain SKILL.md or README.md
fn scan_skills_dir(dir: &PathBuf, source: &str) -> Vec<Skill> {
    let mut skills = Vec::new();

    if !dir.exists() {
        return skills;
    }

    for entry in WalkDir::new(dir)
        .max_depth(1)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            // Only include if it has SKILL.md or README.md
            let has_skill_md = path.join("SKILL.md").exists();
            let has_readme_md = path.join("README.md").exists();

            if has_skill_md || has_readme_md {
                let md_path = if has_skill_md {
                    path.join("SKILL.md")
                } else {
                    path.join("README.md")
                };

                let (name, description) = parse_skill_file(&md_path);

                skills.push(Skill {
                    name,
                    description,
                    source: source.to_string(),
                    path: path.to_string_lossy().to_string(),
                    category: None,
                });
            }
        }
    }

    skills
}

fn parse_skill_file(path: &PathBuf) -> (String, String) {
    let content = fs::read_to_string(path).unwrap_or_default();

    // Try to extract name and description from frontmatter
    if let Some(start) = content.find("---") {
        if let Some(end) = content[start + 3..].find("---") {
            let frontmatter = &content[start + 3..start + 3 + end];
            let mut name = String::new();
            let mut description = String::new();

            for line in frontmatter.lines() {
                if line.starts_with("name:") {
                    name = line.trim_start_matches("name:").trim().to_string();
                }
                if line.starts_with("description:") {
                    description = line.trim_start_matches("description:").trim().to_string();
                    description = description.trim_matches('"').trim_matches('\'').to_string();
                }
            }

            if !name.is_empty() {
                return (name, description);
            }
        }
    }

    // Fallback: use first line as name
    let first_line = content.lines().next().unwrap_or("").trim();
    let name = if first_line.starts_with("# ") {
        first_line.trim_start_matches("# ").to_string()
    } else {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    };

    (name, String::new())
}

#[tauri::command]
fn get_default_scan_paths() -> Vec<ScanPath> {
    let home = get_home_dir();
    vec![
        ScanPath {
            path: home.join(".cc-switch").join("skills").to_string_lossy().to_string(),
            source: "CC SWITCH".to_string(),
        },
        ScanPath {
            path: home.join(".openclaw").join("workspace").join("skills").to_string_lossy().to_string(),
            source: "OpenClaw".to_string(),
        },
        ScanPath {
            path: home.join(".claude").join("skills").to_string_lossy().to_string(),
            source: "Claude".to_string(),
        },
    ]
}

#[tauri::command]
fn scan_all_skills(custom_paths: Vec<ScanPath>) -> ScanResult {
    let mut all_skills = Vec::new();

    // Use custom paths if provided, otherwise use defaults
    let paths_to_scan = if custom_paths.is_empty() {
        get_default_scan_paths()
    } else {
        custom_paths
    };

    for scan_path in paths_to_scan {
        let dir = PathBuf::from(&scan_path.path);
        let skills = scan_skills_dir(&dir, &scan_path.source);
        all_skills.extend(skills);
    }

    // Count by source
    let mut source_counts = std::collections::HashMap::new();
    for skill in &all_skills {
        *source_counts.entry(skill.source.clone()).or_insert(0) += 1;
    }

    let sources: Vec<SourceCount> = source_counts
        .into_iter()
        .map(|(source, count)| SourceCount { source, count })
        .collect();

    let total = all_skills.len();

    ScanResult {
        skills: all_skills,
        total,
        sources,
    }
}

#[tauri::command]
fn get_skill_detail(path: String) -> Option<String> {
    let path = PathBuf::from(&path);
    let skill_md = path.join("SKILL.md");
    let readme_md = path.join("README.md");

    if skill_md.exists() {
        fs::read_to_string(skill_md).ok()
    } else if readme_md.exists() {
        fs::read_to_string(readme_md).ok()
    } else {
        None
    }
}

#[tauri::command]
fn export_skill_folder(path: String) -> Result<String, String> {
    let source_path = PathBuf::from(&path);

    if !source_path.exists() {
        return Err("Path does not exist".to_string());
    }

    // Create a temporary zip file in memory
    let mut buffer = Vec::new();
    let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let folder_name = source_path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Walk through the folder and add files to zip
    for entry in WalkDir::new(&source_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        let relative_path = entry_path.strip_prefix(&source_path)
            .unwrap_or(entry_path);

        let zip_path = format!("{}/{}", folder_name, relative_path.to_string_lossy());

        if entry_path.is_file() {
            zip.start_file(&zip_path, options)
                .map_err(|e| e.to_string())?;

            let mut file = File::open(entry_path).map_err(|e| e.to_string())?;
            let mut contents = Vec::new();
            file.read_to_end(&mut contents).map_err(|e| e.to_string())?;
            zip.write_all(&contents).map_err(|e| e.to_string())?;
        } else if entry_path.is_dir() && entry_path != source_path {
            // Add directory entry
            zip.add_directory(&format!("{}/", zip_path), options)
                .map_err(|e| e.to_string())?;
        }
    }

        zip.finish().map_err(|e| e.to_string())?;

    // Encode to base64
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let base64_data = STANDARD.encode(&buffer);

    Ok(base64_data)
}

#[tauri::command]
fn export_skills_json(skills: Vec<Skill>) -> String {
    serde_json::to_string_pretty(&skills).unwrap_or_default()
}

#[tauri::command]
fn export_skills_markdown(skills: Vec<Skill>) -> String {
    let mut md = String::from("# Skills 盘点\n\n");
    md.push_str(&format!("共 {} 个技能\n\n", skills.len()));

    // Group by source
    let mut by_source: std::collections::HashMap<String, Vec<&Skill>> =
        std::collections::HashMap::new();
    for skill in &skills {
        by_source
            .entry(skill.source.clone())
            .or_insert_with(Vec::new)
            .push(skill);
    }

    for (source, source_skills) in by_source {
        md.push_str(&format!("## {} ({}个)\n\n", source, source_skills.len()));
        for skill in source_skills {
            md.push_str(&format!("### {}\n\n", skill.name));
            if !skill.description.is_empty() {
                md.push_str(&format!("{}\n\n", skill.description));
            }
            md.push_str(&format!("- 路径: `{}`\n\n", skill.path));
        }
    }

    md
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_default_scan_paths,
            load_custom_paths,
            save_custom_paths,
            scan_all_skills,
            get_skill_detail,
            export_skill_folder,
            export_skills_json,
            export_skills_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
