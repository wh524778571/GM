#!/bin/bash
# 国漫写作前端保活看门狗：崩溃自动重启，并用 setsid 脱离 WorkBuddy 任务树
export no_proxy=127.0.0.1,localhost
export NODE_OPTIONS=""
cd /Users/wuhao/WorkBuddy/国漫/rebuild/frontend
while true; do
  /Users/wuhao/.workbuddy/binaries/node/versions/22.12.0/bin/node \
    ./node_modules/next/dist/bin/next dev -p 3000
  sleep 2
done
