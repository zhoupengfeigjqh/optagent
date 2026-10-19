Set-Location 'd:\公司项目\智能体\optagent\frontend'
$env:CI = 'true'
& npx vitest run --reporter=dot *> vitest-out.txt
"exit=$LASTEXITCODE" | Out-File -Append -Encoding utf8 vitest-out.txt
