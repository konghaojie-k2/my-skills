use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;
use chrono::Local;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ============== Types ==============

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HubConfig {
    pub hub_path: String,
    pub git_remote: String,
    pub max_versions: usize,
    pub agents: Vec<AgentConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentConfig {
    pub name: String,
    pub local_path: String,
    pub subscribed_skills: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HubSkill {
    pub name: String,
    pub description: String,
    pub versions: Vec<SkillVersion>,
    pub current_version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillVersion {
    pub version: String,
    pub path: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub modified: Vec<String>,
    pub staged: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PushResult {
    pub success: bool,
    pub message: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub skills_synced: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanPath {
    pub path: String,
    pub source: String,
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

// ============== Helper Functions ==============

fn get_home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn get_app_data_dir() -> PathBuf {
    let app_data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    app_data.join("skills-hub")
}

fn get_hub_config_path() -> PathBuf {
    get_app_data_dir().join("hub.config.json")
}

fn ensure_app_data_dir() -> Result<(), String> {
    let app_data_dir = get_app_data_dir();
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run_git(repo_path: &PathBuf, args: &[&str]) -> Result<String, String> {
    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path).args(args);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ============== Hub Config Commands ==============

#[tauri::command]
fn load_hub_config() -> Result<HubConfig, String> {
    let config_path = get_hub_config_path();
    if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        // Default agents: claude-code, openclaw, cc-switch
        let home = get_home_dir();
        Ok(HubConfig {
            hub_path: home.join("skills-hub").to_string_lossy().to_string(),
            git_remote: String::new(),
            max_versions: 10,
            agents: vec![
                AgentConfig {
                    name: "claude-code".to_string(),
                    local_path: home.join(".claude").join("skills").to_string_lossy().to_string(),
                    subscribed_skills: Vec::new(),
                },
                AgentConfig {
                    name: "openclaw".to_string(),
                    local_path: home.join(".openclaw").join("workspace").join("skills").to_string_lossy().to_string(),
                    subscribed_skills: Vec::new(),
                },
                AgentConfig {
                    name: "cc-switch".to_string(),
                    local_path: home.join(".cc-switch").join("skills").to_string_lossy().to_string(),
                    subscribed_skills: Vec::new(),
                },
            ],
        })
    }
}

#[tauri::command]
fn save_hub_config(config: HubConfig) -> Result<(), String> {
    ensure_app_data_dir()?;
    let config_path = get_hub_config_path();
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, json).map_err(|e| e.to_string())
}

// ============== Hub Initialization ==============

#[tauri::command]
fn init_hub(hub_path: String, git_remote: String) -> Result<(), String> {
    let hub_dir = PathBuf::from(&hub_path);
    let skills_dir = hub_dir.join("skills");

    if !hub_dir.exists() {
        fs::create_dir_all(&hub_dir).map_err(|e| e.to_string())?;
    }
    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    }

    let git_dir = hub_dir.join(".git");
    if !git_dir.exists() {
        run_git(&hub_dir, &["init"])?;
    }

    if !git_remote.is_empty() {
        let _ = run_git(&hub_dir, &["remote", "add", "origin", &git_remote]);
    }

    let config = HubConfig {
        hub_path,
        git_remote,
        max_versions: 10,
        agents: Vec::new(),
    };
    save_hub_config(config)
}

// ============== Hub Skills Commands ==============

#[tauri::command]
fn get_hub_skills() -> Result<Vec<HubSkill>, String> {
    let config = load_hub_config()?;
    let hub_path = PathBuf::from(&config.hub_path);
    let skills_dir = hub_path.join("skills");

    if !skills_dir.exists() {
        return Ok(Vec::new());
    }

    let mut hub_skills = Vec::new();

    for entry in WalkDir::new(&skills_dir)
        .max_depth(1)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            let skill_name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let current_marker = path.join("current.version");
            let current_version = if current_marker.exists() {
                fs::read_to_string(&current_marker).unwrap_or_default().trim().to_string()
            } else {
                String::new()
            };

            let mut versions = Vec::new();
            for version_entry in WalkDir::new(path)
                .max_depth(1)
                .min_depth(1)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let vp = version_entry.path();
                if vp.is_dir() && vp.file_name().map(|n| n.to_string_lossy().starts_with("v")).unwrap_or(false) {
                    let version_name = vp.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    let metadata = fs::metadata(vp).ok();
                    let timestamp = metadata
                        .and_then(|m| m.created().ok())
                        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                        .unwrap_or(0);

                    versions.push(SkillVersion {
                        version: version_name,
                        path: vp.to_string_lossy().to_string(),
                        timestamp,
                    });
                }
            }

            versions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

            let description = get_skill_description(&path.to_path_buf());

            hub_skills.push(HubSkill {
                name: skill_name,
                description,
                versions,
                current_version,
            });
        }
    }

    Ok(hub_skills)
}

fn get_skill_description(path: &PathBuf) -> String {
    let skill_md = path.join("SKILL.md");
    let readme_md = path.join("README.md");

    let md_path = if skill_md.exists() {
        skill_md
    } else if readme_md.exists() {
        readme_md
    } else {
        return String::new();
    };

    parse_skill_file(&md_path).1
}

fn parse_skill_file(path: &PathBuf) -> (String, String) {
    let content = fs::read_to_string(path).unwrap_or_default();

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

    (String::new(), String::new())
}

// ============== Push Skill to Hub (Agent -> Hub) ==============

#[tauri::command]
async fn push_skill_to_hub(agent_name: String, skill_name: String) -> Result<PushResult, String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;

        let agent_config = config.agents.iter()
            .find(|a| a.name == agent_name)
            .ok_or_else(|| format!("Agent '{}' not found in config", agent_name))?;

        let agent_skill_path = PathBuf::from(&agent_config.local_path).join(&skill_name);
        if !agent_skill_path.exists() {
            return Ok(PushResult {
                success: false,
                message: format!("Skill '{}' not found at '{}'", skill_name, agent_config.local_path),
                version: String::new(),
            });
        }

        let hub_path = PathBuf::from(&config.hub_path);
        let hub_skill_dir = hub_path.join("skills").join(&skill_name);
        let version = generate_version_string();
        let new_version_path = hub_skill_dir.join(&version);

        if !hub_skill_dir.exists() {
            fs::create_dir_all(&hub_skill_dir).map_err(|e| e.to_string())?;
        }

        copy_dir_all(&agent_skill_path, &new_version_path)?;

        let current_marker = hub_skill_dir.join("current.version");
        fs::write(&current_marker, &version).map_err(|e| e.to_string())?;

        let _ = run_git(&hub_path, &["add", "."]);
        let commit_msg = format!("Push {} v{} from {}", skill_name, version, agent_name);
        let _ = run_git(&hub_path, &["commit", "-m", &commit_msg]);

        Ok(PushResult {
            success: true,
            message: format!("Successfully pushed {} v{} to hub", skill_name, version),
            version,
        })
    }).await.map_err(|e| e.to_string())?
}

