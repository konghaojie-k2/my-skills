import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

interface Skill {
  name: string;
  description: string;
  source: string;
  path: string;
  category: string | null;
}

interface ScanResult {
  skills: Skill[];
  total: number;
  sources: { source: string; count: number }[];
}

interface ScanPath {
  path: string;
  source: string;
}

function App() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillDetail, setSkillDetail] = useState<string>("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [sources, setSources] = useState<{ source: string; count: number }[]>([]);
  const [customPaths, setCustomPaths] = useState<ScanPath[]>([]);
  const [defaultPaths, setDefaultPaths] = useState<ScanPath[]>([]);
  const [allPaths, setAllPaths] = useState<ScanPath[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newSource, setNewSource] = useState("");
  const [showPathInput, setShowPathInput] = useState(false);

  useEffect(() => {
    // Load default paths and saved custom paths, then merge and scan
    loadAllPaths();
  }, []);

  const loadAllPaths = async () => {
    try {
      // 获取默认路径
      const defaults = await invoke<ScanPath[]>("get_default_scan_paths");
      setDefaultPaths(defaults);

      // 获取保存的自定义路径
      const saved = await invoke<ScanPath[]>("load_custom_paths");
      setCustomPaths(saved);

      // 合并所有路径
      const all = [...defaults, ...saved];
      setAllPaths(all);

      // 用所有路径扫描
      await loadSkills(all);
    } catch (error) {
      console.error("Failed to load paths:", error);
      // 失败时只尝试默认路径
      try {
        const defaults = await invoke<ScanPath[]>("get_default_scan_paths");
        setDefaultPaths(defaults);
        setAllPaths(defaults);
        await loadSkills(defaults);
      } catch (e) {
        console.error("Failed to load default paths:", e);
        await loadSkills([]);
      }
    }
  };

  const loadSkills = async (paths: ScanPath[]) => {
    setLoading(true);
    try {
      const result = await invoke<ScanResult>("scan_all_skills", { customPaths: paths });
      setSkills(result.skills);
      setSources(result.sources);
    } catch (error) {
      console.error("Failed to load skills:", error);
    } finally {
      setLoading(false);
    }
  };

  const [saveMessage, setSaveMessage] = useState("");

  const handleAddPath = async () => {
    if (!newPath.trim()) return;

    const newCustomPath = { path: newPath.trim(), source: newSource.trim() || "自定义" };
    const updatedCustomPaths = [...customPaths, newCustomPath];
    setCustomPaths(updatedCustomPaths);

    // 合并所有路径（包括默认+自定义）
    const updatedAllPaths = [...defaultPaths, ...updatedCustomPaths];
    setAllPaths(updatedAllPaths);

    // 保存自定义路径到配置文件
    try {
      await invoke("save_custom_paths", { paths: updatedCustomPaths });
      setSaveMessage("路径已保存！");
      console.log("Paths saved:", updatedCustomPaths);
    } catch (error) {
      console.error("Failed to save paths:", error);
      setSaveMessage("保存失败: " + error);
    }

    // 用合并后的路径刷新技能列表
    await loadSkills(updatedAllPaths);

    setNewPath("");
    setNewSource("");
    setShowPathInput(false);

    // 3秒后清除消息
    setTimeout(() => setSaveMessage(""), 3000);
  };

  const handleRemovePath = async (index: number) => {
    // 注意：这里 index 是相对于 customPaths 的
    const updatedCustomPaths = customPaths.filter((_, i) => i !== index);
    setCustomPaths(updatedCustomPaths);

    // 合并所有路径
    const updatedAllPaths = [...defaultPaths, ...updatedCustomPaths];
    setAllPaths(updatedAllPaths);

    // 保存自定义路径
    try {
      await invoke("save_custom_paths", { paths: updatedCustomPaths });
      setSaveMessage("路径已删除！");
      // 3秒后清除消息
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (error) {
      console.error("Failed to save paths:", error);
    }

    await loadSkills(updatedAllPaths);
  };

  const handleRefresh = async () => {
    await loadSkills(allPaths);
  };

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchesSearch =
        search === "" ||
        skill.name.toLowerCase().includes(search.toLowerCase()) ||
        skill.description.toLowerCase().includes(search.toLowerCase());
      const matchesSource =
        selectedSource === "all" || skill.source === selectedSource;
      return matchesSearch && matchesSource;
    });
  }, [skills, search, selectedSource]);

  const handleSkillClick = async (skill: Skill) => {
    setSelectedSkill(skill);
    setDetailLoading(true);
    try {
      const detail = await invoke<string | null>("get_skill_detail", {
        path: skill.path,
      });
      setSkillDetail(detail || "无详情内容");
    } catch (error) {
      console.error("Failed to load detail:", error);
      setSkillDetail("加载失败");
    } finally {
      setDetailLoading(false    );
    }
  };

  const handleDownloadFolder = async (skill: Skill) => {
    try {
      const base64Data = await invoke<string>("export_skill_folder", {
        path: skill.path,
      });

      // Convert base64 to binary
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Show native save dialog
      const filePath = await save({
        defaultPath: `${skill.name}.zip`,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });

      if (!filePath) {
        return; // User cancelled
      }

      // Write file to user-selected path using Tauri fs plugin
      await writeFile(filePath, bytes);
    } catch (error) {
      console.error("Download failed:", error);
      alert("下载失败: " + error);
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case "CC SWITCH":
        return "bg-blue-100 text-blue-800";
      case "OpenClaw":
        return "bg-green-100 text-green-800";
      case "Claude":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-orange-100 text-orange-800";
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Skills 盘点器</h1>
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? "加载中..." : "刷新"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowPathInput(!showPathInput)}
          >
            {showPathInput ? "取消添加" : "添加路径"}
          </button>
        </div>
        {saveMessage && <div className="save-message">{saveMessage}</div>}
      </header>

      {showPathInput && (
        <div className="path-input-section">
          <input
            type="text"
            className="path-input"
            placeholder="输入文件夹路径，如: C:\Users\17625\Documents\my-skills"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <input
            type="text"
            className="source-input"
            placeholder="来源名称（可选）"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleAddPath}>
            添加
          </button>
        </div>
      )}

      {allPaths.length > 0 && (
        <div className="custom-paths">
          <span className="paths-label">扫描路径:</span>
          {allPaths.map((p, index) => {
            // 判断是否是自定义路径（索引 >= 默认路径数量）
            const isCustom = index >= defaultPaths.length;
            const customIndex = index - defaultPaths.length;
            return (
              <span key={index} className={`path-tag ${isCustom ? 'custom' : 'default'}`}>
                {p.source}: {p.path}
                {isCustom && (
                  <button
                    className="path-remove"
                    onClick={() => handleRemovePath(customIndex)}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="stats">
        <div className="stat-card">
          <span className="stat-value">{skills.length}</span>
          <span className="stat-label">总计 Skills</span>
        </div>
        {sources.map((s) => (
          <div key={s.source} className="stat-card">
            <span className="stat-value">{s.count}</span>
            <span className="stat-label">{s.source}</span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="搜索 skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="source-filter"
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
        >
          <option value="all">全部来源</option>
          {sources.map((s) => (
            <option key={s.source} value={s.source}>
              {s.source} ({s.count})
            </option>
          ))}
        </select>
      </div>

      <div className="main-content">
        <div className="skills-list">
          {loading ? (
            <div className="loading">加载中...</div>
          ) : filteredSkills.length === 0 ? (
            <div className="empty">没有找到匹配的 skills</div>
          ) : (
            filteredSkills.map((skill, index) => (
              <div
                key={index}
                className={`skill-item ${
                  selectedSkill?.path === skill.path ? "selected" : ""
                }`}
                onClick={() => handleSkillClick(skill)}
              >
                <div className="skill-name">{skill.name}</div>
                <div className="skill-desc">
                  {skill.description || "暂无描述"}
                </div>
                <div className="skill-footer">
                  <span className={`source-badge ${getSourceColor(skill.source)}`}>
                    {skill.source}
                  </span>
                  <button
                    className="download-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadFolder(skill);
                    }}
                  >
                    下载
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="skill-detail">
          {selectedSkill ? (
            <>
              <div className="detail-header">
                <h2>{selectedSkill.name}</h2>
                <span
                  className={`source-badge ${getSourceColor(
                    selectedSkill.source
                  )}`}
                >
                  {selectedSkill.source}
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => handleDownloadFolder(selectedSkill)}
                >
                  下载文件夹
                </button>
              </div>
              <div className="detail-path">
                路径: {selectedSkill.path}
              </div>
              {detailLoading ? (
                <div className="loading">加载详情...</div>
              ) : (
                <pre className="detail-content">{skillDetail}</pre>
              )}
            </>
          ) : (
            <div className="empty-detail">
              点击左侧技能查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
