# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- **Project Name**: my-skills
- **Type**: Tauri Desktop Application (React + TypeScript)
- **Purpose**: Skills inventory desktop app for managing Claude Code skills

## Project Structure

```
my-skills/
└── skills-inventory/           # Main application
    ├── src/                    # React frontend (TypeScript)
    ├── src-tauri/              # Tauri backend (Rust)
    ├── icons/                  # App icons
    └── dist/                   # Built application
```

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Tauri 2.x (Rust)
- **Package Manager**: npm

## Common Commands

```bash
# Navigate to app directory
cd "C:/CODE/my-skills/skills-inventory"

# Install dependencies
npm install

# Run development server
npm run dev

# Build the application
npm run build

# Run Tauri dev (full app with backend)
npm run tauri dev

# Build Tauri app for production
npm run tauri build
```

## Development Notes

- TypeScript strict mode enabled
- React 18 with hooks
- Tauri 2.x uses @tauri-apps/api v2
- App icons generated from SVG in icons/ directory
