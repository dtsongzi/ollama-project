#!/bin/bash

# 切换到构建目录
cd dist

# 启动Python HTTP服务器
python3 -m http.server 8000

echo "服务器已在 http://localhost:8000 启动"
