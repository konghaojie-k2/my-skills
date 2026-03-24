import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// ============== Types ==============

interface HubConfig {
  hub_path: string;
  git_remote: string;
  max_versions: number;
  agents: AgentConfig[];
}

interface AgentConfig {
  name: string;
  local_path: string;
  subscribed_skills: string[];
}

interface HubSkill {
  name: string;
  description: string;
  versions: SkillVersion[];
  current_version: string;
}

interface SkillVersion {
  version: string;
  path: string;
  timestamp: number;
}

interface Skill {
  name: string;
  description: string;
  source: string;
  path: string;
  category: string | null;
}

interface GitStatus {
  is_repo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
}

interface PushResult {
  success: boolean;
  message: string;
  version: string;
}

interface SyncResult {
  success: boolean;
  message: string;
  skills_synced: string[];
}

// ============== YAML Front Matter Parser ==============

interface SkillMeta {
  name?: string;
  description?: string;
  license?: string;
  [key: string]: string | undefined;
}

const parseFrontMatter = (content: string): { meta: SkillMeta; content: string } => {
  const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return { meta: {}, content };
  }

  const yamlContent = match[1];
  const remainingContent = content.slice(match[0].length).trim();

  // Simple YAML parser for flat key-value pairs
  const meta: SkillMeta = {};
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[key] = value;
    }
  }

  return { meta, content: remainingContent };
};

// ============== App Component ==============

