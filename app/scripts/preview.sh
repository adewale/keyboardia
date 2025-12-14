#!/bin/bash
# Auto-open browser and start dev server with hot reload

PORT=5173
URL="http://localhost:$PORT"

# Kill any existing dev server
pkill -f "vite" 2>/dev/null

# Open browser (works on macOS, Linux, WSL)
if command -v open &> /dev/null; then
    open "$URL" &
elif command -v xdg-open &> /dev/null; then
    xdg-open "$URL" &
elif command -v wslview &> /dev/null; then
    wslview "$URL" &
fi

# Start dev server (blocks)
npm run dev