fn generate_version_string() -> String {
    Local::now().format("v%Y.%m.%d.%H%M%S").to_string()
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }

    for entry in WalkDir::new(src)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let src_path = entry.path();
        let dst_path = dst.join(src_path.strip_prefix(src).unwrap_or(src_path));

        if src_path.is_dir() {
            if !dst_path.exists() {
                fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            }
        } else {
            if let Some(parent) = dst_path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
            }
            fs::copy(src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// ============== Sync Skill from Hub (Hub -> Agent) ==============

#[tauri::command]
async fn sync_skill_from_hub(agent_name: String, skill_name: String) -> Result<SyncResult, String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;

        let agent_config = config.agents.iter()
            .find(|a| a.name == agent_name)
            .ok_or_else(|| format!("Agent '{}' not found in config", agent_name))?;

        let hub_path = PathBuf::from(&config.hub_path);
        let hub_skill_dir = hub_path.join("skills").join(&skill_name);
        let current_marker = hub_skill_dir.join("current.version");

        if !hub_skill_dir.exists() {
            return Ok(SyncResult {
                success: false,
                message: format!("Skill '{}' not found in hub", skill_name),
                skills_synced: Vec::new(),
            });
        }

        let version_name = if current_marker.exists() {
            fs::read_to_string(&current_marker).unwrap_or_default().trim().to_string()
        } else {
            return Ok(SyncResult {
                success: false,
                message: format!("No current version found for '{}'", skill_name),
                skills_synced: Vec::new(),
            });
        };

        let current_version_path = hub_skill_dir.join(&version_name);
        if !current_version_path.exists() {
            return Ok(SyncResult {
                success: false,
                message: format!("Version '{}' not found for skill '{}'", version_name, skill_name),
                skills_synced: Vec::new(),
            });
        }

        let agent_skill_path = PathBuf::from(&agent_config.local_path).join(&skill_name);

        if agent_skill_path.exists() {
            fs::remove_dir_all(&agent_skill_path).map_err(|e| e.to_string())?;
        }

        copy_dir_all(&current_version_path, &agent_skill_path)?;

        Ok(SyncResult {
            success: true,
            message: format!("Successfully synced {} v{} to {}", skill_name, version_name, agent_name),
            skills_synced: vec![skill_name],
        })
    }).await.map_err(|e| e.to_string())?
}

