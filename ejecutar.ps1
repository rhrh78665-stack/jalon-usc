& {
    $ErrorActionPreference = 'Stop'
    Set-Location -LiteralPath $PSScriptRoot
    $versionNode = & node --version
    if ($LASTEXITCODE -ne 0 -or [version]($versionNode.TrimStart('v')) -lt [version]'24.7.0') {
        throw 'Instala Node.js 24.7 o posterior.'
    }
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la aplicación.' }
    $env:PORT = '3001'
    Write-Host 'Abre http://127.0.0.1:3001 y conserva esta terminal abierta.'
    node server/demo.js
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar la aplicación.' }
}
