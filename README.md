# vidgen

Free-API, multi-provider prompt-to-video pipeline with deterministic motion-graphics rendering, audio-locked timing, and automated quality gates.

## Core Architecture

- **Multi-Provider Free API Pool (10+ Models + Custom BYO APIs):** Capability-aware router with automatic 429 cooldown failover across Gemini, Groq, OpenRouter, NVIDIA NIM (Nemotron), Cerebras, SambaNova, Mistral, GitHub Models, HuggingFace, Together, and user-defined OpenAI/Gemini-compatible endpoints.
- **Audio-Locked Timeline:** Expressive TTS with word-level timestamps, pronunciation normalization, procedural SFX triggers, and FFmpeg sidechain auto-ducking (`-14 LUFS`).
- **Hybrid Motion-Graphics Engine:** Deterministic virtual-clock Chromium rendering piped directly to FFmpeg, combining hardened responsive Scene Archetypes (`16:9`, `9:16`, `1:1`) with sandboxed AI-authored custom SVG/Canvas visuals.
- **Automated Quality Gates:** Zero-token DOM overflow/collision auto-heal plus single-call keyframe contact-sheet Vision critique.

## Quick Start

```bash
npm install
npm run build
npx vidgen doctor
```
