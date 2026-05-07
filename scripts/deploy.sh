#!/bin/bash
set -e

cd /opt/gahwa

# Ensure logs directory exists
mkdir -p /opt/gahwa/logs

echo "Pulling latest from GitHub..."
git pull origin main

echo "Pushing to Google Apps Script..."
python3 scripts/clasp_push.py

echo "Deploy complete: $(date)"
