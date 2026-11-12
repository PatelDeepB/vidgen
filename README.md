# vidgen

Free-API, multi-provider prompt-to-video pipeline with deterministic motion-graphics rendering, audio-locked timing, and automated quality gates.

## Features

- **Multi-Provider Free API Pool (10+ Built-in Providers + Custom BYO Endpoints):**
  - Built-in support for NVIDIA NIM (Nemotron 3.5 Lightning & Nemotron 3.5 Super VL), Google Gemini Free Tier, Groq, OpenRouter (`:free`), Cerebras, SambaNova, Mistral, GitHub Models, HuggingFace Inference, and Together AI.
  - Add any unlisted OpenAI-compatible or Gemini-compatible endpoint via `vidgen keys add-custom`.
  - Capability-aware routing with automatic HTTP 429 cooldown failover, `<think>` block stripping, and JSON repair.
- **Audio-Locked Timeline & Sound Design:**
  - Dual-text pronunciation normalization (`API` -> `A P I`, `$10M` -> `10 million dollars`, `v2.4` -> `version 2 point 4`).
  - Expressive Edge TTS narration with word-level boundary timestamps (`captions.srt` + live highlighted caption rail).
  - Procedural WAV SFX (`whoosh`, `pop`, `click`, `chime`, `riser`) + ambient chord bed with FFmpeg `sidechaincompress` auto-ducking (`-14 LUFS`).
- **Two-Pass AI Director + Hybrid Visual Engine:**
  - Pass 1 Narrative & Hook Architect + Pass 2 Visual Choreographer crafting XSS-sanitized inline SVGs, animated metric counters, syntax-highlighted code lines, and oversized pointer click animations.
  - Optional free stock B-roll background enrichment (Pexels, Pixabay, or keyless Wikimedia Commons) with Ken Burns motion and contrast scrims.
- **Deterministic Rendering & Automated Quality Gates:**
  - Headless Chrome/Edge virtual-clock capture (`window.__VIDGEN_CLOCK__`) piped directly into FFmpeg `image2pipe`.
  - Zero-token Playwright DOM overflow/caption-collision auto-heal.
  - Single-call 3x3 keyframe contact-sheet Vision Critic + localhost interactive Studio scrubber (`vidgen preview`).

## Quick Start

```bash
npm install
npm run build
node dist/cli/main.js doctor
```

### Configure Free API Keys (Add Multiple for 429 Failover)

```bash
# Built-in providers (nvidia, gemini, groq, openrouter, cerebras, sambanova, mistral, github, huggingface, together)
node dist/cli/main.js keys add nvidia "nvapi-..."
node dist/cli/main.js keys add gemini "AIza..."
node dist/cli/main.js keys add groq "gsk_..."

# Add any custom endpoint not listed above
node dist/cli/main.js keys add-custom \
  --id my-api \
  --name "Custom LLM" \
  --base-url "https://api.example.com/v1" \
  --api-key "sk-..." \
  --model "custom-70b"

# Verify live connectivity and latency across your pool
node dist/cli/main.js keys test
```

### Generate & Preview Videos

```bash
# Render a 16:9 or 9:16 video
node dist/cli/main.js create "How vector databases match meaning using embeddings" \
  --aspect 16:9 \
  --quality draft \
  --provider nvidia

# Launch localhost interactive frame scrubber
node dist/cli/main.js preview ./jobs/job-123456
```

### Docker

```bash
docker build -f docker/Dockerfile -t vidgen .
docker run --rm -e NVIDIA_API_KEY="$NVIDIA_API_KEY" -v "$(pwd)/jobs:/app/jobs" vidgen \
  create "Explain async/await in 30 seconds" --aspect 9:16 --out-dir /app/jobs/demo
```