// ============== Skill Versions ==============

#[tauri::command]
fn get_skill_versions(skill_name: String) -> Result<Vec<SkillVersion>, String> {
    let config = load_hub_config()?;
    let hub_path = PathBuf::from(&config.hub_path);
    let skill_dir = hub_path.join("skills").join(&skill_name);

    if !skill_dir.exists() {
        return Ok(Vec::new());
    }

    let mut versions = Vec::new();

    for entry in WalkDir::new(&skill_dir)
        .max_depth(1)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            let version_name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if version_name.starts_with('v') {
                let metadata = fs::metadata(path).ok();
                let timestamp = metadata
                    .and_then(|m| m.created().ok())
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                    .unwrap_or(0);

                versions.push(SkillVersion {
                    version: version_name,
                    path: path.to_string_lossy().to_string(),
                    timestamp,
                });
            }
        }
    }

    versions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(versions)
}

// ============== Rollback Skill ==============

#[tauri::command]
fn rollback_skill(skill_name: String, target_version: String) -> Result<bool, String> {
    let config = load_hub_config()?;
    let hub_path = PathBuf::from(&config.hub_path);
    let skill_dir = hub_path.join("skills").join(&skill_name);
    let target_version_path = skill_dir.join(&target_version);

    if !target_version_path.exists() {
        return Err(format!("Version '{}' not found", target_version));
    }

    let current_marker = skill_dir.join("current.version");
    fs::write(&current_marker, &target_version).map_err(|e| e.to_string())?;

    let _ = run_git(&hub_path, &["add", "."]);
    let commit_msg = format!("Rollback {} to {}", skill_name, target_version);
    let _ = run_git(&hub_path, &["commit", "-m", &commit_msg]);

    Ok(true)
}

// ============== Delete Skill ==============

#[tauri::command]
async fn delete_skill(skill_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;
        let hub_path = PathBuf::from(&config.hub_path);
        let skill_dir = hub_path.join("skills").join(&skill_name);

        if !skill_dir.exists() {
            return Err(format!("Skill '{}' not found", skill_name));
        }

        fs::remove_dir_all(&skill_dir).map_err(|e| format!("删除失败: {}", e))?;

        // Git operations are optional - user can commit manually
        let _ = run_git(&hub_path, &["add", "-A"]);
        let _ = run_git(&hub_path, &["commit", "-m", &format!("Delete skill {}", skill_name)]);

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

// ============== Git Commands ==============

#[tauri::command]
async fn git_pull() -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;
        let hub_path = PathBuf::from(&config.hub_path);
        run_git(&hub_path, &["pull", "origin", "master"])
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_push() -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;
        let hub_path = PathBuf::from(&config.hub_path);
        run_git(&hub_path, &["push", "origin", "master"])
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_status() -> Result<GitStatus, String> {
    tokio::task::spawn_blocking(move || {
        let config = load_hub_config()?;
        let hub_path = PathBuf::from(&config.hub_path);

        let git_dir = hub_path.join(".git");
        if !git_dir.exists() {
            return Ok(GitStatus {
                is_repo: false,
                branch: String::new(),
                ahead: 0,
                behind: 0,
                modified: Vec::new(),
                staged: Vec::new(),
            });
        }

        let branch_output = run_git(&hub_path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
        let branch = branch_output.trim().to_string();

        let status_output = run_git(&hub_path, &["status", "--porcelain"])?;

        let mut modified = Vec::new();
        let mut staged = Vec::new();

        for line in status_output.lines() {
            if line.len() >= 3 {
                let status = &line[..2];
                let path = line[3..].trim().to_string();

                if status.contains('M') || *status == "??".to_string() {
                    modified.push(path.clone());
                }
                if status.starts_with('M') || *status == "A ".to_string() {
                    staged.push(path);
                }
            }
        }

        Ok(GitStatus {
            is_repo: true,
            branch,
            ahead: 0,
            behind: 0,
            modified,
            staged,
        })
    }).await.map_err(|e| e.to_string())?
}

// ============== Agent Skills Commands ==============

#[tauri::command]
fn get_agent_skills(agent_name: String) -> Result<Vec<Skill>, String> {
    let config = load_hub_config()?;

    let agent_config = config.agents.iter()
        .find(|a| a.name == agent_name)
        .ok_or_else(|| format!("Agent '{}' not found in config", agent_name))?;

    let agent_path = PathBuf::from(&agent_config.local_path);
    let mut skills = Vec::new();

    if !agent_path.exists() {
        return Ok(skills);
    }

    for entry in WalkDir::new(&agent_path)
        .max_depth(1)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
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
                    source: agent_name.clone(),
                    path: path.to_string_lossy().to_string(),
                    category: None,
                });
            }
        }
    }

    Ok(skills)
}

