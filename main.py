from pathlib import Path

from sandbox.macos_executor import SecureMacOSSandboxExecutor


if __name__ == "__main__":
    root = Path(__file__).parent.resolve()
    sandbox = SecureMacOSSandboxExecutor(project_root=root)

    result = sandbox.run("python --version")
    print("执行成功:", result.ok)
    print("退出码:", result.exit_code)
    if result.stdout:
        print("标准输出:\n", result.stdout)
    if result.stderr:
        print("错误输出:\n", result.stderr)
