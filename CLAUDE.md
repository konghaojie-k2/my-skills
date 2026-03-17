# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- **Project Name**: my-skills
- **Type**: Python Package
- **Python Version**: 3.13+
- **Package Manager**: uv

## Common Commands

```bash
# Install dependencies and create virtual environment
cd "C:/CODE/my-skills" && uv sync

# Run the main script
cd "C:/CODE/my-skills" && uv run main.py

# Add a new dependency
cd "C:/CODE/my-skills" && uv add <package>

# Run with specific Python version
cd "C:/CODE/my-skills" && uv run --python 3.13 main.py
```

## Development Notes

- All Python files must include encoding declaration: `# -*- coding: utf-8 -*-`
- Uses 清华镜像源 (Tsinghua Mirror) for pip packages in `pyproject.toml`
- Virtual environment: `.venv/`
