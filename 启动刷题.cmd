@echo off
setlocal
set "HCIP821_LAUNCHER=%~f0"
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$content = Get-Content -LiteralPath $env:HCIP821_LAUNCHER -Encoding UTF8; $marker = [Array]::IndexOf($content, '# POWERSHELL_PAYLOAD'); if ($marker -lt 0) { exit 1 }; & ([ScriptBlock]::Create(($content[($marker + 1)..($content.Length - 1)] -join [Environment]::NewLine)))"
exit /b
# POWERSHELL_PAYLOAD
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($env:HCIP821_LAUNCHER))
$launchLog = Join-Path $appDirectory '启动日志.txt'
$serverOutput = Join-Path $appDirectory 'server-output.log'
$serverError = Join-Path $appDirectory 'server-error.log'

function Write-LaunchLog([string]$message) {
    $message | Set-Content -LiteralPath $launchLog -Encoding UTF8
}

function Test-Listening([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(200)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch { return $false }
    finally { $client.Dispose() }
}

function Test-ThisApp([int]$port, [string]$expectedRoot) {
    $response = $null
    try {
        $request = [Net.WebRequest]::Create("http://127.0.0.1:$port/health")
        $request.Timeout = 600
        $request.ReadWriteTimeout = 600
        $request.Proxy = $null
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        return ($health.app -eq 'h12-821-practice' -and $health.version -eq 1 -and $health.backendVersion -eq 2 -and $health.rootId -eq $expectedRoot)
    } catch { return $false }
    finally { if ($response) { $response.Dispose() } }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'dist\index.html'))) {
        throw '找不到 dist\index.html。请先在本目录执行 npm install 和 npm run build，详见使用说明.md。'
    }
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $rootBytes = [Text.Encoding]::UTF8.GetBytes($appDirectory.ToLowerInvariant())
        $expectedRoot = [BitConverter]::ToString($hashAlgorithm.ComputeHash($rootBytes)).Replace('-', '').ToLowerInvariant()
    } finally { $hashAlgorithm.Dispose() }

    $availablePorts = New-Object 'System.Collections.Generic.List[int]'
    foreach ($candidatePort in 8210..8229) {
        if (Test-Listening $candidatePort) {
            if (Test-ThisApp $candidatePort $expectedRoot) {
                Write-LaunchLog "已复用本目录的刷题服务：http://127.0.0.1:$candidatePort/"
                Start-Process "http://127.0.0.1:$candidatePort/"
                exit 0
            }
        } else { $availablePorts.Add($candidatePort) }
    }

    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodePath = $bundledNode }
    else {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw '没有找到 Node.js。安装 Node.js 后重新双击；详见使用说明.md。' }
        $nodePath = $nodeCommand.Source
    }
    if ($availablePorts.Count -eq 0) { throw '8210–8229 端口均被其他服务占用。请释放其中一个端口后重试。' }

    foreach ($candidatePort in $availablePorts) {
        # Start only this local server in the background; no visible helper window.
        $serverScript = Join-Path $appDirectory 'server.mjs'
        $processArguments = '"' + $serverScript + '" --port ' + $candidatePort
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList $processArguments -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput $serverOutput -RedirectStandardError $serverError -PassThru
        $isReady = $false
        for ($attemptNumber = 0; $attemptNumber -lt 40; $attemptNumber++) {
            if (Test-ThisApp $candidatePort $expectedRoot) { $isReady = $true; break }
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) { break }
            Start-Sleep -Milliseconds 150
        }
        if ($isReady) {
            Write-LaunchLog "刷题服务已启动：http://127.0.0.1:$candidatePort/`r`n服务只监听本机。关闭浏览器后服务仍可复用，重启电脑后再次双击即可。"
            Start-Process "http://127.0.0.1:$candidatePort/"
            exit 0
        }
        $serverProcess.Refresh()
        if (-not $serverProcess.HasExited) { $serverProcess.Kill() }
        $errorText = if (Test-Path -LiteralPath $serverError) { Get-Content -LiteralPath $serverError -Raw -Encoding UTF8 } else { '' }
        if ($errorText -notmatch 'already in use') { throw "刷题服务未能启动。$errorText" }
    }
    throw '启动期间端口被占用，未打开其他应用。请稍后重试。'
} catch {
    Write-LaunchLog ("启动失败：" + $_.Exception.Message)
    # A text log remains reviewable even when the launcher runs without a console.
    Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $launchLog + '"')
    exit 1
}