// ============== Subscription Commands ==============

#[tauri::command]
fn subscribe_skill(agent_name: String, skill_name: String) -> Result<HubConfig, String> {
    let mut config = load_hub_config()?;

    if let Some(agent) = config.agents.iter_mut().find(|a| a.name == agent_name) {
        if !agent.subscribed_skills.contains(&skill_name) {
            agent.subscribed_skills.push(skill_name);
        }
    } else {
        return Err(format!("Agent '{}' not found in config. Please add agent first.", agent_name));
    }

    save_hub_config(config.clone())?;
    Ok(config)
}

#[tauri::command]
fn unsubscribe_skill(agent_name: String, skill_name: String) -> Result<HubConfig, String> {
    let mut config = load_hub_config()?;

    if let Some(agent) = config.agents.iter_mut().find(|a| a.name == agent_name) {
        agent.subscribed_skills.retain(|s| s != &skill_name);
    }

    save_hub_config(config.clone())?;
    Ok(config)
}

#[tauri::command]
fn add_agent(local_path: String, agent_name: String) -> Result<HubConfig, String> {
    let mut config = load_hub_config()?;

    if config.agents.iter().any(|a| a.name == agent_name) {
        return Err(format!("Agent '{}' already exists", agent_name));
    }

    config.agents.push(AgentConfig {
        name: agent_name,
        local_path,
        subscribed_skills: Vec::new(),
    });

    save_hub_config(config.clone())?;
    Ok(config)
}

#[tauri::command]
fn remove_agent(agent_name: String) -> Result<HubConfig, String> {
    let mut config = load_hub_config()?;
    config.agents.retain(|a| a.name != agent_name);
    save_hub_config(config.clone())?;
    Ok(config)
}

// ============== Legacy Commands ==============

#[tauri::command]
fn scan_all_skills(_custom_paths: Vec<ScanPath>) -> ScanResult {
    let hub_skills = get_hub_skills().unwrap_or_default();
    let skills: Vec<Skill> = hub_skills.iter().map(|hs| Skill {
        name: hs.name.clone(),
        description: hs.description.clone(),
        source: "Hub".to_string(),
        path: format!("{}/skills/{}", load_hub_config().map(|c| c.hub_path).unwrap_or_default(), hs.name),
        category: None,
    }).collect();

    let total = skills.len();
    ScanResult {
        skills: skills.clone(),
        total,
        sources: vec![SourceCount {
            source: "Hub".to_string(),
            count: total,
        }],
    }
}

#[tauri::command]
fn get_default_scan_paths() -> Vec<ScanPath> {
    vec![
        ScanPath {
            path: get_home_dir().join(".claude").join("skills").to_string_lossy().to_string(),
            source: "Claude".to_string(),
        },
    ]
}

#[tauri::command]
fn load_custom_paths() -> Vec<ScanPath> {
    Vec::new()
}

#[tauri::command]
fn save_custom_paths(_paths: Vec<ScanPath>) -> Result<(), String> {
    Ok(())
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

    let mut buffer = Vec::new();
    let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let folder_name = source_path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

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
            zip.add_directory(&format!("{}/", zip_path), options)
                .map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;

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
    let mut md = String::from("# Skills Hub\n\n");
    md.push_str(&format!("共 {} 个技能\n\n", skills.len()));

    for skill in &skills {
        md.push_str(&format!("### {}\n\n", skill.name));
        if !skill.description.is_empty() {
            md.push_str(&format!("{}\n\n", skill.description));
        }
        md.push_str(&format!("- 路径: `{}`\n\n", skill.path));
    }

    md
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            load_hub_config,
            save_hub_config,
            init_hub,
            get_hub_skills,
            push_skill_to_hub,
            sync_skill_from_hub,
            get_skill_versions,
            rollback_skill,
            delete_skill,
            git_pull,
            git_push,
            git_status,
            get_agent_skills,
            subscribe_skill,
            unsubscribe_skill,
            add_agent,
            remove_agent,
            scan_all_skills,
            get_default_scan_paths,
            load_custom_paths,
            save_custom_paths,
            get_skill_detail,
            export_skill_folder,
            export_skills_json,
            export_skills_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}