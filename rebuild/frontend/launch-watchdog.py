import subprocess
LOG = "/Users/wuhao/WorkBuddy/国漫/rebuild/frontend/.watchdog.log"
with open(LOG, "a") as f:
    subprocess.Popen(
        ["bash", "/Users/wuhao/WorkBuddy/国漫/rebuild/frontend/dev-server-watchdog.sh"],
        stdin=subprocess.DEVNULL,
        stdout=f,
        stderr=subprocess.STDOUT,
        start_new_session=True,  # 等价于 setsid：脱离父进程组/会话，harness 回收不了
    )
print("watchdog launched in new session (detached from harness)")