function App() {
  const [activeTab, setActiveTab] = useState<"skills" | "push" | "sync" | "subscription">("skills");
  const [loading, setLoading] = useState(true);
  const [hubConfig, setHubConfig] = useState<HubConfig | null>(null);
  const [hubSkills, setHubSkills] = useState<HubSkill[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Initialization
  useEffect(() => {
    loadHubData();
  }, []);

  const loadHubData = async () => {
    setLoading(true);
    try {
      const config = await invoke<HubConfig>("load_hub_config");
      setHubConfig(config);

      if (config.hub_path) {
        const skills = await invoke<HubSkill[]>("get_hub_skills");
        setHubSkills(skills);

        const status = await invoke<GitStatus>("git_status");
        setGitStatus(status);
      }
    } catch (error) {
      console.error("Failed to load hub data:", error);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const clearMessage = () => setMessage(null);

  // ============== Tab: Skills List ==============

  const [selectedSkill, setSelectedSkill] = useState<HubSkill | null>(null);
  const [skillDetail, setSkillDetail] = useState<string>("");
  const [skillMeta, setSkillMeta] = useState<SkillMeta>({});
  const [skillSearch, setSkillSearch] = useState<string>("");

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; skillName: string }>({ show: false, skillName: "" });
  const [deleteVersionModal, setDeleteVersionModal] = useState<{ show: boolean; skillName: string; version: string }>({ show: false, skillName: "", version: "" });
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<string>("");

  const filteredHubSkills = hubSkills.filter(skill =>
    skill.name.toLowerCase().includes(skillSearch.toLowerCase()) ||
    skill.description.toLowerCase().includes(skillSearch.toLowerCase())
  );

  const handleSkillClick = async (skill: HubSkill) => {
    setSelectedSkill(skill);
    setSkillMeta({});
    try {
      const detail = await invoke<string | null>("get_skill_detail", {
        path: `${hubConfig?.hub_path}/skills/${skill.name}/${skill.current_version}`,
      });
      const rawContent = detail || "无详情内容";
      const { meta, content } = parseFrontMatter(rawContent);
      setSkillMeta(meta);
      setSkillDetail(content);
    } catch (error) {
      setSkillDetail("加载失败");
    }
  };

  const handleDeleteConfirm = async () => {
    const skillName = deleteModal.skillName;
    setDeleting(true);
    setDeleteProgress("正在删除文件...");

    try {
      await invoke("delete_skill", { skillName });
      setDeleteProgress("更新 Git 仓库...");
      await loadHubData();
      if (selectedSkill?.name === skillName) {
        setSelectedSkill(null);
        setSkillDetail("");
      }
      showMessage("success", `已删除 ${skillName}`);
    } catch (error) {
      showMessage("error", `删除失败: ${error}`);
    } finally {
      setDeleting(false);
      setDeleteProgress("");
      setDeleteModal({ show: false, skillName: "" });
    }
  };

  const handleDeleteVersionConfirm = async () => {
    const { skillName, version } = deleteVersionModal;
    setDeleting(true);
    setDeleteProgress("正在删除版本...");

    try {
      await invoke("delete_skill_version", { skillName, version });
      setDeleteProgress("更新 Git 仓库...");
      // 重新获取最新的 skills 列表
      const latestSkills = await invoke<HubSkill[]>("get_hub_skills");
      setHubSkills(latestSkills);

      // 删除成功后刷新当前 skill 的详情
      const updatedSkill = latestSkills.find(s => s.name === skillName);
      if (updatedSkill) {
        setSelectedSkill(updatedSkill);
        const detail = await invoke<string | null>("get_skill_detail", {
          path: `${hubConfig?.hub_path}/skills/${skillName}/${updatedSkill.current_version}`,
        });
        const rawContent = detail || "无详情内容";
        const { meta, content } = parseFrontMatter(rawContent);
        setSkillMeta(meta);
        setSkillDetail(content);
      }
      showMessage("success", `已删除版本 ${version}`);
    } catch (error) {
      showMessage("error", `删除版本失败: ${error}`);
      // 删除失败后重新加载当前 skill 的详情
      const latestSkills = await invoke<HubSkill[]>("get_hub_skills");
      setHubSkills(latestSkills);
      const latestSkill = latestSkills.find(s => s.name === skillName);
      if (latestSkill) {
        setSelectedSkill(latestSkill);
        const detail = await invoke<string | null>("get_skill_detail", {
          path: `${hubConfig?.hub_path}/skills/${skillName}/${latestSkill.current_version}`,
        });
        const rawContent = detail || "无详情内容";
        const { meta, content } = parseFrontMatter(rawContent);
        setSkillMeta(meta);
        setSkillDetail(content);
      }
    } finally {
      setDeleting(false);
      setDeleteProgress("");
      setDeleteVersionModal({ show: false, skillName: "", version: "" });
    }
  };

  // ============== Tab: Push (Agent -> Hub) ==============

  const [pushAgent, setPushAgent] = useState<string>("");
  const [pushSkills, setPushSkills] = useState<string[]>([]);
  const [agentSkills, setAgentSkills] = useState<Skill[]>([]);
  const [pushing, setPushing] = useState(false);
  const [operationLog, setOperationLog] = useState<string[]>([]);
  const [currentOperation, setCurrentOperation] = useState<string>("");

  useEffect(() => {
    if (hubConfig && pushAgent) {
      loadAgentSkills(pushAgent);
    }
  }, [pushAgent]);

  const loadAgentSkills = async (agentName: string) => {
    try {
      const skills = await invoke<Skill[]>("get_agent_skills", { agentName });
      setAgentSkills(skills);
      setPushSkills(skills.map(s => s.name));
    } catch (error) {
      console.error("Failed to load agent skills:", error);
      setAgentSkills([]);
      setPushSkills([]);
    }
  };

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setOperationLog(prev => [...prev, `[${timestamp}] ${msg}`]);
  };

  const clearLog = () => setOperationLog([]);

  const handlePush = async () => {
    if (!pushAgent || pushSkills.length === 0) {
      showMessage("error", "请选择 Agent 和至少一个 Skill");
      return;
    }

    setPushing(true);
    setOperationLog([]);
    clearMessage();
    addLog(`开始推送 ${pushSkills.length} 个 Skills...`);
    let successCount = 0;
    let errorMessages: string[] = [];

    for (let i = 0; i < pushSkills.length; i++) {
      const skillName = pushSkills[i];
      setCurrentOperation(`[${i + 1}/${pushSkills.length}] 推送 ${skillName}...`);
      addLog(`正在推送: ${skillName}`);

      try {
        const result = await invoke<PushResult>("push_skill_to_hub", {
          agentName: pushAgent,
          skillName,
        });
        if (result.success) {
          successCount++;
          addLog(`✓ ${skillName} - 成功 (v${result.version})`);
        } else {
          errorMessages.push(`${skillName}: ${result.message}`);
          addLog(`✗ ${skillName} - 失败: ${result.message}`);
        }
      } catch (error) {
        errorMessages.push(`${skillName}: ${error}`);
        addLog(`✗ ${skillName} - 错误: ${error}`);
      }
    }

    setCurrentOperation("");
    setPushing(false);

    if (successCount === pushSkills.length) {
      addLog(`推送完成! 成功 ${successCount} 个`);
      showMessage("success", `成功推送 ${successCount} 个 Skills`);
      await loadHubData();
    } else if (successCount > 0) {
      addLog(`部分成功: ${successCount}/${pushSkills.length}`);
      showMessage("error", `部分成功: ${successCount}/${pushSkills.length}`);
    } else {
      addLog(`推送失败`);
      showMessage("error", `推送失败`);
    }
  };

  const togglePushSkill = (skillName: string) => {
    setPushSkills(prev =>
      prev.includes(skillName)
        ? prev.filter(s => s !== skillName)
        : [...prev, skillName]
    );
  };

  const selectAllPushSkills = () => {
    if (pushSkills.length === agentSkills.length) {
      setPushSkills([]);
    } else {
      setPushSkills(agentSkills.map(s => s.name));
    }
  };

  // ============== Tab: Sync (Hub -> Agent) ==============

  const [syncAgent, setSyncAgent] = useState<string>("");
  const [syncSkill, setSyncSkill] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncCurrentOp, setSyncCurrentOp] = useState<string>("");

  const addSyncLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setSyncLog(prev => [...prev, `[${timestamp}] ${msg}`]);
  };

  const clearSyncLog = () => setSyncLog([]);

  const handleSync = async () => {
    if (!syncAgent || !syncSkill) {
      showMessage("error", "请选择 Agent 和 Skill");
      return;
    }

    setSyncing(true);
    setSyncLog([]);
    clearMessage();
    addSyncLog(`开始同步 ${syncSkill} 到 ${syncAgent}...`);
    setSyncCurrentOp(`同步中: ${syncSkill}`);

    try {
      const result = await invoke<SyncResult>("sync_skill_from_hub", {
        agentName: syncAgent,
        skillName: syncSkill,
      });

      if (result.success) {
        addSyncLog(`✓ ${syncSkill} - 同步成功`);
        showMessage("success", result.message);
      } else {
        addSyncLog(`✗ ${syncSkill} - 失败: ${result.message}`);
        showMessage("error", result.message);
      }
    } catch (error) {
      addSyncLog(`✗ ${syncSkill} - 错误: ${error}`);
      showMessage("error", `同步失败: ${error}`);
    } finally {
      setSyncCurrentOp("");
      setSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    if (!syncAgent || !hubConfig) return;

    const agent = hubConfig.agents.find(a => a.name === syncAgent);
    if (!agent || agent.subscribed_skills.length === 0) {
      showMessage("error", "此 Agent 没有订阅任何 Skills");
      return;
    }

    setSyncing(true);
    setSyncLog([]);
    clearMessage();
    addSyncLog(`开始批量同步 ${agent.subscribed_skills.length} 个 Skills...`);

    let synced: string[] = [];
    let errors: string[] = [];

    for (let i = 0; i < agent.subscribed_skills.length; i++) {
      const skillName = agent.subscribed_skills[i];
      setSyncCurrentOp(`[${i + 1}/${agent.subscribed_skills.length}] 同步 ${skillName}...`);
      addSyncLog(`正在同步: ${skillName}`);

      try {
        const result = await invoke<SyncResult>("sync_skill_from_hub", {
          agentName: syncAgent,
          skillName,
        });
        if (result.success) {
          synced.push(skillName);
          addSyncLog(`✓ ${skillName} - 成功`);
        } else {
          errors.push(`${skillName}: ${result.message}`);
          addSyncLog(`✗ ${skillName} - 失败: ${result.message}`);
        }
      } catch (error) {
        errors.push(`${skillName}: ${error}`);
        addSyncLog(`✗ ${skillName} - 错误: ${error}`);
      }
    }

    setSyncCurrentOp("");
    setSyncing(false);

    if (synced.length === agent.subscribed_skills.length) {
      addSyncLog(`全部同步完成! 成功 ${synced.length} 个`);
      showMessage("success", `成功同步 ${synced.length} 个 Skills`);
    } else if (synced.length > 0) {
      addSyncLog(`部分成功: ${synced.length}/${agent.subscribed_skills.length}`);
      showMessage("error", `部分成功: ${synced.length}/${agent.subscribed_skills.length}`);
    } else {
      addSyncLog(`同步失败`);
      showMessage("error", `同步失败`);
    }
  };

  // ============== Tab: Subscription Management ==============

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentPath, setNewAgentPath] = useState("");
  const [subscribeSkill, setSubscribeSkill] = useState<string>("");
  const [subscribeAgent, setSubscribeAgent] = useState<string>("");

  const handleAddAgent = async () => {
    if (!newAgentName || !newAgentPath) {
      showMessage("error", "请填写 Agent 名称和路径");
      return;
    }

    try {
      const config = await invoke<HubConfig>("add_agent", {
        agentName: newAgentName,
        localPath: newAgentPath,
      });
      setHubConfig(config);
      showMessage("success", `Agent "${newAgentName}" 添加成功`);
      setNewAgentName("");
      setNewAgentPath("");
    } catch (error) {
      showMessage("error", `添加失败: ${error}`);
    }
  };

  const handleRemoveAgent = async (agentName: string) => {
    try {
      const config = await invoke<HubConfig>("remove_agent", { agentName });
      setHubConfig(config);
      showMessage("success", `Agent "${agentName}" 已删除`);
    } catch (error) {
      showMessage("error", `删除失败: ${error}`);
    }
  };

  const handleSubscribe = async () => {
    if (!subscribeAgent || !subscribeSkill) {
      showMessage("error", "请选择 Agent 和要订阅的 Skill");
      return;
    }

    try {
      const config = await invoke<HubConfig>("subscribe_skill", {
        agentName: subscribeAgent,
        skillName: subscribeSkill,
      });
      setHubConfig(config);
      showMessage("success", `已订阅 ${subscribeSkill} 到 ${subscribeAgent}`);
    } catch (error) {
      showMessage("error", `订阅失败: ${error}`);
    }
  };

  const handleUnsubscribe = async (agentName: string, skillName: string) => {
    try {
      const config = await invoke<HubConfig>("unsubscribe_skill", {
        agentName,
        skillName,
      });
      setHubConfig(config);
      showMessage("success", `已取消订阅 ${skillName}`);
    } catch (error) {
      showMessage("error", `取消订阅失败: ${error}`);
    }
  };

  // ============== Git Operations ==============

  const [gitOperation, setGitOperation] = useState<string>("");

  const handleGitPull = async () => {
    setGitOperation("pull");
    try {
      await invoke<string>("git_pull");
      showMessage("success", "Git pull 成功");
      await loadHubData();
    } catch (error) {
      showMessage("error", `Git pull 失败: ${error}`);
    } finally {
      setGitOperation("");
    }
  };

  const handleGitPush = async () => {
    setGitOperation("push");
    try {
      await invoke<string>("git_push");
      showMessage("success", "Git push 成功");
      await loadHubData();
    } catch (error) {
      showMessage("error", `Git push 失败: ${error}`);
    } finally {
      setGitOperation("");
    }
  };

  // ============== Hub Initialization ==============

  const [showInitModal, setShowInitModal] = useState(false);
  const [initPath, setInitPath] = useState("");
  const [initRemote, setInitRemote] = useState("");
  const [initializing, setInitializing] = useState(false);

  const handleInitHub = async () => {
    if (!initPath) {
      showMessage("error", "请输入 Hub 路径");
      return;
    }

    setInitializing(true);
    try {
      await invoke("init_hub", {
        hubPath: initPath,
        gitRemote: initRemote,
      });
      showMessage("success", "Hub 初始化成功");
      setShowInitModal(false);
      await loadHubData();
    } catch (error) {
      showMessage("error", `初始化失败: ${error}`);
    } finally {
      setInitializing(false);
    }
  };

  // ============== Render ==============

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  const isInitialized = hubConfig && hubConfig.hub_path;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>Skills Hub</h1>
        <div className="header-actions">
          {isInitialized && (
            <>
              <span className="hub-status">
                {gitStatus?.is_repo ? (
                  <>
                    <span className="branch-badge">{gitStatus.branch}</span>
                    {gitStatus.ahead > 0 && <span className="ahead-badge">+{gitStatus.ahead}</span>}
                    {gitStatus.behind > 0 && <span className="behind-badge">-{gitStatus.behind}</span>}
                  </>
                ) : (
                  <span className="no-repo-badge">未初始化 Git</span>
                )}
              </span>
              <button
                className="btn btn-secondary"
                onClick={handleGitPull}
                disabled={gitOperation === "pull" || !gitStatus?.is_repo}
              >
                {gitOperation === "pull" ? "拉取中..." : "Git Pull"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleGitPush}
                disabled={gitOperation === "push" || !gitStatus?.is_repo}
              >
                {gitOperation === "push" ? "推送中..." : "Git Push"}
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setShowInitModal(true)}>
            {isInitialized ? "配置" : "初始化 Hub"}
          </button>
        </div>
      </header>

      {/* Message */}
      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Hub Status Panel */}
      {isInitialized && (
        <div className="hub-status-panel">
          <div className="status-item">
            <span className="status-label">Hub 路径:</span>
            <span className="status-value">{hubConfig?.hub_path}</span>
          </div>
          {hubConfig?.git_remote && (
            <div className="status-item">
              <span className="status-label">远程:</span>
              <span className="status-value">{hubConfig?.git_remote}</span>
            </div>
          )}
          <div className="status-item">
            <span className="status-label">Skills:</span>
            <span className="status-value">{hubSkills.length} 个</span>
          </div>
          <div className="status-item">
            <span className="status-label">Agents:</span>
            <span className="status-value">{hubConfig?.agents.length || 0} 个</span>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "skills" ? "active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          Skills 列表
        </button>
        <button
          className={`tab-btn ${activeTab === "push" ? "active" : ""}`}
          onClick={() => setActiveTab("push")}
        >
          推送 (Agent → Hub)
        </button>
        <button
          className={`tab-btn ${activeTab === "sync" ? "active" : ""}`}
          onClick={() => setActiveTab("sync")}
        >
          同步 (Hub → Agent)
        </button>
        <button
          className={`tab-btn ${activeTab === "subscription" ? "active" : ""}`}
          onClick={() => setActiveTab("subscription")}
        >
          订阅管理
        </button>
      </nav>

      {/* Tab Content */}
      <main className="tab-content">
        {/* Skills List Tab */}
        {activeTab === "skills" && (
          <div className="skills-tab">
            {!isInitialized ? (
              <div className="empty-state">
                <p>Hub 未初始化</p>
                <button className="btn btn-primary" onClick={() => setShowInitModal(true)}>
                  初始化 Hub
                </button>
              </div>
            ) : (
              <div className="skills-layout">
                <div className="skills-list-panel">
                  <div className="skills-search-bar">
                    <input
                      type="text"
                      placeholder="搜索 Skills..."
                      value={skillSearch}
                      onChange={(e) => setSkillSearch(e.target.value)}
                    />
                  </div>
                  <div className="skills-list">
                    {filteredHubSkills.length === 0 ? (
                      <div className="empty-state">{skillSearch ? "没有匹配的 Skills" : "没有 Skills"}</div>
                    ) : (
                      filteredHubSkills.map((skill) => (
                        <div
                          key={skill.name}
                          className={`skill-item ${selectedSkill?.name === skill.name ? "selected" : ""}`}
                          onClick={() => handleSkillClick(skill)}
                        >
                          <div className="skill-item-header">
                            <div className="skill-name">{skill.name}</div>
                            <button
                              className="skill-delete-btn"
                              disabled={deleting && deleteModal.skillName === skill.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteModal({ show: true, skillName: skill.name });
                              }}
                              title="删除"
                            >
                              ×
                            </button>
                          </div>
                          <div className="skill-desc">{skill.description || "暂无描述"}</div>
                          <div className="skill-meta">
                            <span className="version-badge">{skill.current_version}</span>
                            <span className="versions-count">{skill.versions.length} 个版本</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="skill-detail">
                  {selectedSkill ? (
                    <>
                      <div className="detail-header">
                        <h2>{selectedSkill.name}</h2>
                        <span className="version-badge large">{selectedSkill.current_version}</span>
                      </div>
                      {/* YAML Front Matter Metadata Card */}
                      {Object.keys(skillMeta).length > 0 && (
                        <div className="skill-meta-card">
                          {skillMeta.description && (
                            <div className="meta-item">
                              <span className="meta-label">描述</span>
                              <p className="meta-description">{skillMeta.description}</p>
                            </div>
                          )}
                          {skillMeta.license && (
                            <div className="meta-item">
                              <span className="meta-label">许可证</span>
                              <span className="meta-value">{skillMeta.license}</span>
                            </div>
                          )}
                          {Object.entries(skillMeta).map(([key, value]) => {
                            if (['name', 'description', 'license'].includes(key)) return null;
                            return (
                              <div key={key} className="meta-item">
                                <span className="meta-label">{key}</span>
                                <span className="meta-value">{value}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="detail-versions">
                        <h3>版本历史</h3>
                        <div className="versions-list">
                          {selectedSkill.versions.map((v) => (
                            <div key={v.version} className="version-item">
                              <div className="version-info">
                                <span className="version-name">
                                  {v.version}
                                  {v.version === selectedSkill.current_version && <span className="current-badge"> current</span>}
                                </span>
                                <span className="version-time">
                                  {new Date(v.timestamp * 1000).toLocaleString()}
                                </span>
                              </div>
                              <button
                                className="version-delete-btn"
                                onClick={() => setDeleteVersionModal({ show: true, skillName: selectedSkill.name, version: v.version })}
                                title="删除此版本"
                              >
                                🗑️
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="detail-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || "");
                              const inline = !match;
                              return !inline ? (
                                <SyntaxHighlighter
                                  style={oneDark}
                                  language={match[1]}
                                  PreTag="div"
                                >
                                  {String(children).replace(/\n$/, "")}
                                </SyntaxHighlighter>
                              ) : (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            },
                          }}
                        >
                          {skillDetail}
                        </ReactMarkdown>
                      </div>
                    </>
                  ) : (
                    <div className="empty-detail">点击左侧 Skill 查看详情</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Push Tab */}
        {activeTab === "push" && (
          <div className="push-tab">
            {!isInitialized || !hubConfig?.agents.length ? (
              <div className="empty-state">
                <p>请先在"订阅管理"中添加 Agent</p>
              </div>
            ) : (
              <div className="push-sync-layout">
                <div className="push-form">
                  <div className="form-group">
                    <label>选择 Agent:</label>
                    <select
                      value={pushAgent}
                      onChange={(e) => {
                        setPushAgent(e.target.value);
                      }}
                    >
                      <option value="">-- 选择 Agent --</option>
                      {hubConfig.agents.map((agent) => (
                        <option key={agent.name} value={agent.name}>
                          {agent.name} ({agent.local_path})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={pushSkills.length === agentSkills.length && agentSkills.length > 0}
                        onChange={selectAllPushSkills}
                        disabled={!pushAgent || agentSkills.length === 0}
                      />
                      {" 全选"}
                    </label>
                    <div className="skills-checklist">
                      {agentSkills.map((skill) => (
                        <label key={skill.name} className="skill-checkbox">
                          <input
                            type="checkbox"
                            checked={pushSkills.includes(skill.name)}
                            onChange={() => togglePushSkill(skill.name)}
                            disabled={!pushAgent}
                          />
                          {skill.name}
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handlePush}
                    disabled={pushing || !pushAgent || pushSkills.length === 0}
                  >
                    {pushing ? "推送中..." : "推送到 Hub"}
                  </button>
                </div>

                <div className="operation-panel">
                  <div className="operation-header">
                    <span>操作日志</span>
                    <button className="btn-clear" onClick={clearLog}>清空</button>
                  </div>
                  {currentOperation && (
                    <div className="current-operation">{currentOperation}</div>
                  )}
                  <div className="operation-log">
                    {operationLog.map((log, i) => (
                      <div key={i} className="log-entry">{log}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync Tab */}
        {activeTab === "sync" && (
          <div className="sync-tab">
            {!isInitialized || !hubConfig?.agents.length ? (
              <div className="empty-state">
                <p>请先在"订阅管理"中添加 Agent</p>
              </div>
            ) : (
              <div className="push-sync-layout">
                <div className="sync-form">
                  <div className="form-group">
                    <label>选择 Agent:</label>
                    <select
                      value={syncAgent}
                      onChange={(e) => {
                        setSyncAgent(e.target.value);
                        setSyncSkill("");
                      }}
                    >
                      <option value="">-- 选择 Agent --</option>
                      {hubConfig.agents.map((agent) => (
                        <option key={agent.name} value={agent.name}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {syncAgent && hubConfig && (
                    <div className="subscribed-skills">
                      <h3>已订阅的 Skills:</h3>
                      {(() => {
                        const agent = hubConfig.agents.find((a) => a.name === syncAgent);
                        return agent?.subscribed_skills.length ? (
                          <ul>
                            {agent.subscribed_skills.map((skillName) => (
                              <li key={skillName}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={syncSkill === skillName}
                                    onChange={() => setSyncSkill(skillName === syncSkill ? "" : skillName)}
                                  />
                                  {skillName}
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="empty-subscriptions">此 Agent 未订阅任何 Skills</p>
                        );
                      })()}
                    </div>
                  )}

                  <div className="sync-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleSync}
                      disabled={syncing || !syncAgent || !syncSkill}
                    >
                      {syncing ? "同步中..." : "同步选中 Skill"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={handleSyncAll}
                      disabled={syncing || !syncAgent}
                    >
                      同步全部订阅
                    </button>
                  </div>
                </div>

                <div className="operation-panel">
                  <div className="operation-header">
                    <span>操作日志</span>
                    <button className="btn-clear" onClick={clearSyncLog}>清空</button>
                  </div>
                  {syncCurrentOp && (
                    <div className="current-operation">{syncCurrentOp}</div>
                  )}
                  <div className="operation-log">
                    {syncLog.map((log, i) => (
                      <div key={i} className="log-entry">{log}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Subscription Tab */}
        {activeTab === "subscription" && (
          <div className="subscription-tab">
            <div className="add-agent-section">
              <h3>添加 Agent</h3>
              <div className="add-agent-form">
                <input
                  type="text"
                  placeholder="Agent 名称 (如: claude-code)"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="本地路径 (如: C:/Users/17625/.claude/skills)"
                  value={newAgentPath}
                  onChange={(e) => setNewAgentPath(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleAddAgent}>
                  添加
                </button>
              </div>
            </div>

            <div className="agents-list">
              <h3>已配置的 Agents</h3>
              {!hubConfig?.agents.length ? (
                <p className="empty-agents">暂无配置的 Agents</p>
              ) : (
                hubConfig.agents.map((agent) => (
                  <div key={agent.name} className="agent-card">
                    <div className="agent-header">
                      <h4>{agent.name}</h4>
                      <button
                        className="btn-remove"
                        onClick={() => handleRemoveAgent(agent.name)}
                      >
                        删除
                      </button>
                    </div>
                    <p className="agent-path">{agent.local_path}</p>
                    <div className="agent-subscriptions">
                      <h5>订阅的 Skills:</h5>
                      {agent.subscribed_skills.length ? (
                        <div className="subscription-tags">
                          {agent.subscribed_skills.map((skill) => (
                            <span key={skill} className="subscription-tag">
                              {skill}
                              <button
                                className="tag-remove"
                                onClick={() => handleUnsubscribe(agent.name, skill)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="no-subscriptions">未订阅任何 Skills</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="subscribe-section">
              <h3>订阅 Skill 到 Agent</h3>
              <div className="subscribe-form">
                <select
                  value={subscribeAgent}
                  onChange={(e) => setSubscribeAgent(e.target.value)}
                >
                  <option value="">-- 选择 Agent --</option>
                  {hubConfig?.agents.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <select
                  value={subscribeSkill}
                  onChange={(e) => setSubscribeSkill(e.target.value)}
                  disabled={!subscribeAgent}
                >
                  <option value="">-- 选择要订阅的 Skill --</option>
                  {hubSkills.map((skill) => (
                    <option key={skill.name} value={skill.name}>
                      {skill.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  onClick={handleSubscribe}
                  disabled={!subscribeAgent || !subscribeSkill}
                >
                  订阅
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Init Modal */}
      {showInitModal && (
        <div className="modal-overlay" onClick={() => setShowInitModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{isInitialized ? "Hub 配置" : "初始化 Hub"}</h2>
            <div className="modal-content">
              <div className="form-group">
                <label>Hub 路径:</label>
                <input
                  type="text"
                  value={initPath || hubConfig?.hub_path || ""}
                  onChange={(e) => setInitPath(e.target.value)}
                  placeholder="如: C:/Users/17625/skills-hub"
                />
              </div>
              <div className="form-group">
                <label>Git 远程仓库 (可选):</label>
                <input
                  type="text"
                  value={initRemote || hubConfig?.git_remote || ""}
                  onChange={(e) => setInitRemote(e.target.value)}
                  placeholder="如: https://github.com/user/skills-hub.git"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowInitModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleInitHub}
                disabled={initializing}
              >
                {initializing ? "初始化中..." : isInitialized ? "保存" : "初始化"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteModal({ show: false, skillName: "" })}>
          <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
            <h2>确认删除</h2>
            <div className="modal-content">
              <p className="delete-warning">
                确定要删除 Skill "<strong>{deleteModal.skillName}</strong>" 吗？
              </p>
              <p className="delete-hint">此操作不可恢复！</p>
              {deleting && (
                <div className="delete-progress">
                  <div className="spinner-small"></div>
                  <span>{deleteProgress}</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteModal({ show: false, skillName: "" })}
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Version Confirmation Modal */}
      {deleteVersionModal.show && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteVersionModal({ show: false, skillName: "", version: "" })}>
          <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
            <h2>确认删除版本</h2>
            <div className="modal-content">
              <p className="delete-warning">
                确定要删除 Skill "<strong>{deleteVersionModal.skillName}</strong>" 的版本 "<strong>{deleteVersionModal.version}</strong>" 吗？
              </p>
              <p className="delete-hint">此操作不可恢复！</p>
              {deleting && (
                <div className="delete-progress">
                  <div className="spinner-small"></div>
                  <span>{deleteProgress}</span>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteVersionModal({ show: false, skillName: "", version: "" })}
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteVersionConfirm}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;